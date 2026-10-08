import type { NextFunction, Request, RequestHandler, Response } from "express";

export function sendData(res: Response, status: number, data: unknown, meta?: unknown): void {
  res.status(status).json(meta === undefined ? { data } : { data, meta });
}

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
): void {
  const error: { code: string; message: string; requestId: string; details?: unknown } = {
    code,
    message,
    requestId,
  };
  if (details !== undefined) {
    error.details = details;
  }
  res.status(status).json({ error });
}

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown> | unknown;

export function asyncHandler(handler: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
