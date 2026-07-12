import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ override: true });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_BASE_URL: z.string().default("http://localhost:4000"),
  PASSWORD_RESET_REDIRECT_URL: z.string().default("nlbb://reset-password"),
  ALLOWED_ORIGINS: z.string().optional(),
  TRUST_PROXY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  EMAIL_REPLY_TO: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_FALLBACK_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => (v ?? "false").toLowerCase() === "true"),
  SMTP_REQUIRE_TLS: z
    .string()
    .optional()
    .transform((v) => (v ?? "false").toLowerCase() === "true"),
  SMTP_IGNORE_TLS: z
    .string()
    .optional()
    .transform((v) => (v ?? "false").toLowerCase() === "true"),
  SMTP_TLS_REJECT_UNAUTHORIZED: z
    .string()
    .optional()
    .transform((v) => (v ?? "true").toLowerCase() !== "false"),
  SMTP_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  SMTP_GREETING_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  SMTP_SOCKET_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  PAYMENTS_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v ?? "true").toLowerCase() !== "false"),
  MPESA_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v ?? "true").toLowerCase() !== "false"),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),

  SUPABASE_URL: z.string(),
  SUPABASE_SERVICE_ROLE_KEY: z.string(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_USER_AVATAR_BUCKET: z.string().default("user-avatars"),
  SUPABASE_PROVIDER_AVATAR_BUCKET: z.string().default("provider-avatars"),
  SUPABASE_PROVIDER_COVER_BUCKET: z.string().default("provider-covers"),
  SUPABASE_PROVIDER_GALLERY_BUCKET: z.string().default("provider-gallery"),

  MPESA_SIMULATE: z
    .string()
    .optional()
    .transform((v) => (v ?? "true").toLowerCase() !== "false"),
  MPESA_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  MPESA_CONSUMER_KEY: z.string().optional(),
  MPESA_CONSUMER_SECRET: z.string().optional(),
  MPESA_SHORTCODE: z.string().optional(),
  MPESA_PASSKEY: z.string().optional(),
  MPESA_CALLBACK_URL: z.string().optional(),
  MPESA_CALLBACK_SECRET: z.string().optional(),
  ADMIN_API_KEY: z.string().optional(),
  ADMIN_API_KEY_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v ?? "true").toLowerCase() !== "false"),
  REQUIRE_ACTIVE_USER: z
    .string()
    .optional()
    .transform((v) => (v ?? "true").toLowerCase() !== "false"),
});

export const env = envSchema.parse(process.env);

const parseTrustProxy = (value: string | undefined) => {
  if (!value?.trim()) {
    return env.NODE_ENV === "production" ? 1 : false;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 0) {
    return numeric;
  }

  return value.trim();
};

export const allowedOrigins = (env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const trustProxy = parseTrustProxy(env.TRUST_PROXY);
