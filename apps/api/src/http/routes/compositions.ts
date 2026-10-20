import { Router, type Request, type Response, type NextFunction, type RequestHandler } from "express";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { existsSync, statSync } from "node:fs";
import {
  createCompositionRequestSchema,
  updateCompositionDraftRequestSchema,
  publishCompositionRequestSchema,
} from "@kakeai/contracts";
import type { CompositionService } from "../../services/compositions.ts";
import type { CompositionAuthoringService } from "../../services/authoring-context.ts";
import { publishOrValidateComposition } from "../../services/composition-publishing.ts";
import { sendData } from "../envelope.ts";
import { parseBody } from "../validation.ts";
import { ApiError } from "../errors.ts";

export function isPathInside(baseDir: string, target: string): boolean {
  const base = resolve(baseDir);
  const resolvedTarget = resolve(target);
  if (resolvedTarget === base) {
    return true;
  }
  const rel = relative(base, resolvedTarget);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function createCompositionsRouter(
  compositionService: CompositionService,
  mediaGuard?: RequestHandler,
  authoringService?: CompositionAuthoringService,
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
      const rawBundlePath = req.params.bundlePath;
      const subpath =
        (Array.isArray(rawBundlePath) ? rawBundlePath.join("/") : rawBundlePath) || "index.html";
      const version = await compositionService.getVersionById(versionId);
      const dataDir = (compositionService as unknown as { dataDir: string }).dataDir;
      const bundleDir = resolve(join(dataDir, version.storageKey));
      const targetFile = resolve(join(bundleDir, subpath));

      if (!isPathInside(bundleDir, targetFile)) {
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
    router.get("/versions/:versionId/content/*bundlePath", mediaGuard, contentHandler);
  } else {
    router.get("/versions/:versionId/content/*bundlePath", contentHandler);
  }

  router.post("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = parseBody(createCompositionRequestSchema, req.body);
      const { authoringStyle, ...compositionInput } = body;
      let authoringSeed:
        | Awaited<ReturnType<CompositionAuthoringService["resolveSeed"]>>
        | undefined;
      if (authoringStyle !== undefined) {
        if (authoringService === undefined) {
          throw new ApiError(500, "INTERNAL_ERROR", "Composition authoring is not configured.");
        }
        authoringSeed = await authoringService.resolveSeed({
          visualTheme: authoringStyle.visualTheme,
          canvasProfile: body.canvasProfile,
        });
      }
      const composition = await compositionService.createComposition({
        ...compositionInput,
        authoringStyle: authoringSeed,
      });
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

  router.get("/:id/draft/files", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const files = await compositionService.getDraftFiles(req.params.id as string);
      sendData(res, 200, files);
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
      const compositionId = req.params.id as string;
      const rawDryRun = req.query.dryRun;
      const dryRun = Array.isArray(rawDryRun) ? rawDryRun[0] : rawDryRun;
      if (
        rawDryRun !== undefined &&
        (typeof dryRun !== "string" || (dryRun !== "true" && dryRun !== "false"))
      ) {
        throw new ApiError(422, "VALIDATION_ERROR", undefined, {
          issues: [{ path: ["dryRun"], code: "invalid_value", message: "dryRun は 'true' または 'false' を指定してください" }],
        });
      }
      const result = await publishOrValidateComposition(
        compositionService,
        authoringService,
        compositionId,
        body,
        { dryRun: dryRun === "true" },
      );
      if (result.dryRun) {
        sendData(res, 200, { manifest: result.manifest }, {
          fontDiagnostics: result.fontDiagnostics,
        });
        return;
      }
      sendData(res, 201, result.version, { fontDiagnostics: result.fontDiagnostics });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
