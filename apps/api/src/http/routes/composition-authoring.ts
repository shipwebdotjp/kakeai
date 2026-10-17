import { Router, type NextFunction, type Request, type Response } from "express";
import { compositionAuthoringContextRequestSchema } from "@kakeai/contracts";
import type { CompositionAuthoringService } from "../../services/authoring-context.ts";
import { sendData } from "../envelope.ts";
import { parseBody } from "../validation.ts";

export function createCompositionAuthoringRouter(
  service: CompositionAuthoringService,
): Router {
  const router = Router();

  router.post("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = parseBody(compositionAuthoringContextRequestSchema, req.body);
      const resolved = await service.resolve(body);
      sendData(res, 200, resolved.context);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
