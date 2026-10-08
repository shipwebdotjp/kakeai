import type { PrismaClient } from "../generated/prisma/client.ts";

export async function applySqlitePragmas(prisma: PrismaClient): Promise<void> {
  await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
  await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 5000;");
  await prisma.$queryRawUnsafe("PRAGMA foreign_keys = ON;");
}
