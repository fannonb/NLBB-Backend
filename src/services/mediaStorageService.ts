import { randomUUID } from "node:crypto";
import { env } from "../config/env";
import { supabaseAdmin } from "../lib/supabase";
import { ApiError } from "../utils/apiError";

const FIVE_MB = 5 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const DATA_URI_REGEX = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

export type ProviderMediaKind = "avatar" | "cover" | "gallery";

export interface UploadedMediaAsset {
  bucket: string;
  storageKey: string;
  publicUrl: string;
  mimeType: string;
  fileSize: number;
}

const uploadToBucket = async (
  bucket: string,
  objectPath: string,
  dataUri: string
): Promise<UploadedMediaAsset> => {
  const match = dataUri.match(DATA_URI_REGEX);
  if (!match) {
    throw new ApiError(400, "Invalid image payload", "INVALID_IMAGE_PAYLOAD");
  }

  const mimeType = match[1];
  const encoded = match[2];
  const ext = MIME_TO_EXT[mimeType];
  if (!ext) {
    throw new ApiError(400, "Unsupported image type", "UNSUPPORTED_IMAGE_TYPE");
  }

  const buffer = Buffer.from(encoded, "base64");
  if (buffer.byteLength > FIVE_MB) {
    throw new ApiError(413, "Image is too large (max 5MB)", "IMAGE_TOO_LARGE");
  }

  const finalPath = objectPath.endsWith(`.${ext}`) ? objectPath : `${objectPath}.${ext}`;
  const { error: uploadError } = await supabaseAdmin.storage.from(bucket).upload(finalPath, buffer, {
    contentType: mimeType,
    upsert: true,
  });

  if (uploadError) {
    throw new ApiError(502, `Storage upload failed: ${uploadError.message}`, "STORAGE_UPLOAD_FAILED");
  }

  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(finalPath);
  if (!data.publicUrl) {
    throw new ApiError(500, "Storage upload succeeded but no public URL was returned", "STORAGE_URL_MISSING");
  }

  return {
    bucket,
    storageKey: `${bucket}/${finalPath}`,
    publicUrl: data.publicUrl,
    mimeType,
    fileSize: buffer.byteLength,
  };
};

export const uploadUserAvatar = async (userId: string, dataUri: string) =>
  uploadToBucket(
    env.SUPABASE_USER_AVATAR_BUCKET,
    `${userId}/avatar-${Date.now()}-${randomUUID()}`,
    dataUri
  );

export const uploadProviderMedia = async (
  ownerUserId: string,
  kind: ProviderMediaKind,
  dataUri: string
) => {
  const bucket =
    kind === "avatar"
      ? env.SUPABASE_PROVIDER_AVATAR_BUCKET
      : kind === "cover"
        ? env.SUPABASE_PROVIDER_COVER_BUCKET
        : env.SUPABASE_PROVIDER_GALLERY_BUCKET;

  return uploadToBucket(
    bucket,
    `${ownerUserId}/${kind}-${Date.now()}-${randomUUID()}`,
    dataUri
  );
};

// Uploads happen before the profile is saved, so images from cancelled edits or replaced
// photos are never referenced. Files younger than this are kept so an edit still in
// progress (e.g. on another device) can't lose a fresh upload.
const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;

/**
 * Deletes files in the owner's provider-media folders that no saved URL references.
 * Only touches `<ownerUserId>/...` in the provider avatar, cover and gallery buckets.
 */
export const removeUnreferencedProviderMedia = async (ownerUserId: string, referencedUrls: string[]) => {
  const referenced = referencedUrls.map((url) => {
    try {
      return decodeURI(url.split("?")[0]);
    } catch {
      return url;
    }
  });
  const isReferenced = (bucket: string, path: string) =>
    referenced.some((url) => url.endsWith(`/${bucket}/${path}`));

  const buckets = [
    env.SUPABASE_PROVIDER_AVATAR_BUCKET,
    env.SUPABASE_PROVIDER_COVER_BUCKET,
    env.SUPABASE_PROVIDER_GALLERY_BUCKET,
  ];

  let removed = 0;
  for (const bucket of buckets) {
    const { data: objects, error } = await supabaseAdmin.storage.from(bucket).list(ownerUserId, { limit: 1000 });
    if (error || !objects) {
      continue;
    }

    const stalePaths = objects
      .filter((object) => {
        // Folders come back without an id or timestamp.
        if (!object.id || !object.created_at) return false;
        return Date.now() - new Date(object.created_at).getTime() > ORPHAN_MIN_AGE_MS;
      })
      .map((object) => `${ownerUserId}/${object.name}`)
      .filter((path) => !isReferenced(bucket, path));

    if (stalePaths.length > 0) {
      const { error: removeError } = await supabaseAdmin.storage.from(bucket).remove(stalePaths);
      if (!removeError) {
        removed += stalePaths.length;
      }
    }
  }

  return { removed };
};
