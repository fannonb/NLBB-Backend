import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { getDb } from "../db/client";
import { supabaseAdmin } from "../lib/supabase";
import { ensureUserFromSupabaseAuth } from "../services/userService";
import { providers, users } from "../db/schema";
import type { UserRole } from "../types/domain";
import { ApiError } from "../utils/apiError";

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

export const resolveAccessToken = async (authorization?: string): Promise<AuthenticatedUser> => {
  if (!authorization) {
    throw new ApiError(401, "Missing bearer token", "UNAUTHORIZED");
  }

  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new ApiError(401, "Missing bearer token", "UNAUTHORIZED");
  }

  const { data: { user: supabaseUser }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !supabaseUser) {
    throw new ApiError(401, "Invalid or expired token", "UNAUTHORIZED");
  }

  // Extract the Supabase session_id claim from the already-verified JWT
  let sessionId = supabaseUser.id;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) as {
      session_id?: string;
    };
    if (payload.session_id) sessionId = payload.session_id;
  } catch {
    // fall back to user id
  }

  const db = getDb();
  let [user] = await db.select().from(users).where(eq(users.id, supabaseUser.id)).limit(1);

  // First authenticated call — lazily create the app-level user row
  if (!user) {
    await ensureUserFromSupabaseAuth(supabaseUser);
    [user] = await db.select().from(users).where(eq(users.id, supabaseUser.id)).limit(1);
  }

  if (user.status === "disabled") {
    throw new ApiError(403, "Account is disabled", "ACCOUNT_DISABLED");
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
    email: user.email,
    role: user.role as UserRole,
    status: user.status as "active" | "disabled",
    sessionId,
  };
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

export const requireAuth = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    req.auth = await resolveAccessToken(req.headers.authorization);
    return next();
  } catch (error) {
    return next(error);
  }
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
