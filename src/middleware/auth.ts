import { eq, sql } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { getDb } from "../db/client";
import { supabaseAdmin } from "../lib/supabase";
import { readVerifiedTokenClaims, verifySupabaseAccessToken } from "../lib/verifySupabaseJwt";
import { ensureUserFromSupabaseAuth } from "../services/userService";
import { providers, users } from "../db/schema";
import type { UserRole } from "../types/domain";
import { ApiError } from "../utils/apiError";
import { userLimiter } from "./rateLimiters";

export interface AuthenticatedUser {
  uid: string;
  email: string;
  role: UserRole;
  status: "active" | "disabled";
  sessionId: string;
}

const isValidAdminApiKey = (req: Request) => {
  const adminApiKey = req.headers["x-admin-api-key"];
  return (
    env.ADMIN_API_KEY_ENABLED &&
    !!env.ADMIN_API_KEY &&
    typeof adminApiKey === "string" &&
    adminApiKey === env.ADMIN_API_KEY
  );
};

const SUPABASE_AUTH_TIMEOUT_MS = 8_000;

/** Call only with a token whose signature has already been verified. */
export const requireActiveSession = async (token: string, uid: string) => {
  const claims = readVerifiedTokenClaims(token);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!claims?.session_id || !uuid.test(claims.session_id) ||
      typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) {
    throw new ApiError(401, "Invalid or expired session", "UNAUTHORIZED");
  }
  // Check the authoritative session on every request. This survives restarts,
  // covers all API instances, and also honors password-change/global sign-out.
  const rows = await getDb().execute(sql`
    select id from auth.sessions
    where id = ${claims.session_id}::uuid and user_id = ${uid}::uuid
      and (not_after is null or not_after > now())
    limit 1
  `);
  if (rows.length === 0) {
    throw new ApiError(401, "Session has been signed out", "UNAUTHORIZED");
  }
  return claims.session_id;
};

/** Supabase signOut removes auth.sessions; no process-local revocation cache. */
export const revokeSessionForToken = async (token: string) => {
  const claims = readVerifiedTokenClaims(token);
  if (claims?.session_id) {
    await getDb().execute(sql`delete from auth.sessions where id = ${claims.session_id}::uuid and user_id = ${claims.sub}::uuid`);
  }
};

export const extractBearerToken = (authorization?: string) => {
  if (!authorization) {
    throw new ApiError(401, "Missing bearer token", "UNAUTHORIZED");
  }

  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new ApiError(401, "Missing bearer token", "UNAUTHORIZED");
  }

  return token;
};

const loadAuthenticatedUser = async (uid: string, email: string, sessionId: string) => {
  const db = getDb();
  let [user] = await db.select().from(users).where(eq(users.id, uid)).limit(1);

  if (!user) {
    const { data: { user: supabaseUser }, error } = await supabaseAdmin.auth.admin.getUserById(uid);
    if (error || !supabaseUser) {
      throw new ApiError(401, "Invalid or expired token", "UNAUTHORIZED");
    }
    await ensureUserFromSupabaseAuth(supabaseUser);
    [user] = await db.select().from(users).where(eq(users.id, uid)).limit(1);
  }

  if (!user) {
    throw new ApiError(401, "Invalid or expired token", "UNAUTHORIZED");
  }

  if (user.status === "disabled") {
    throw new ApiError(403, "Account is disabled", "ACCOUNT_DISABLED");
  }

  if (user.role === "admin") {
    return {
      uid: user.id,
      email: user.email || email,
      role: "admin",
      status: user.status as "active" | "disabled",
      sessionId,
    } satisfies AuthenticatedUser;
  }

  if (user.role === "customer") {
    const [provider] = await db
      .select({ id: providers.id })
      .from(providers)
      .where(eq(providers.ownerUserId, user.id))
      .limit(1);

    if (provider) {
      await db
        .update(users)
        .set({
          role: "provider",
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      user = {
        ...user,
        role: "provider",
      };
    }
  }

  return {
    uid: user.id,
    email: user.email || email,
    role: user.role as UserRole,
    status: user.status as "active" | "disabled",
    sessionId,
  } satisfies AuthenticatedUser;
};

const getSupabaseUserWithTimeout = async (token: string) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      supabaseAdmin.auth.getUser(token),
      new Promise<Awaited<ReturnType<typeof supabaseAdmin.auth.getUser>>>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Supabase auth timed out")), SUPABASE_AUTH_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

export const resolveAccessToken = async (authorization?: string): Promise<AuthenticatedUser> => {
  const token = extractBearerToken(authorization);
  if (env.SUPABASE_JWT_SECRET) {
    const claims = verifySupabaseAccessToken(token, env.SUPABASE_JWT_SECRET, `${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1`);
    if (claims) {
      const sessionId = await requireActiveSession(token, claims.sub);
      return loadAuthenticatedUser(claims.sub, claims.email ?? `${claims.sub}@nlbb.local`, sessionId);
    }
  }
  // ECC/RSA projects are verified by Supabase; the session check still applies.
  const { data: { user }, error } = await getSupabaseUserWithTimeout(token);
  if (error || !user) throw new ApiError(401, "Invalid or expired token", "UNAUTHORIZED");
  const sessionId = await requireActiveSession(token, user.id);
  return loadAuthenticatedUser(user.id, user.email ?? `${user.id}@nlbb.local`, sessionId);
};

export const optionalAuth = async (req: Request, _res: Response, next: NextFunction) => {
  if (!req.headers.authorization) {
    return next();
  }

  try {
    req.auth = await resolveAccessToken(req.headers.authorization);
  } catch {
    return next();
  }

  return next();
};

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    req.auth = await resolveAccessToken(req.headers.authorization);
  } catch (error) {
    return next(error);
  }
  return userLimiter(req, res, next);
};

export const requireAdminAccess = async (req: Request, _res: Response, next: NextFunction) => {
  if (isValidAdminApiKey(req)) {
    req.auth = {
      uid: "admin-web-proxy",
      email: "proxy@nlbb.local",
      role: "admin",
      status: "active",
      sessionId: "admin-web-proxy",
    };
    return next();
  }

  try {
    req.auth = await resolveAccessToken(req.headers.authorization);
    if (req.auth.role !== "admin") {
      return next(new ApiError(403, "Insufficient permissions", "FORBIDDEN"));
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

export const requireRole = (...roles: Array<"customer" | "provider" | "admin">) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      return next(new ApiError(401, "Authentication required", "UNAUTHORIZED"));
    }
    if (!roles.includes(req.auth.role)) {
      return next(new ApiError(403, "Insufficient permissions", "FORBIDDEN"));
    }
    if (env.REQUIRE_ACTIVE_USER && req.auth.status === "disabled") {
      return next(new ApiError(403, "Account is disabled", "ACCOUNT_DISABLED"));
    }
    return next();
  };
};
