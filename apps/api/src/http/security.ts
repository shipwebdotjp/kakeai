import { randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ApiError } from "./errors.ts";

export const API_BASE_PATH = "/api/v1";
export const MEDIA_SESSION_COOKIE = "Kakeai-Media-Session";
export const MEDIA_SESSION_PATH = "/api/v1/";

export interface AccessContext {
  hostHeader: string | undefined;
  origin: string | undefined;
  secFetchSite: string | undefined;
  method: string;
  cookieHeader?: string | undefined;
}

export interface AccessPolicy {
  port: number;
  allowedOrigins: ReadonlySet<string>;
}

export interface AccessDecision {
  allowed: boolean;
  reason?: string;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SAFE_FETCH_SITES = new Set(["same-origin", "none"]);

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function isLoopbackHost(hostHeader: string | undefined, port: number): boolean {
  if (hostHeader === undefined) {
    return false;
  }
  const host = hostHeader.trim().toLowerCase();
  return (
    host === `localhost:${port}` ||
    host === `127.0.0.1:${port}` ||
    host === `[::1]:${port}`
  );
}

export function evaluateJsonAccess(context: AccessContext, policy: AccessPolicy): AccessDecision {
  if (!isLoopbackHost(context.hostHeader, policy.port)) {
    return { allowed: false, reason: "host" };
  }
  const site = context.secFetchSite;
  if (site !== undefined && !SAFE_FETCH_SITES.has(site)) {
    return { allowed: false, reason: "sec-fetch-site" };
  }
  if (context.origin !== undefined && !policy.allowedOrigins.has(context.origin)) {
    return { allowed: false, reason: "origin" };
  }
  if (!SAFE_METHODS.has(context.method) && context.origin === undefined) {
    return { allowed: false, reason: "origin-required" };
  }
  return { allowed: true };
}

export function evaluateMediaAccess(
  context: AccessContext,
  policy: AccessPolicy,
  token: string,
): AccessDecision {
  if (!isLoopbackHost(context.hostHeader, policy.port)) {
    return { allowed: false, reason: "host" };
  }
  const site = context.secFetchSite;
  if (site !== undefined && site !== "same-origin") {
    return { allowed: false, reason: "sec-fetch-site" };
  }
  if (context.origin !== undefined && !policy.allowedOrigins.has(context.origin)) {
    return { allowed: false, reason: "origin" };
  }
  const presented = parseCookie(context.cookieHeader, MEDIA_SESSION_COOKIE);
  if (presented === undefined || !constantTimeEqual(presented, token)) {
    return { allowed: false, reason: "media-cookie" };
  }
  return { allowed: true };
}

export function parseCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (cookieHeader === undefined) {
    return undefined;
  }
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = part.slice(0, separator).trim();
    if (key === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function deny(): ApiError {
  return new ApiError(403, "LOCAL_ACCESS_DENIED");
}

export function jsonAccessGuard(policy: AccessPolicy): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const decision = evaluateJsonAccess(
      {
        hostHeader: req.headers.host,
        origin: req.headers.origin,
        secFetchSite: headerValue(req.headers["sec-fetch-site"]),
        method: req.method,
      },
      policy,
    );
    if (!decision.allowed) {
      next(deny());
      return;
    }
    next();
  };
}

export function mediaAccessGuard(policy: AccessPolicy, token: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const decision = evaluateMediaAccess(
      {
        hostHeader: req.headers.host,
        origin: req.headers.origin,
        secFetchSite: headerValue(req.headers["sec-fetch-site"]),
        method: req.method,
        cookieHeader: req.headers.cookie,
      },
      policy,
      token,
    );
    if (!decision.allowed) {
      next(deny());
      return;
    }
    next();
  };
}

export function generateMediaSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function setMediaSessionCookie(res: Response, token: string): void {
  res.cookie(MEDIA_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    path: MEDIA_SESSION_PATH,
    secure: false,
  });
}
