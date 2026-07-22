import { createHmac, timingSafeEqual } from "crypto";

export interface SupabaseAccessTokenClaims {
  sub: string;
  email?: string;
  session_id?: string;
  exp?: number;
  role?: string;
}

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64");
};

export const verifySupabaseAccessToken = (
  token: string,
  secret: string
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
    const payload = JSON.parse(decodeBase64Url(payloadPart).toString("utf8")) as SupabaseAccessTokenClaims;
    if (!payload.sub) {
      return null;
    }
    if (payload.exp && payload.exp * 1000 <= Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
};
