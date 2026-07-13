import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ApiError } from "../utils/apiError";

export const notFoundHandler = (_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: {
      code: "NOT_FOUND",
      message: "Route not found",
    },
  });
};

export const errorHandler = (error: unknown, req: Request, res: Response, _next: NextFunction) => {
  // Keep unexpected server errors visible in dev logs instead of failing silently.
  if (!(error instanceof ApiError) && !(error instanceof ZodError)) {
    // eslint-disable-next-line no-console
    console.error("[errorHandler] unexpected error", error);
  }

  if (error instanceof ApiError) {
    // eslint-disable-next-line no-console
    console.warn("[apiError]", {
      method: req.method,
      path: req.originalUrl,
      status: error.statusCode,
      code: error.code,
      message: error.message,
    });

    return res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details ?? null,
      },
    });
  }

  if (error instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: error.flatten(),
      },
    });
  }

  return res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Unexpected server error",
      details: req.originalUrl.startsWith("/api/auth")
        ? {
            name: error instanceof Error ? error.name : typeof error,
            message: error instanceof Error ? error.message : String(error),
          }
        : undefined,
    },
  });
};
