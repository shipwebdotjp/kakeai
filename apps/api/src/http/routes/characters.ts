import { Router } from "express";
import {
  createCharacterRequestSchema,
  updateCharacterRequestSchema,
} from "@kakeai/contracts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { asyncHandler, sendData } from "../envelope.ts";
import { parseBody, pathParam } from "../validation.ts";
import * as characters from "../../services/character-library.ts";

export interface CharactersRouterDependencies {
  prisma: PrismaClient;
}

export function createCharactersRouter(dependencies: CharactersRouterDependencies): Router {
  const { prisma } = dependencies;
  const router = Router();

  router.get(
    "/characters",
    asyncHandler(async (_req, res) => {
      sendData(res, 200, await characters.listCharacters(prisma));
    }),
  );

  router.post(
    "/characters",
    asyncHandler(async (req, res) => {
      const input = parseBody(createCharacterRequestSchema, req.body);
      sendData(res, 201, await characters.createCharacter(prisma, input));
    }),
  );

  router.get(
    "/characters/:characterId",
    asyncHandler(async (req, res) => {
      sendData(res, 200, await characters.getCharacter(prisma, pathParam(req, "characterId")));
    }),
  );

  router.patch(
    "/characters/:characterId",
    asyncHandler(async (req, res) => {
      const input = parseBody(updateCharacterRequestSchema, req.body);
      sendData(
        res,
        200,
        await characters.updateCharacter(prisma, pathParam(req, "characterId"), input),
      );
    }),
  );

  router.delete(
    "/characters/:characterId",
    asyncHandler(async (req, res) => {
      await characters.deleteCharacter(prisma, pathParam(req, "characterId"));
      res.status(204).end();
    }),
  );

  return router;
}
