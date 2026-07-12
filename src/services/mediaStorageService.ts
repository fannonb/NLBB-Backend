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
