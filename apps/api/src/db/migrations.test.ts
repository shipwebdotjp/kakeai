import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { apiRoot } from "./migrate.ts";

const MIGRATIONS_DIR = join(apiRoot(), "prisma", "migrations");
const WORK_APPEARANCE_MIGRATION = "20261028120000_work_thumbnail_appearance";

function migrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => {
      try {
        return readFileSync(join(MIGRATIONS_DIR, name, "migration.sql")).length > 0;
      } catch {
        return false;
      }
    })
    .sort();
}

function execMigration(db: Database.Database, name: string): void {
  db.exec(readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8"));
}

function columnNames(db: Database.Database, table: string): string[] {
  return db
    .prepare(`PRAGMA table_info("${table}")`)
    .all()
    .map((row) => (row as { name: string }).name);
}

describe("Work thumbnail appearance migration", () => {
  it("discards old thumbnail data and keeps the rest of the project", () => {
    const db = new Database(":memory:");
    try {
      for (const name of migrationNames().filter((name) => name < WORK_APPEARANCE_MIGRATION)) {
        execMigration(db, name);
      }

      db.exec(`
        INSERT INTO "Work" ("id", "title", "originalLocale", "createdAt", "updatedAt")
        VALUES ('wrk_1', '作品', 'ja-JP', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

        INSERT INTO "LanguageEdition"
          ("id", "workId", "locale", "currentScriptVersionId", "primaryThumbnailId",
           "thumbnailAppearanceJson", "createdAt", "updatedAt")
        VALUES ('led_1', 'wrk_1', 'ja-JP', NULL, NULL, NULL,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

        INSERT INTO "ScriptVersion"
          ("id", "languageEditionId", "versionNumber", "contentSchemaVersion", "contentJson")
        VALUES ('sv_1', 'led_1', 1, 1, '{}');

        INSERT INTO "Asset"
          ("id", "kind", "origin", "status", "storageKey", "originalFilename",
           "mediaType", "byteSize", "sha256")
        VALUES ('ast_1', 'image', 'uploaded', 'ready', 'assets/photo.png', 'photo.png',
                'image/png', 10, 'sha');

        INSERT INTO "Thumbnail"
          ("id", "languageEditionId", "label", "schemaVersion", "templateId",
           "templateVersion", "inputJson", "updatedAt")
        VALUES ('thm_1', 'led_1', '旧候補', 2, 'thumbnail.cutout-hero', 1,
                '{"schemaVersion":2}', CURRENT_TIMESTAMP);

        INSERT INTO "ThumbnailAppearancePreset"
          ("id", "name", "appearanceJson", "updatedAt")
        VALUES ('tap_1', '旧プリセット',
                '{"headline":{"fontFace":{"family":"Legacy"}}}', CURRENT_TIMESTAMP);

        UPDATE "LanguageEdition"
          SET "currentScriptVersionId" = 'sv_1',
              "primaryThumbnailId" = 'thm_1',
              "thumbnailAppearanceJson" = '{"headline":{"fontFace":{"family":"Legacy"}}}'
          WHERE "id" = 'led_1';
      `);

      execMigration(db, WORK_APPEARANCE_MIGRATION);

      const count = (table: string): number =>
        (db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number })
          .count;
      expect(count("Thumbnail")).toBe(0);
      expect(count("ThumbnailAppearancePreset")).toBe(0);
      expect(count("Work")).toBe(1);
      expect(count("LanguageEdition")).toBe(1);
      expect(count("ScriptVersion")).toBe(1);
      expect(count("Asset")).toBe(1);

      const edition = db
        .prepare(
          'SELECT "primaryThumbnailId" AS primaryThumbnailId FROM "LanguageEdition" WHERE "id" = ?',
        )
        .get("led_1") as { primaryThumbnailId: string | null };
      expect(edition.primaryThumbnailId).toBeNull();

      expect(columnNames(db, "LanguageEdition")).not.toContain("thumbnailAppearanceJson");
      expect(columnNames(db, "Work")).toContain("thumbnailAppearanceJson");
    } finally {
      db.close();
    }
  });
});
