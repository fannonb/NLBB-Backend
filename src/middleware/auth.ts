import { eq } from "drizzle-orm";
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

const AUTH_CACHE_TTL_MS = 5 * 60 * 1000;
const SUPABASE_AUTH_TIMEOUT_MS = 8_000;

interface CachedAuthEntry {
  user: AuthenticatedUser;
  expiresAt: number;
}

const authCache = new Map<string, CachedAuthEntry>();
const userCache = new Map<string, CachedAuthEntry>();
const authInflight = new Map<string, Promise<AuthenticatedUser>>();

const getCachedUser = (uid: string) => {
  const cached = userCache.get(uid);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }
  return null;
};

const AUTH_CACHE_PRUNE_THRESHOLD = 5_000;

const pruneExpiredEntries = (cache: Map<string, CachedAuthEntry>, now: number) => {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
};

const rememberAuthenticatedUser = (token: string, user: AuthenticatedUser) => {
  const now = Date.now();
  if (authCache.size >= AUTH_CACHE_PRUNE_THRESHOLD) {
    pruneExpiredEntries(authCache, now);
    pruneExpiredEntries(userCache, now);
  }

  const entry = {
    user,
    expiresAt: now + AUTH_CACHE_TTL_MS,
  };
  authCache.set(token, entry);
  userCache.set(user.uid, entry);
};

// Access tokens verified locally (HS256) stay valid until they expire even after Supabase
// revokes the session, so remember logged-out sessions until their tokens expire.
// In-memory is enough for the single Render instance; a restart only re-opens tokens
// that expire within the hour anyway.
const revokedSessions = new Map<string, number>();

const isSessionRevoked = (sessionId: string | undefined) => {
  if (!sessionId) return false;
  const expiresAt = revokedSessions.get(sessionId);
  if (expiresAt === undefined) return false;
  if (expiresAt <= Date.now()) {
    revokedSessions.delete(sessionId);
    return false;
  }
  return true;
};

/** Call with a token that requireAuth already verified. */
export const revokeSessionForToken = (token: string) => {
  const claims = readVerifiedTokenClaims(token);
  if (!claims?.session_id) return;
  const expiresAt = claims.exp ? claims.exp * 1000 : Date.now() + 60 * 60 * 1000;
  revokedSessions.set(claims.session_id, expiresAt);
  forgetAccessToken(token);
};

/** Drop cached auth for a token (logout) or a user (password change, role change). */
export const forgetAccessToken = (token: string) => {
  const cached = authCache.get(token);
  authCache.delete(token);
  if (cached) {
    userCache.delete(cached.user.uid);
  }
};

export const forgetUser = (uid: string) => {
  userCache.delete(uid);
  for (const [token, entry] of authCache) {
    if (entry.user.uid === uid) {
      authCache.delete(token);
    }
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

const resolveAccessTokenUncached = async (token: string): Promise<AuthenticatedUser> => {
  if (env.SUPABASE_JWT_SECRET) {
    const claims = verifySupabaseAccessToken(token, env.SUPABASE_JWT_SECRET);
    if (claims && isSessionRevoked(claims.session_id)) {
      throw new ApiError(401, "Session has been signed out", "UNAUTHORIZED");
    }
    if (claims) {
      const cachedUser = getCachedUser(claims.sub);
      if (cachedUser) {
        return cachedUser;
      }

      return loadAuthenticatedUser(
        claims.sub,
        claims.email ?? `${claims.sub}@nlbb.local`,
        claims.session_id ?? claims.sub
      );
    }
    // Newer Supabase projects sign access tokens with ECC keys. When local HS256
    // verification fails, fall back to Supabase so auth still works.
  }

  const { data: { user: supabaseUser }, error } = await getSupabaseUserWithTimeout(token);
  if (error || !supabaseUser) {
    throw new ApiError(401, "Invalid or expired token", "UNAUTHORIZED");
  }

  let sessionId = supabaseUser.id;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) as {
      session_id?: string;
    };
    if (payload.session_id) sessionId = payload.session_id;
  } catch {
    // fall back to user id
  }

  return loadAuthenticatedUser(
    supabaseUser.id,
    supabaseUser.email ?? `${supabaseUser.id}@nlbb.local`,
    sessionId
  );
};

export const resolveAccessToken = async (authorization?: string): Promise<AuthenticatedUser> => {
  const token = extractBearerToken(authorization);
  const cached = authCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  const inflight = authInflight.get(token);
  if (inflight) {
    return inflight;
  }

  const pending = resolveAccessTokenUncached(token)
    .then((user) => {
      rememberAuthenticatedUser(token, user);
      return user;
    })
    .finally(() => {
      authInflight.delete(token);
    });

  authInflight.set(token, pending);
  return pending;
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
