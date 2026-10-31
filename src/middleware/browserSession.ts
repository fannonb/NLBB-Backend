import type { NextFunction, Request, Response } from "express";
import { allowedOrigins, env } from "../config/env";
import { ApiError } from "../utils/apiError";

const ACCESS_COOKIE = "nlbb_access";
const REFRESH_COOKIE = "nlbb_refresh";
const secure = env.APP_ENV === "production" || env.NODE_ENV === "production" || env.APP_BASE_URL.startsWith("https:");
const cookieOptions = { httpOnly: true, secure, sameSite: secure ? "none" as const : "lax" as const, path: "/api" };

export const readSessionCookie = (req: Request, name: "access" | "refresh") => {
  const key = name === "access" ? ACCESS_COOKIE : REFRESH_COOKIE;
  const value = req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${key}=`));
  if (!value) return undefined;
  try { return decodeURIComponent(value.slice(key.length + 1)); } catch { return undefined; }
};

export const isBrowserSession = (req: Request) => req.headers["x-nlbb-client"] === "web";

export const clearBrowserSession = (res: Response) => {
  res.clearCookie(ACCESS_COOKIE, cookieOptions);
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
};

export const sessionResponse = <T extends { accessToken: string; refreshToken: string; expiresIn: number }>(req: Request, res: Response, session: T) => {
  res.setHeader("Cache-Control", "no-store");
  if (!isBrowserSession(req)) return session;
  res.cookie(ACCESS_COOKIE, session.accessToken, { ...cookieOptions, maxAge: session.expiresIn * 1000 });
  res.cookie(REFRESH_COOKIE, session.refreshToken, { ...cookieOptions, maxAge: 30 * 24 * 60 * 60 * 1000 });
  const { accessToken: _access, refreshToken: _refresh, ...publicSession } = session;
  return publicSession;
};

export const browserSession = (req: Request, res: Response, next: NextFunction) => {
  if (!isBrowserSession(req)) return next();
  // Requiring both a non-simple header and an exact allowed Origin protects
  // login, refresh, and all cookie-authenticated writes against CSRF.
  let origin = req.headers.origin;
  const sameOrigin = new URL(env.APP_BASE_URL).origin;
  // Browsers omit Origin on same-origin GET/HEAD requests. The forbidden
  // Sec-Fetch-Site header cannot be forged by cross-origin page JavaScript.
  if (!origin && ["GET", "HEAD"].includes(req.method) && req.headers["sec-fetch-site"] === "same-origin") {
    origin = sameOrigin;
  }
  if (!origin || (!allowedOrigins.includes(origin) && origin !== sameOrigin)) {
    return next(new ApiError(403, "Browser origin is not allowed", "FORBIDDEN_ORIGIN"));
  }
  res.setHeader("Cache-Control", "no-store");
  const token = readSessionCookie(req, "access");
  if (token && !req.headers.authorization) req.headers.authorization = `Bearer ${token}`;
  return next();
};
