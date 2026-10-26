import type { PrismaClient } from "../../generated/prisma/client.ts";
import { resourceNotFound } from "../../http/validation.ts";

export async function requireEdition(prisma: PrismaClient, editionId: string) {
  const edition = await prisma.languageEdition.findUnique({
    where: { id: editionId },
  });
  if (edition === null) {
    throw resourceNotFound("language_edition", editionId);
  }
  return edition;
}
