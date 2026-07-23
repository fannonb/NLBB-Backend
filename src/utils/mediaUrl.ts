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
