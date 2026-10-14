import { Router } from "express";
import {
  createThemeRequestSchema,
  previewThemeDraftRequestSchema,
  publishThemeDraftRequestSchema,
  updateThemeDraftRequestSchema,
} from "@kakeai/contracts";
import type { ThemeService } from "../../services/themes.ts";
import { compileThemeRepresentativePreview } from "../../services/theme-preview.ts";
import { sendData, asyncHandler } from "../envelope.ts";
import { parseBody, pathParam } from "../validation.ts";

export function createThemesRouter(themeService: ThemeService): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const includeArchived = req.query.includeArchived === "true";
      const themes = await themeService.listThemes(includeArchived);
      sendData(res, 200, themes);
    }),
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const body = parseBody(createThemeRequestSchema, req.body);
      const theme = await themeService.createTheme(body);
      sendData(res, 201, theme);
    }),
  );

  router.post(
    "/preview",
    asyncHandler(async (req, res) => {
      const body = parseBody(previewThemeDraftRequestSchema, req.body);
      const preview = compileThemeRepresentativePreview(body.definition);
      sendData(res, 200, preview);
    }),
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = pathParam(req, "id");
      const theme = await themeService.getTheme(id);
      sendData(res, 200, theme);
    }),
  );

  router.put(
    "/:id/draft",
    asyncHandler(async (req, res) => {
      const id = pathParam(req, "id");
      const body = parseBody(updateThemeDraftRequestSchema, req.body);
      const theme = await themeService.updateThemeDraft(id, body.definition);
      sendData(res, 200, theme);
    }),
  );

  router.delete(
    "/:id/draft",
    asyncHandler(async (req, res) => {
      const id = pathParam(req, "id");
      const theme = await themeService.discardThemeDraft(id);
      sendData(res, 200, theme);
    }),
  );

  router.post(
    "/:id/publish",
    asyncHandler(async (req, res) => {
      const id = pathParam(req, "id");
      parseBody(publishThemeDraftRequestSchema, req.body ?? {});
      const theme = await themeService.publishThemeDraft(id);
      sendData(res, 200, theme);
    }),
  );

  router.post(
    "/:id/archive",
    asyncHandler(async (req, res) => {
      const id = pathParam(req, "id");
      const theme = await themeService.archiveTheme(id);
      sendData(res, 200, theme);
    }),
  );

  return router;
}
