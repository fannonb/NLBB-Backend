import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";

export const requestContext = (req: Request, res: Response, next: NextFunction) => {
  const requestId = randomUUID();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
};
