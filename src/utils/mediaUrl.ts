import { z } from "zod";
import { env } from "../config/env";
import { supabaseAdmin } from "../lib/supabase";

const trimValue = (value: string | null | undefined) => value?.trim() ?? "";

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, "");

const toAppHostedUrl = (value: string) => {
  const baseUrl = normalizeBaseUrl(env.APP_BASE_URL);
  if (!baseUrl) {
    return value;
  }

  if (value.startsWith("/")) {
    return `${baseUrl}${value}`;
  }

  return `${baseUrl}/${value.replace(/^\/+/, "")}`;
};

const isDirectUrl = (value: string) => /^(?:https?:|data:|file:|content:)/i.test(value);

const looksLikeSupabaseStorageKey = (value: string) => {
  const [bucket, ...rest] = value.split("/");
  return Boolean(bucket && rest.length > 0 && !bucket.includes("."));
};

const toSupabasePublicUrl = (storageKey: string) => {
  const [bucket, ...rest] = storageKey.split("/");
  if (!bucket || rest.length === 0) {
    return null;
  }

  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(rest.join("/"));
  return data.publicUrl || null;
};

export const resolvePublicMediaUrl = (
  publicUrl?: string | null,
  storageKey?: string | null
): string | undefined => {
  const directCandidate = trimValue(publicUrl);
  if (directCandidate) {
    if (isDirectUrl(directCandidate)) {
      return directCandidate;
    }
    if (directCandidate.startsWith("/") || directCandidate.startsWith("uploads/")) {
      return toAppHostedUrl(directCandidate);
    }
  }

  const storageCandidate = trimValue(storageKey);
  if (!storageCandidate) {
    return undefined;
  }

  if (isDirectUrl(storageCandidate)) {
    return storageCandidate;
  }

  if (storageCandidate.startsWith("/") || storageCandidate.startsWith("uploads/")) {
    return toAppHostedUrl(storageCandidate);
  }

  if (looksLikeSupabaseStorageKey(storageCandidate)) {
    return toSupabasePublicUrl(storageCandidate) ?? undefined;
  }

  return storageCandidate;
};

// Images must come from our own upload endpoints. Accepting any URL let clients skip
// the upload checks (type/size) and embed third-party images or tracking pixels.
// images.unsplash.com stays allowed because the apps use Unsplash photos as defaults.
const ALLOWED_EXTERNAL_IMAGE_HOSTS = new Set(["images.unsplash.com"]);
export const MAX_GALLERY_IMAGES = 12;

export const isAllowedMediaUrl = (value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  const storagePrefix = `${normalizeBaseUrl(env.SUPABASE_URL)}/storage/v1/object/public/`;
  if (value.startsWith(storagePrefix)) {
    return true;
  }

  const appBaseUrl = normalizeBaseUrl(env.APP_BASE_URL);
  if (appBaseUrl && value.startsWith(`${appBaseUrl}/uploads/`)) {
    return true;
  }

  return url.protocol === "https:" && ALLOWED_EXTERNAL_IMAGE_HOSTS.has(url.hostname);
};

export const allowedMediaUrlSchema = z
  .string()
  .url()
  .refine(isAllowedMediaUrl, { message: "Images must be uploaded through the NLBB app" });
