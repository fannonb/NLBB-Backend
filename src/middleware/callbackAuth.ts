import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { ApiError } from "../utils/apiError";

export const verifyMpesaCallback = (req: Request, _res: Response, next: NextFunction) => {
  if (!env.MPESA_CALLBACK_SECRET) {
    return next();
  }

  const headerToken = req.headers["x-mpesa-callback-token"];
  const queryToken = typeof req.query.callbackToken === "string" ? req.query.callbackToken : undefined;
  const token = typeof headerToken === "string" ? headerToken : queryToken;

  if (!token || token !== env.MPESA_CALLBACK_SECRET) {
    return next(new ApiError(401, "Invalid callback token", "UNAUTHORIZED_CALLBACK"));
  }

  return next();
};
