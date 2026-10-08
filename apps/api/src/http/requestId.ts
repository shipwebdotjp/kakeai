import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export const REQUEST_ID_HEADER = "X-Request-Id";

export function requestIdMiddleware(_req: Request, res: Response, next: NextFunction): void {
  const requestId = `req_${randomUUID()}`;
  res.locals.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}

export function getRequestId(res: Response): string {
  const requestId = res.locals.requestId;
  return typeof requestId === "string" ? requestId : "req_unknown";
}
