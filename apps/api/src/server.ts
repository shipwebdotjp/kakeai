import { existsSync } from "node:fs";
import { join } from "node:path";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { StorageStatus, WorkerStatus } from "@kakeai/contracts";
import type { PrismaClient } from "./generated/prisma/client.ts";
import type { AppConfig } from "./config.ts";
import { sendError } from "./http/envelope.ts";
import { ApiError } from "./http/errors.ts";
import { createHealthRouter } from "./http/health.ts";
import { createAssetsRouter } from "./http/routes/assets.ts";
import { createLanguageEditionsRouter } from "./http/routes/language-editions.ts";
import { createScriptVersionsRouter } from "./http/routes/script-versions.ts";
import { createWorksRouter } from "./http/routes/works.ts";
import { getRequestId, requestIdMiddleware } from "./http/requestId.ts";
import {
  API_BASE_PATH,
  jsonAccessGuard,
  mediaAccessGuard,
  setMediaSessionCookie,
} from "./http/security.ts";
import { logger } from "./logger.ts";

const JSON_BODY_LIMIT = "8mb";

export interface AppDependencies {
  config: AppConfig;
  prisma: PrismaClient;
  mediaSessionToken: string;
  getWorkerStatus: () => WorkerStatus;
  getStorageStatus?: () => StorageStatus;
}

interface BodyParserError {
  type: string;
  limit?: number;
}

function asBodyParserError(error: unknown): BodyParserError | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const candidate = error as { type?: unknown; limit?: unknown };
  if (typeof candidate.type !== "string") {
    return undefined;
  }
  return {
    type: candidate.type,
    limit: typeof candidate.limit === "number" ? candidate.limit : undefined,
  };
}

function handleError(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(error);
    return;
  }
  const requestId = getRequestId(res);
  if (error instanceof ApiError) {
    sendError(res, error.status, error.code, error.message, requestId, error.details);
    return;
  }
  const bodyError = asBodyParserError(error);
  if (bodyError?.type === "entity.parse.failed") {
    sendError(res, 400, "MALFORMED_JSON", "リクエストのJSONを解釈できませんでした。", requestId);
    return;
  }
  if (bodyError?.type === "entity.too.large") {
    sendError(res, 413, "FILE_TOO_LARGE", "リクエストが大きすぎます。", requestId, {
      maxBytes: bodyError.limit,
    });
    return;
  }
  if (bodyError?.type === "encoding.unsupported") {
    sendError(res, 415, "UNSUPPORTED_MEDIA_TYPE", "対応していない文字コードです。", requestId);
    return;
  }
  logger.error("unhandled_request_error", {
    requestId,
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  });
  sendError(res, 500, "INTERNAL_ERROR", "予期しないエラーが発生しました。", requestId, { requestId });
}

export function createApp(dependencies: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(requestIdMiddleware);

  app.use((req, res, next) => {
    const rawSite = req.headers["sec-fetch-site"];
    const site = Array.isArray(rawSite) ? rawSite[0] : rawSite;
    const sameOrigin = site === undefined || site === "same-origin" || site === "none";
    if ((req.method === "GET" || req.method === "HEAD") && sameOrigin) {
      setMediaSessionCookie(res, dependencies.mediaSessionToken);
    }
    next();
  });

  const policy = {
    port: dependencies.config.port,
    allowedOrigins: dependencies.config.allowedOrigins,
  };

  app.use(jsonAccessGuard(policy));

  const mediaGuard = mediaAccessGuard(policy, dependencies.mediaSessionToken);

  const api = express.Router();
  api.use(express.json({ limit: JSON_BODY_LIMIT }));
  api.use(
    createHealthRouter({
      limits: dependencies.config.limits,
      getWorkerStatus: dependencies.getWorkerStatus,
      getStorageStatus: dependencies.getStorageStatus ?? (() => "ok"),
    }),
  );
  api.use(createWorksRouter(dependencies.prisma));
  api.use(createLanguageEditionsRouter(dependencies.prisma));
  api.use(createScriptVersionsRouter(dependencies.prisma));
  api.use(
    createAssetsRouter({
      prisma: dependencies.prisma,
      directories: dependencies.config.directories,
      limits: dependencies.config.limits,
      mediaGuard,
    }),
  );

  app.use(API_BASE_PATH, api);
  app.use(API_BASE_PATH, (_req, res) => {
    sendError(res, 404, "RESOURCE_NOT_FOUND", "指定されたリソースが見つかりません。", getRequestId(res));
  });

  if (existsSync(dependencies.config.webDistDir)) {
    const webDistDir = dependencies.config.webDistDir;
    logger.info("serving_web_dist", { webDistDir });
    app.use(express.static(webDistDir));
    app.get(/.*/, (req, res, next) => {
      if (!req.accepts("html")) {
        next();
        return;
      }
      res.sendFile(join(webDistDir, "index.html"), (error) => {
        if (error) {
          next();
        }
      });
    });
  }

  app.use((_req, res) => {
    sendError(res, 404, "RESOURCE_NOT_FOUND", "指定されたリソースが見つかりません。", getRequestId(res));
  });
  app.use(handleError);

  return app;
}
