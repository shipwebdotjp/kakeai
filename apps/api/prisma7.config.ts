import { homedir } from "node:os";
import { defineConfig } from "prisma/config";
import {
  dataDirectories,
  databaseFilePath,
  resolveDataRoot,
  toSqliteUrl,
} from "./src/storage/paths.ts";

const dataRoot = resolveDataRoot(process.env, process.platform, homedir());

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: toSqliteUrl(databaseFilePath(dataDirectories(dataRoot))),
  },
});
