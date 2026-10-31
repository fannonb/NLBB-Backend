import { createHmac, timingSafeEqual } from "crypto";

export interface SupabaseAccessTokenClaims {
  sub: string;
  email?: string;
  session_id?: string;
  exp?: number;
  iss?: string;
  aud?: string | string[];
  nbf?: number;
  role?: string;
  // Supabase emits either RFC-8176 strings or { method, timestamp } entries.
  amr?: Array<string | { method?: string; timestamp?: number }>;
}

export const getAuthMethods = (claims: SupabaseAccessTokenClaims | null): string[] =>
  (claims?.amr ?? [])
    .map((entry) => (typeof entry === "string" ? entry : entry?.method))
    .filter((method): method is string => typeof method === "string" && method.length > 0);

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64");
};

/**
 * Reads claims WITHOUT checking the signature. Only use on a token that has already
 * been verified (e.g. via supabaseAdmin.auth.getUser).
 */
export const readVerifiedTokenClaims = (token: string): SupabaseAccessTokenClaims | null => {
  const payloadPart = token.split(".")[1];
  if (!payloadPart) {
    return null;
  }
  try {
    return JSON.parse(decodeBase64Url(payloadPart).toString("utf8")) as SupabaseAccessTokenClaims;
  } catch {
    return null;
  }
};

export const verifySupabaseAccessToken = (
  token: string,
  secret: string,
  issuer?: string
): SupabaseAccessTokenClaims | null => {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  const signedContent = `${headerPart}.${payloadPart}`;
  const expectedSignature = createHmac("sha256", secret).update(signedContent).digest("base64url");

  const actual = Buffer.from(signaturePart);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }

  try {
    const header = JSON.parse(decodeBase64Url(headerPart).toString("utf8"));
    if (header.alg !== "HS256") return null;
    const payload = JSON.parse(decodeBase64Url(payloadPart).toString("utf8")) as SupabaseAccessTokenClaims;
    if (typeof payload.sub !== "string" || !payload.sub || typeof payload.session_id !== "string") {
      return null;
    }
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now()) {
      return null;
    }
    if (payload.nbf !== undefined && (typeof payload.nbf !== "number" || payload.nbf * 1000 > Date.now())) return null;
    if (issuer && payload.iss !== issuer) return null;
    if (payload.aud !== "authenticated" && !(Array.isArray(payload.aud) && payload.aud.includes("authenticated"))) return null;
    return payload;
  } catch {
    return null;
  }
};
