import type { NextFunction, Request, Response } from "express";

export type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export const asyncHandler = (fn: AsyncRoute) => {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next);
  };
};
