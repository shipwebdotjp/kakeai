import type { NextFunction, Request, RequestHandler, Response } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const LOCAL_BIND_ADDRESS = "127.0.0.1";

export function allowedHosts(port: number): ReadonlySet<string> {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
}

export function allowedOrigins(port: number): ReadonlySet<string> {
  return new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
  ]);
}

export function isLoopbackHost(hostHeader: string | undefined, port: number): boolean {
  if (hostHeader === undefined) {
    return false;
  }
  return allowedHosts(port).has(hostHeader.trim().toLowerCase());
}

export function isAllowedOrigin(origin: string | undefined, port: number): boolean {
  if (origin === undefined) {
    return false;
  }
  return allowedOrigins(port).has(origin.trim());
}

export interface RequestAccess {
  host: string | undefined;
  origin: string | undefined;
  method: string;
}

export type AccessDeniedReason = "host" | "origin" | "origin-required";

export function evaluateRequestAccess(
  access: RequestAccess,
  port: number,
): AccessDeniedReason | null {
  if (!isLoopbackHost(access.host, port)) {
    return "host";
  }
  if (access.origin !== undefined && !isAllowedOrigin(access.origin, port)) {
    return "origin";
  }
  if (!SAFE_METHODS.has(access.method.toUpperCase()) && access.origin === undefined) {
    return "origin-required";
  }
  return null;
}

export interface WebSocketAccess {
  host: string | undefined;
  origin: string | undefined;
}

export function evaluateWebSocketAccess(
  access: WebSocketAccess,
  port: number,
): AccessDeniedReason | null {
  if (!isLoopbackHost(access.host, port)) {
    return "host";
  }
  if (access.origin !== undefined && !isAllowedOrigin(access.origin, port)) {
    return "origin";
  }
  return null;
}

/**
 * All HTTP routes (pages, package files and health) are loopback-only. Origin
 * is checked when present, and required for state-changing methods.
 */
export function liveAccessGuard(port: number): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const reason = evaluateRequestAccess(
      {
        host: req.headers.host,
        origin: req.headers.origin,
        method: req.method,
      },
      port,
    );
    if (reason !== null) {
      res.status(403).json({ error: "forbidden", reason });
      return;
    }
    next();
  };
}
