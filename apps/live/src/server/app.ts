import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import express, { type ErrorRequestHandler, type Response } from "express";
import type { LiveMediaType } from "@kakeai/contracts";
import {
  packageFileEntries,
  resolvePackageFilePath,
  type LoadedLivePackage,
} from "../package/loader.ts";
import { liveAccessGuard } from "./security.ts";

export interface LiveAppOptions {
  loaded: LoadedLivePackage;
  distDir: string;
  port: number;
}

const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self'",
  "frame-src 'self'",
  // The server binds 127.0.0.1, so IPv4 loopback hosts are enough. Chrome
  // rejects an IPv6 host source with a wildcard port, which would otherwise
  // disable the whole connect-src directive.
  "connect-src 'self' ws://127.0.0.1:* ws://localhost:*",
  "font-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const MATERIAL_HTML_CSP = [
  "sandbox allow-same-origin",
  "default-src 'none'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "media-src 'self'",
].join("; ");

function contentType(mediaType: LiveMediaType): string {
  switch (mediaType) {
    case "text/css":
    case "text/html":
    case "application/json":
      return `${mediaType}; charset=utf-8`;
    default:
      return mediaType;
  }
}

function sendPage(res: Response, filePath: string): void {
  if (!existsSync(filePath)) {
    res
      .status(503)
      .type("text/plain; charset=utf-8")
      .send(
        "ライブ UI がビルドされていません。`npm run live -- --package <dir>` で起動してください。",
      );
    return;
  }
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Content-Security-Policy", PAGE_CSP);
  res.sendFile(filePath);
}

export function createLiveApp(options: LiveAppOptions): express.Express {
  const app = express();
  const entries = packageFileEntries(options.loaded);
  const assetsDir = join(options.distDir, "assets");

  app.disable("x-powered-by");
  app.use(liveAccessGuard(options.port));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    next();
  });

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/stage", (_req, res) => {
    sendPage(res, join(options.distDir, "stage.html"));
  });

  app.get("/console", (_req, res) => {
    sendPage(res, join(options.distDir, "console.html"));
  });

  app.use(
    "/assets",
    (req, res, next) => {
      if (!existsSync(assetsDir)) {
        res
          .status(503)
          .type("text/plain; charset=utf-8")
          .send("ライブ UI の assets がありません。`npm run live` でビルドしてください。");
        return;
      }
      next();
    },
    express.static(assetsDir, {
      index: false,
      immutable: true,
      maxAge: "365d",
      fallthrough: false,
    }),
  );

  app.get("/package/*path", (req, res, next) => {
    void (async () => {
      const raw = (req.params as Record<string, unknown>).path;
      const relativePath = Array.isArray(raw)
        ? raw.join("/")
        : typeof raw === "string"
          ? raw
          : "";
      const entry = entries.get(relativePath);
      if (entry === undefined) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      let absolutePath: string;
      try {
        absolutePath = await resolvePackageFilePath(options.loaded, relativePath);
      } catch {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.setHeader("Content-Type", contentType(entry.mediaType));
      res.setHeader("Content-Length", String(entry.byteSize));
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      if (entry.mediaType === "text/html") {
        res.setHeader("Content-Security-Policy", MATERIAL_HTML_CSP);
      }
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const stream = createReadStream(absolutePath);
      stream.on("error", (error) => {
        if (res.headersSent) {
          res.destroy(error);
          return;
        }
        next(error);
      });
      stream.pipe(res);
    })().catch(next);
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent) {
      res.destroy(error instanceof Error ? error : undefined);
      return;
    }
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status?: unknown }).status)
        : 500;
    const resolved = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
    res.status(resolved).json({ error: resolved === 500 ? "internal_error" : "request_failed" });
  };
  app.use(errorHandler);

  return app;
}
