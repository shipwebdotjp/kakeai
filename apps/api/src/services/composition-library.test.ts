import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { appendFile, rm } from "node:fs/promises";
import {
  createInitialContentDocument,
  parseContentDocument,
  renderJobSnapshotSchema,
} from "@kakeai/contracts";
import { compileDocument } from "@kakeai/video";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import { CompositionService } from "./compositions.ts";
import { resolvePreviewCompositions } from "./script-versions.ts";
import * as jobs from "./jobs.ts";
import { FakeFontCatalogAdapter, FontCatalogService } from "./font-catalog.ts";
import * as renderJobs from "./render-jobs.ts";
import * as scriptVersions from "./script-versions.ts";
import * as works from "./works.ts";
import { dataDirectories, ensureDataDirectories } from "../storage/paths.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import { loadConfig } from "../config.ts";

describe("Composition Library Integration Tests", () => {
  const testFontCatalog = new FontCatalogService(new FakeFontCatalogAdapter());
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
    await expect(service.publish(comp.id, {})).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
      details: { issues: expect.arrayContaining([expect.objectContaining({ path: ["entrypoint"] })]) },
    });
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

  it("test 5: saved and draft previews seek a composition, render snapshot pins it", async () => {
    const comp = await service.createComposition({
      name: "Preview E2E",
      runtimeCompositionId: "cmp.test.preview-e2e",
    });
    const v1 = await service.publish(comp.id, {});
    const directories = dataDirectories(tmpDir);

    const work = await works.createWork(db, "composition preview", "ja-JP");
    const edition = work.languageEditions[0]!;

    const content = createInitialContentDocument();
    const intro = content.scenes[0]!;
    if (intro.kind !== "intro") {
      throw new Error("expected an intro scene");
    }
    intro.visualCues.push({
      id: "cue-comp-bg",
      template: { id: "composition.full-bleed", version: 1 },
      range: { kind: "scene" },
      layer: "background",
      order: 0,
      transition: { enter: { preset: "none", durationMs: 0 }, exit: { preset: "none", durationMs: 0 } },
      input: { compositionVersionId: v1.id },
    });

    const saved = await scriptVersions.saveScriptVersion(db, edition.id, {
      sourceScriptVersionId: null,
      content,
    });

    const savedPreview = await scriptVersions.getScriptVersionPreview(db, directories, saved.scriptVersion.id);
    expect(savedPreview.compositions).toHaveLength(1);
    expect(savedPreview.compositions[0]!.compositionVersionId).toBe(v1.id);
    expect(savedPreview.compositions[0]!.entryUrl).toContain(`/api/v1/compositions/versions/${v1.id}/content/`);
    expect(savedPreview.timeline.scenes.length).toBeGreaterThan(0);
    expect(savedPreview.timeline.totalDurationMs).toBeGreaterThan(0);

    const draft = await scriptVersions.createDraftPreview(db, directories, edition.id, { content });
    expect(draft.compositions).toEqual(savedPreview.compositions);
    expect(draft.timeline).toEqual(savedPreview.timeline);

    const job = await renderJobs.createRenderJob(db, saved.scriptVersion.id, testFontCatalog);
    const row = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    const snapshot = renderJobSnapshotSchema.parse(JSON.parse(row.inputSnapshotJson));
    expect(snapshot.compositionVersions).toHaveLength(1);
    expect(snapshot.compositionVersions[0]!.id).toBe(v1.id);
    expect(snapshot.compositionVersions[0]!.bundleHash).toBe(v1.bundleHash);
    expect(snapshot.compositionVersions[0]!.manifest).toEqual(v1.manifest);

    await jobs.cancelJob(db, job.id);
  });

  it("test 6: draft read-back, partial update, and manifest generation", async () => {
    const comp = await service.createComposition({
      name: "Draft API",
      runtimeCompositionId: "cmp.test.draft-api",
    });

    const seeded = await service.getDraftFiles(comp.id);
    expect(seeded.entrypoint).toBe("index.html");
    expect(seeded.files["index.html"]).toContain('data-composition-id="cmp.test.draft-api"');
    expect(seeded.files["manifest.json"]).toContain("cmp.test.draft-api");

    await service.updateDraft(comp.id, { files: { "style.css": "body{background:#000}" } });
    const afterPartial = await service.getDraftFiles(comp.id);
    expect(afterPartial.files["index.html"]).toContain("cmp.test.draft-api");
    expect(afterPartial.files["style.css"]).toBe("body{background:#000}");

    await service.updateDraft(comp.id, {
      manifest: { durationMs: 8000, dependencies: ["style.css"] },
    });
    const afterManifest = await service.getDraftFiles(comp.id);
    const manifest = JSON.parse(afterManifest.files["manifest.json"]);
    expect(manifest.durationMs).toBe(8000);
    expect(manifest.dependencies).toEqual(["style.css"]);
    expect(manifest.contentHash).toBe("draft");
  });

  it("test 7: publish returns structured issues for an invalid manifest", async () => {
    const comp = await service.createComposition({
      name: "Bad Manifest",
      runtimeCompositionId: "cmp.test.bad-manifest",
    });
    await service.updateDraft(comp.id, { files: { "manifest.json": "{}" } });

    await expect(service.publish(comp.id, {})).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({ path: ["manifest", "entrypoint"] }),
        ]),
      },
    });
  });

  it("test 8: publish rejects external URLs and a mismatched composition id", async () => {
    const comp = await service.createComposition({
      name: "External",
      runtimeCompositionId: "cmp.test.external",
    });

    await service.updateDraft(comp.id, {
      files: {
        "index.html":
          '<!doctype html><html><head><script src="https://cdn.example.com/gsap.js"></script></head><body><div data-composition-id="cmp.test.external" data-width="1920" data-height="1080" data-duration="5" data-fps="30"></div><script>window.__timelines={};window.__timelines["cmp.test.external"]={duration:5}</script></body></html>',
      },
    });
    await expect(service.publish(comp.id, {})).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
      details: {
        issues: expect.arrayContaining([expect.objectContaining({ code: "external_url" })]),
      },
    });

    await service.updateDraft(comp.id, {
      files: {
        "index.html":
          '<!doctype html><html><head><meta charset="utf-8"></head><body><div data-composition-id="cmp.wrong" data-width="1920" data-height="1080" data-duration="5" data-fps="30"></div><script>window.__timelines={};window.__timelines["cmp.wrong"]={duration:5}</script></body></html>',
      },
    });
    await expect(service.publish(comp.id, {})).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "composition_id_mismatch" }),
        ]),
      },
    });
  });

  it("test 9: publish dry-run validates without creating a version", async () => {
    const comp = await service.createComposition({
      name: "Dry Run",
      runtimeCompositionId: "cmp.test.dry-run",
    });

    const manifest = await service.validateDraft(comp.id, {});
    expect(manifest.runtimeCompositionId).toBe("cmp.test.dry-run");

    const reloaded = await service.getCompositionById(comp.id);
    expect(reloaded.versions ?? []).toHaveLength(0);

    await service.updateDraft(comp.id, { files: { "manifest.json": "{}" } });
    await expect(service.validateDraft(comp.id, {})).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
    });
  });

  it("test 10: manifest without contentHash is accepted", async () => {
    const comp = await service.createComposition({
      name: "No Hash",
      runtimeCompositionId: "cmp.test.no-hash",
    });
    await service.updateDraft(comp.id, {
      files: {
        "manifest.json": JSON.stringify({
          entrypoint: "index.html",
          runtimeCompositionId: "cmp.test.no-hash",
          width: 1920,
          height: 1080,
          durationMs: 5000,
          dependencies: [],
        }),
      },
    });
    const version = await service.publish(comp.id, {});
    expect(version.versionNumber).toBe(1);
  });

  it("test 11: rejects manifest and files['manifest.json'] together", async () => {
    const comp = await service.createComposition({
      name: "Conflict",
      runtimeCompositionId: "cmp.test.conflict",
    });
    await expect(
      service.updateDraft(comp.id, {
        manifest: { durationMs: 6000 },
        files: { "manifest.json": "{}" },
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
      details: {
        issues: expect.arrayContaining([expect.objectContaining({ code: "conflict" })]),
      },
    });
  });

  it("test 12: rejects an external URL in a declared dependency", async () => {
    const comp = await service.createComposition({
      name: "Dep URL",
      runtimeCompositionId: "cmp.test.dep-url",
    });
    await service.updateDraft(comp.id, {
      files: { "vendor/style.css": "@import url(//cdn.example.com/x.css);" },
      manifest: { dependencies: ["vendor/style.css"] },
    });
    await expect(service.publish(comp.id, {})).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "external_url", path: ["dependencies"] }),
        ]),
      },
    });
  });

  it("test 13: accepts binary draft files as base64 and sets contentHash on publish", async () => {
    const comp = await service.createComposition({
      name: "Binary",
      runtimeCompositionId: "cmp.test.binary",
    });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02]).toString(
      "base64",
    );
    await service.updateDraft(comp.id, { filesBase64: { "assets/logo.png": png } });

    const files = await service.getDraftFiles(comp.id);
    expect(files.binaryFiles?.["assets/logo.png"]).toBe(png);
    expect(files.files["assets/logo.png"]).toBeUndefined();

    const version = await service.publish(comp.id, {});
    expect(version.manifest.contentHash).toBe(version.bundleHash);

    const reloaded = await service.getVersionById(version.id);
    expect(reloaded.manifest.contentHash).toBe(version.bundleHash);
  });

  it("test 14: rejects the same path in files and filesBase64", async () => {
    const comp = await service.createComposition({
      name: "Duplicate",
      runtimeCompositionId: "cmp.test.duplicate",
    });
    await expect(
      service.updateDraft(comp.id, {
        files: { "a.txt": "x" },
        filesBase64: { "a.txt": Buffer.from("y").toString("base64") },
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
      details: {
        issues: expect.arrayContaining([expect.objectContaining({ code: "duplicate_file" })]),
      },
    });
  });

  it("test 15: rejects invalid base64", async () => {
    const comp = await service.createComposition({
      name: "Bad Base64",
      runtimeCompositionId: "cmp.test.bad-base64",
    });
    await expect(
      service.updateDraft(comp.id, { filesBase64: { "x.bin": "not base64!!" } }),
    ).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
      details: {
        issues: expect.arrayContaining([expect.objectContaining({ code: "invalid_base64" })]),
      },
    });
  });
});
