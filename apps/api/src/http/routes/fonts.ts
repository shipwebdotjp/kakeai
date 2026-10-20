import { Router } from "express";
import { refreshFontCatalogRequestSchema } from "@kakeai/contracts";
import type { FontCatalogService } from "../../services/font-catalog.ts";
import { sendData, asyncHandler } from "../envelope.ts";
import { parseBody } from "../validation.ts";

export function createFontsRouter(fontCatalogService: FontCatalogService): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const catalog = await fontCatalogService.getCatalog();
      sendData(res, 200, catalog);
    }),
  );

  router.post(
    "/refresh",
    asyncHandler(async (req, res) => {
      parseBody(refreshFontCatalogRequestSchema, req.body ?? {});
      const catalog = await fontCatalogService.getCatalog(true);
      sendData(res, 200, catalog);
    }),
  );

  return router;
}
