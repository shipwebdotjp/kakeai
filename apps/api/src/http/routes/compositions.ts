import { Router, type Request, type Response, type NextFunction, type RequestHandler } from "express";
import { join, resolve, sep } from "node:path";
import { existsSync, statSync } from "node:fs";
import {
  createCompositionRequestSchema,
  updateCompositionDraftRequestSchema,
  publishCompositionRequestSchema,
} from "@kakeai/contracts";
import type { CompositionService } from "../../services/compositions.ts";
import { sendData } from "../envelope.ts";
import { parseBody } from "../validation.ts";
import { ApiError } from "../errors.ts";

export function createCompositionsRouter(
  compositionService: CompositionService,
  mediaGuard?: RequestHandler,
): Router {
  const router = Router();

  router.get("/", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const list = await compositionService.listCompositions();
      sendData(res, 200, list);
    } catch (err) {
      next(err);
    }
  });

  const contentHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const versionId = req.params.versionId as string;
      const subpath = (req.params[0] as string) || "index.html";
      const version = await compositionService.getVersionById(versionId);
      const dataDir = (compositionService as unknown as { dataDir: string }).dataDir;
      const bundleDir = resolve(join(dataDir, version.storageKey));
      const targetFile = resolve(join(bundleDir, subpath));

      if (targetFile !== bundleDir && !targetFile.startsWith(bundleDir + sep)) {
        throw new ApiError(403, "LOCAL_ACCESS_DENIED", "アクセスが拒否されました");
      }

      if (!existsSync(targetFile) || !statSync(targetFile).isFile()) {
        throw new ApiError(404, "RESOURCE_NOT_FOUND", "指定されたリソースが見つかりません");
      }

      res.sendFile(targetFile);
    } catch (err) {
      next(err);
    }
  };

  if (mediaGuard) {
    router.get("/versions/:versionId/content/*", mediaGuard, contentHandler);
  } else {
    router.get("/versions/:versionId/content/*", contentHandler);
  }

  router.post("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = parseBody(createCompositionRequestSchema, req.body);
      const composition = await compositionService.createComposition(body);
      sendData(res, 201, composition);
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const composition = await compositionService.getCompositionById(req.params.id as string);
      sendData(res, 200, composition);
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/draft", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = parseBody(updateCompositionDraftRequestSchema, req.body);
      const draft = await compositionService.updateDraft(req.params.id as string, body);
      sendData(res, 200, draft);
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/publish", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = parseBody(publishCompositionRequestSchema, req.body);
      const version = await compositionService.publish(req.params.id as string, body);
      sendData(res, 201, version);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
