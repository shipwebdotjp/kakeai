import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { appendFile, rm } from "node:fs/promises";
import {
  parseContentDocument,
} from "@kakeai/contracts";
import { compileDocument } from "@kakeai/video";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import { CompositionService } from "./compositions.ts";
import { resolvePreviewCompositions } from "./script-versions.ts";
import { dataDirectories, ensureDataDirectories } from "../storage/paths.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import { loadConfig } from "../config.ts";

describe("Composition Library Integration Tests", () => {
  let tmpDir: string;
  let db: any;
  let service: CompositionService;

  beforeEach(async () => {
    tmpDir = join(process.cwd(), "tmp-test-composition-" + Math.random().toString(36).slice(2));
    process.env.KAKEAI_DATA_DIR = tmpDir;
    const config = loadConfig();
    const dirs = dataDirectories(tmpDir);
    await ensureDataDirectories(dirs);
    await runMigrations();
    db = createPrismaClient(config.databaseUrl);
    await applySqlitePragmas(db);
    service = new CompositionService({ db, dataDir: tmpDir });
  });

  afterEach(async () => {
    if (db) {
      await db.$disconnect();
    }
    delete process.env.KAKEAI_DATA_DIR;
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("test 1: Version immutability & publish workflow", async () => {
    const comp = await service.createComposition({
      name: "Test Motion",
      runtimeCompositionId: "cmp.test.motion",
    });

    const v1 = await service.publish(comp.id, {});
    expect(v1.versionNumber).toBe(1);

    await service.updateDraft(comp.id, {
      files: {
        "index.html":
          '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app" data-composition-id="cmp.test.motion" data-width="1920" data-height="1080" data-duration="6" data-fps="30"></div><script>window.__timelines = window.__timelines || {};window.__timelines["cmp.test.motion"] = { duration: 6 };</script></body></html>',
      },
    });

    const v1Reloaded = await service.getVersionById(v1.id);
    expect(v1Reloaded.bundleHash).toBe(v1.bundleHash);

    const v2 = await service.publish(comp.id, {});
    expect(v2.versionNumber).toBe(2);
    expect(v2.bundleHash).not.toBe(v1.bundleHash);

    const v3 = await service.publish(comp.id, {});
    expect(v3.versionNumber).toBe(3);
    expect(v3.storageKey).not.toBe(v2.storageKey);

    await expect(
      service.updateDraft(comp.id, { entrypoint: "../escape.html" }),
    ).rejects.toThrow();
    await expect(
      service.createComposition({
        name: "Bad Entrypoint",
        runtimeCompositionId: "cmp.test.bad-entrypoint",
        entrypoint: "../escape.html",
      }),
    ).rejects.toThrow();
  });

  it("test 1b: publish rejects lint errors", async () => {
    const comp = await service.createComposition({
      name: "Lint Gate",
      runtimeCompositionId: "cmp.test.lint-gate",
    });

    await service.updateDraft(comp.id, {
      files: {
        "index.html": "<!doctype html><html><body><p>bad</p></body></html>",
      },
    });
    await expect(service.publish(comp.id, {})).rejects.toThrow(/lint errors/);
  });

  it("test 2: ContentDocument reference validation (Background constraint & single reference)", () => {
    const doc = validContentDocument();
    doc.scenes[0]!.visualCues.push({
      id: "cue-comp-1",
      range: { kind: "scene" },
      layer: "background",
      order: 1,
      transition: { enter: { preset: "none", durationMs: 0 }, exit: { preset: "none", durationMs: 0 } },
      template: { id: "composition.full-bleed", version: 1 },
      input: { compositionVersionId: "cmpver_001" },
    });

    expect(() => parseContentDocument(doc)).not.toThrow();

    const docDup = JSON.parse(JSON.stringify(doc));
    docDup.scenes[0]!.visualCues.push({
      id: "cue-comp-2",
      range: { kind: "scene" },
      layer: "overlay",
      order: 2,
      transition: { enter: { preset: "none", durationMs: 0 }, exit: { preset: "none", durationMs: 0 } },
      template: { id: "composition.full-bleed", version: 1 },
      input: { compositionVersionId: "cmpver_001" },
    });

    expect(() => parseContentDocument(docDup)).toThrow();
  });

  it("test 3: Compiler output data-composition-src", () => {
    const doc = validContentDocument();
    doc.scenes[0]!.visualCues.push({
      id: "cue-comp-1",
      range: { kind: "scene" },
      layer: "background",
      order: 1,
      transition: { enter: { preset: "none", durationMs: 0 }, exit: { preset: "none", durationMs: 0 } },
      template: { id: "composition.full-bleed", version: 1 },
      input: { compositionVersionId: "cmpver_001" },
    });

    const compiled = compileDocument({
      document: doc,
      assetResolver: (assetId) => ({
        url: `assets/${assetId}`,
        kind: assetId === "asset-audio-1" || assetId === "asset-bgm" ? "audio" : "image",
        durationMs: 1000,
      }),
      compositionResolver: (id: string) => ({
        id,
        runtimeCompositionId: "cmp.runtime.test",
        entrypoint: "index.html",
        bundleHash: "hash123",
        storageKey: "compositions/bundles/hash123",
        manifest: {
          entrypoint: "index.html",
          contentHash: "hash123",
          runtimeCompositionId: "cmp.runtime.test",
          width: 1920,
          height: 1080,
          durationMs: 5000,
          dependencies: [],
        },
      }),
    });

    expect(compiled.html).includes('data-composition-id="cmp.runtime.test"');
    expect(compiled.html).includes('data-composition-src="index.html"');
    expect(compiled.compositionVersions).toHaveLength(1);
    expect(compiled.compositionVersions[0]!.id).toBe("cmpver_001");
  });

  it("test 4: preview composition resolution and availability errors", async () => {
    const comp = await service.createComposition({
      name: "Preview Resolve",
      runtimeCompositionId: "cmp.test.preview-resolve",
    });
    const v1 = await service.publish(comp.id, {});
    const directories = dataDirectories(tmpDir);

    const doc = validContentDocument();
    doc.scenes[0]!.visualCues.push({
      id: "cue-comp-1",
      range: { kind: "scene" },
      layer: "background",
      order: 1,
      transition: { enter: { preset: "none", durationMs: 0 }, exit: { preset: "none", durationMs: 0 } },
      template: { id: "composition.full-bleed", version: 1 },
      input: { compositionVersionId: v1.id },
    });

    const resolved = await resolvePreviewCompositions(db, directories, doc);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.compositionVersionId).toBe(v1.id);
    expect(resolved[0]!.entryUrl).toBe(
      `/api/v1/compositions/versions/${encodeURIComponent(v1.id)}/content/index.html`,
    );

    const missing = validContentDocument();
    missing.scenes[0]!.visualCues.push({
      id: "cue-comp-1",
      range: { kind: "scene" },
      layer: "background",
      order: 1,
      transition: { enter: { preset: "none", durationMs: 0 }, exit: { preset: "none", durationMs: 0 } },
      template: { id: "composition.full-bleed", version: 1 },
      input: { compositionVersionId: "cmpver_missing" },
    });
    await expect(resolvePreviewCompositions(db, directories, missing)).rejects.toMatchObject({
      status: 422,
      code: "COMPOSITION_UNAVAILABLE",
    });

    await appendFile(join(directories.root, v1.storageKey, "index.html"), "<!-- tamper -->", "utf-8");
    await expect(resolvePreviewCompositions(db, directories, doc)).rejects.toMatchObject({
      status: 422,
      code: "COMPOSITION_UNAVAILABLE",
    });
  });
});
