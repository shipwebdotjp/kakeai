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
import { backfillCompositionScopes } from "./compositions/backfill-scope.ts";
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
      scope: "shared",
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
      scope: "shared",
        name: "Bad Entrypoint",
        runtimeCompositionId: "cmp.test.bad-entrypoint",
        entrypoint: "../escape.html",
      }),
    ).rejects.toThrow();
  });

  it("test 1b: publish rejects lint errors", async () => {
    const comp = await service.createComposition({
      scope: "shared",
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

  it("test 2: ContentDocument reference validation (Background constraint & multiple instances)", () => {
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
      layer: "background",
      order: 2,
      transition: { enter: { preset: "none", durationMs: 0 }, exit: { preset: "none", durationMs: 0 } },
      template: { id: "composition.full-bleed", version: 1 },
      input: { compositionVersionId: "cmpver_001" },
    });

    expect(() => parseContentDocument(docDup)).not.toThrow();

    const docOverlay = JSON.parse(JSON.stringify(doc));
    docOverlay.scenes[0]!.visualCues.push({
      id: "cue-comp-3",
      range: { kind: "scene" },
      layer: "overlay",
      order: 3,
      transition: { enter: { preset: "none", durationMs: 0 }, exit: { preset: "none", durationMs: 0 } },
      template: { id: "composition.full-bleed", version: 1 },
      input: { compositionVersionId: "cmpver_001" },
    });

    expect(() => parseContentDocument(docOverlay)).toThrow();
  });

  it("test 2b: save rejects a composition background starved by scene crossfade", async () => {
    const comp = await service.createComposition({
      scope: "shared",
      name: "Crossfade Window",
      runtimeCompositionId: "cmp.test.crossfade-window",
    });
    await service.updateDraft(comp.id, { manifest: { durationMs: 4500, dependencies: [] } });
    const v1 = await service.publish(comp.id, {});
    const work = await works.createWork(db, "crossfade window", "ja-JP");
    const edition = work.languageEditions[0]!;

    const backgroundCue = {
      id: "cue-comp-bg",
      template: { id: "composition.full-bleed", version: 1 },
      range: { kind: "scene" },
      layer: "background",
      order: 0,
      transition: { enter: { preset: "none", durationMs: 0 }, exit: { preset: "none", durationMs: 0 } },
      input: { compositionVersionId: v1.id },
    } as const;

    const starved = createInitialContentDocument();
    starved.scenes[0]!.visualCues.push({ ...backgroundCue });
    starved.scenes[1]!.transition = { enter: { preset: "crossfade", durationMs: 1000 } };
    await expect(
      scriptVersions.saveScriptVersion(db, edition.id, {
        sourceScriptVersionId: null,
        content: starved,
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "composition_crossfade_window_insufficient" }),
        ]),
      },
    });

    const covered = createInitialContentDocument();
    covered.scenes[0]!.visualCues.push({ ...backgroundCue });
    covered.scenes[1]!.transition = { enter: { preset: "cut", durationMs: 0 } };
    const saved = await scriptVersions.saveScriptVersion(db, edition.id, {
      sourceScriptVersionId: null,
      content: covered,
    });
    expect(saved.scriptVersion.content.scenes[0]!.visualCues).toHaveLength(3);
  });

  it("test 2c: save rejects an unknown composition version", async () => {
    const work = await works.createWork(db, "unknown composition", "ja-JP");
    const edition = work.languageEditions[0]!;
    const doc = createInitialContentDocument();
    doc.scenes[0]!.visualCues.push({
      id: "cue-comp-missing",
      template: { id: "composition.full-bleed", version: 1 },
      range: { kind: "scene" },
      layer: "background",
      order: 0,
      transition: { enter: { preset: "none", durationMs: 0 }, exit: { preset: "none", durationMs: 0 } },
      input: { compositionVersionId: "cmpver_missing" },
    });
    await expect(
      scriptVersions.saveScriptVersion(db, edition.id, {
        sourceScriptVersionId: null,
        content: doc,
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "invalid_value" }),
        ]),
      },
    });
  });

  it("test 2d: save rejects a device screen with an unknown nested composition version", async () => {
    const work = await works.createWork(db, "unknown nested", "ja-JP");
    const edition = work.languageEditions[0]!;
    const doc = createInitialContentDocument();
    doc.scenes[0]!.visualCues.push({
      id: "cue-screen-missing",
      template: { id: "scene.device-frame", version: 1 },
      range: { kind: "scene" },
      layer: "card",
      order: 0,
      transition: { enter: { preset: "none", durationMs: 0 }, exit: { preset: "none", durationMs: 0 } },
      input: {
        frame: "laptop",
        screen: { kind: "composition", compositionVersionId: "cmpver_missing", fit: "contain" },
      },
    });
    await expect(
      scriptVersions.saveScriptVersion(db, edition.id, {
        sourceScriptVersionId: null,
        content: doc,
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "invalid_value" }),
        ]),
      },
    });
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
      scope: "shared",
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
      scope: "shared",
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

  it("test 5b: nested Composition in device screens resolves, previews and pins (R2)", async () => {
    const comp = await service.createComposition({
      scope: "shared",
      name: "Nested Screen",
      runtimeCompositionId: "cmp.test.nested-screen",
    });
    const v1 = await service.publish(comp.id, {});
    const directories = dataDirectories(tmpDir);

    const work = await works.createWork(db, "nested screen", "ja-JP");
    const edition = work.languageEditions[0]!;

    const content = createInitialContentDocument();
    const intro = content.scenes[0]!;
    const noTransition = {
      enter: { preset: "none", durationMs: 0 },
      exit: { preset: "none", durationMs: 0 },
    } as const;
    intro.visualCues.push({
      id: "cue-screen-a",
      template: { id: "scene.device-frame", version: 1 },
      range: { kind: "scene" },
      layer: "background",
      order: 0,
      transition: noTransition,
      input: {
        frame: "laptop",
        screen: { kind: "composition", compositionVersionId: v1.id, fit: "contain" },
      },
    });
    intro.visualCues.push({
      id: "cue-screen-b",
      template: { id: "scene.device-frame", version: 1 },
      range: { kind: "scene" },
      layer: "card",
      order: 0,
      transition: noTransition,
      input: {
        frame: "phone",
        screen: { kind: "composition", compositionVersionId: v1.id, fit: "cover", zoom: 1.5 },
      },
    });

    const saved = await scriptVersions.saveScriptVersion(db, edition.id, {
      sourceScriptVersionId: null,
      content,
    });

    const preview = await scriptVersions.getScriptVersionPreview(
      db,
      directories,
      saved.scriptVersion.id,
    );
    expect(preview.compositions).toHaveLength(1);
    expect(preview.compositions[0]!.compositionVersionId).toBe(v1.id);
    expect(preview.compositionHtml).toContain("kakeai-compslot");
    expect(preview.compositionHtml).toContain("kakeai-compzoom");
    expect(preview.compositionHtml).toContain(
      `/api/v1/compositions/versions/${v1.id}/content/index.html`,
    );

    const job = await renderJobs.createRenderJob(db, saved.scriptVersion.id, testFontCatalog);
    const row = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    const snapshot = renderJobSnapshotSchema.parse(JSON.parse(row.inputSnapshotJson));
    expect(snapshot.compositionVersions).toHaveLength(1);
    expect(snapshot.compositionVersions[0]!.id).toBe(v1.id);
    expect(snapshot.compositionVersions[0]!.bundleHash).toBe(v1.bundleHash);

    await jobs.cancelJob(db, job.id);
  });

  it("test 6: draft read-back, partial update, and manifest generation", async () => {
    const comp = await service.createComposition({
      scope: "shared",
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
      scope: "shared",
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
      scope: "shared",
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
      scope: "shared",
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
      scope: "shared",
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
      scope: "shared",
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
      scope: "shared",
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
      scope: "shared",
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
      scope: "shared",
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
      scope: "shared",
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

  it("test 16: portrait profile seeds 1080x1920 and publishes", async () => {
    const comp = await service.createComposition({
      scope: "shared",
      name: "Portrait",
      runtimeCompositionId: "cmp.test.portrait",
      canvasProfile: "portrait",
    });

    const seeded = await service.getDraftFiles(comp.id);
    expect(seeded.files["index.html"]).toContain('data-width="1080"');
    expect(seeded.files["index.html"]).toContain('data-height="1920"');
    const seededManifest = JSON.parse(seeded.files["manifest.json"]);
    expect(seededManifest.canvasProfile).toBe("portrait");
    expect(seededManifest.width).toBe(1080);
    expect(seededManifest.height).toBe(1920);

    const version = await service.publish(comp.id, {});
    expect(version.manifest.canvasProfile).toBe("portrait");
    expect(version.manifest.width).toBe(1080);
    expect(version.manifest.height).toBe(1920);
  });

  it("test 17: publish rejects entry and manifest dimension mismatch", async () => {
    const comp = await service.createComposition({
      scope: "shared",
      name: "Dim Mismatch",
      runtimeCompositionId: "cmp.test.dim-mismatch",
    });
    await service.updateDraft(comp.id, {
      files: {
        "index.html":
          '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app" data-composition-id="cmp.test.dim-mismatch" data-width="1080" data-height="1920" data-duration="5" data-fps="30"></div><script>window.__timelines = window.__timelines || {};window.__timelines["cmp.test.dim-mismatch"] = { duration: 5 };</script></body></html>',
      },
    });
    await expect(service.publish(comp.id, {})).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "dimension_mismatch", path: ["entrypoint", "data-width"] }),
        ]),
      },
    });
  });

  it("test 18: save rejects a portrait composition in composition.full-bleed", async () => {
    const comp = await service.createComposition({
      scope: "shared",
      name: "Portrait Full Bleed",
      runtimeCompositionId: "cmp.test.portrait-full-bleed",
      canvasProfile: "portrait",
    });
    const version = await service.publish(comp.id, {});
    const work = await works.createWork(db, "portrait full bleed", "ja-JP");
    const edition = work.languageEditions[0]!;
    const content = createInitialContentDocument();
    content.scenes[0]!.visualCues.push({
      id: "cue-comp-portrait",
      template: { id: "composition.full-bleed", version: 1 },
      range: { kind: "scene" },
      layer: "background",
      order: 0,
      transition: { enter: { preset: "none", durationMs: 0 }, exit: { preset: "none", durationMs: 0 } },
      input: { compositionVersionId: version.id },
    });
    await expect(
      scriptVersions.saveScriptVersion(db, edition.id, {
        sourceScriptVersionId: null,
        content,
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "invalid_value",
            path: expect.arrayContaining(["compositionVersionId"]),
          }),
        ]),
      },
    });
  });

  it("test 19: nested portrait composition previews and pins in a device screen", async () => {
    const comp = await service.createComposition({
      scope: "shared",
      name: "Portrait Screen",
      runtimeCompositionId: "cmp.test.portrait-screen",
      canvasProfile: "portrait",
    });
    const version = await service.publish(comp.id, {});
    const directories = dataDirectories(tmpDir);
    const work = await works.createWork(db, "portrait screen", "ja-JP");
    const edition = work.languageEditions[0]!;
    const content = createInitialContentDocument();
    content.scenes[0]!.visualCues.push({
      id: "cue-screen-portrait",
      template: { id: "scene.device-frame", version: 1 },
      range: { kind: "scene" },
      layer: "background",
      order: 0,
      transition: { enter: { preset: "none", durationMs: 0 }, exit: { preset: "none", durationMs: 0 } },
      input: {
        frame: "phone",
        screen: { kind: "composition", compositionVersionId: version.id, fit: "contain" },
      },
    });

    const saved = await scriptVersions.saveScriptVersion(db, edition.id, {
      sourceScriptVersionId: null,
      content,
    });

    const preview = await scriptVersions.getScriptVersionPreview(
      db,
      directories,
      saved.scriptVersion.id,
    );
    expect(preview.compositionHtml).toContain("--kakeai-cw:1080px");
    expect(preview.compositionHtml).toContain("--kakeai-ch:1920px");
    expect(preview.compositionHtml).toContain("aspect-ratio:9/16");

    const draft = await scriptVersions.createDraftPreview(db, directories, edition.id, { content });
    expect(draft.compositionHtml).toEqual(preview.compositionHtml);

    const job = await renderJobs.createRenderJob(db, saved.scriptVersion.id, testFontCatalog);
    const row = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    const snapshot = renderJobSnapshotSchema.parse(JSON.parse(row.inputSnapshotJson));
    expect(snapshot.compositionVersions).toHaveLength(1);
    expect(snapshot.compositionVersions[0]!.manifest.canvasProfile).toBe("portrait");
    await jobs.cancelJob(db, job.id);
  });

  it("lists the candidates for a Work and keeps shared Compositions in every Work", async () => {
    const workA = await works.createWork(db, "Scope A", "ja-JP");
    const workB = await works.createWork(db, "Scope B", "ja-JP");
    const ownA = await service.createComposition({
      scope: "work",
      workId: workA.id,
      name: "Own A",
      runtimeCompositionId: "cmp.scope.own-a",
    });
    const shared = await service.createComposition({
      scope: "shared",
      name: "Shared",
      runtimeCompositionId: "cmp.scope.shared",
    });
    const ownB = await service.createComposition({
      scope: "work",
      workId: workB.id,
      name: "Own B",
      runtimeCompositionId: "cmp.scope.own-b",
    });

    const candidatesA = await service.listCompositions({ workId: workA.id });
    expect(candidatesA.map((composition) => composition.id).sort()).toEqual(
      [ownA.id, shared.id].sort(),
    );
    expect(candidatesA.find((composition) => composition.id === shared.id)?.scope).toBe(
      "shared",
    );

    const exactA = await service.listCompositions({
      workId: workA.id,
      scope: "work",
    });
    expect(exactA.map((composition) => composition.id)).toEqual([ownA.id]);

    const sharedOnly = await service.listCompositions({ scope: "shared" });
    expect(sharedOnly.map((composition) => composition.id)).toEqual([shared.id]);

    const candidatesB = await service.listCompositions({ workId: workB.id });
    expect(candidatesB.map((composition) => composition.id).sort()).toEqual(
      [ownB.id, shared.id].sort(),
    );
  });

  it("rejects a work-scoped creation without an existing Work", async () => {
    await expect(
      service.createComposition({
        scope: "work",
        workId: "work-missing",
        name: "Missing Work",
        runtimeCompositionId: "cmp.scope.missing-work",
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
    });
  });

  it("archives without invalidating the published version", async () => {
    const composition = await service.createComposition({
      scope: "shared",
      name: "Archived",
      runtimeCompositionId: "cmp.scope.archived",
    });
    const version = await service.publish(composition.id, {});

    await service.setCompositionArchived(composition.id, true);
    expect(
      (await service.listCompositions()).some((entry) => entry.id === composition.id),
    ).toBe(false);
    expect(
      (await service.listCompositions({ archived: "only" })).map((entry) => entry.id),
    ).toContain(composition.id);
    expect((await service.getVersionById(version.id)).bundleHash).toBe(version.bundleHash);

    await service.setCompositionArchived(composition.id, false);
    expect(
      (await service.listCompositions()).find((entry) => entry.id === composition.id)
        ?.archivedAt,
    ).toBeNull();
  });

  it("deletes work-owned Compositions with the Work and refuses cross-Work references", async () => {
    const directories = dataDirectories(tmpDir);
    const workA = await works.createWork(db, "Delete A", "ja-JP");
    const workB = await works.createWork(db, "Delete B", "ja-JP");
    const composition = await service.createComposition({
      scope: "work",
      workId: workA.id,
      name: "Delete Me",
      runtimeCompositionId: "cmp.scope.delete-me",
    });
    const version = await service.publish(composition.id, {});

    const content = validContentDocument();
    content.scenes[0]!.visualCues.push({
      id: "cue-cross-work",
      template: { id: "composition.full-bleed", version: 1 },
      range: { kind: "scene" },
      layer: "background",
      order: 99,
      transition: {
        enter: { preset: "none", durationMs: 0 },
        exit: { preset: "none", durationMs: 0 },
      },
      input: { compositionVersionId: version.id },
    });
    const editionB = workB.languageEditions[0]!;
    const currentB = await scriptVersions.getCurrentScriptVersion(db, editionB.id);
    await db.scriptVersion.create({
      data: {
        languageEditionId: editionB.id,
        versionNumber: currentB.versionNumber + 1,
        contentSchemaVersion: currentB.contentSchemaVersion,
        contentJson: JSON.stringify(content),
        author: "human",
      },
    });

    await expect(works.deleteWork(db, directories, workA.id)).rejects.toMatchObject({
      code: "WORK_HAS_REFERENCED_COMPOSITIONS",
    });
    expect(await db.composition.findUnique({ where: { id: composition.id } })).not.toBeNull();

    await works.deleteWork(db, directories, workB.id);
    await works.deleteWork(db, directories, workA.id);
    expect(await db.composition.findUnique({ where: { id: composition.id } })).toBeNull();
  });

  it("backfills legacy ownership from ScriptVersion references", async () => {
    const workA = await works.createWork(db, "Backfill A", "ja-JP");
    const workB = await works.createWork(db, "Backfill B", "ja-JP");
    const single = await service.createComposition({
      scope: "shared",
      name: "Single Owner",
      runtimeCompositionId: "cmp.scope.single",
    });
    const multiple = await service.createComposition({
      scope: "shared",
      name: "Multiple Owners",
      runtimeCompositionId: "cmp.scope.multiple",
    });
    const orphan = await service.createComposition({
      scope: "shared",
      name: "Orphan",
      runtimeCompositionId: "cmp.scope.orphan",
    });
    const singleVersion = await service.publish(single.id, {});
    const multipleVersion = await service.publish(multiple.id, {});

    await db.composition.updateMany({
      where: { id: { in: [single.id, multiple.id, orphan.id] } },
      data: { scope: "unclassified", workId: null },
    });

    const addReference = async (
      workId: string,
      cueId: string,
      compositionVersionId: string,
    ) => {
      const work = await db.work.findUniqueOrThrow({
        where: { id: workId },
        include: { languageEditions: true },
      });
      const edition = work.languageEditions[0]!;
      const current = await scriptVersions.getCurrentScriptVersion(db, edition.id);
      const content = validContentDocument();
      content.scenes[0]!.visualCues.push({
        id: cueId,
        template: { id: "composition.full-bleed", version: 1 },
        range: { kind: "scene" },
        layer: "background",
        order: 99,
        transition: {
          enter: { preset: "none", durationMs: 0 },
          exit: { preset: "none", durationMs: 0 },
        },
        input: { compositionVersionId },
      });
      const latest = await db.scriptVersion.aggregate({
        where: { languageEditionId: edition.id },
        _max: { versionNumber: true },
      });
      await db.scriptVersion.create({
        data: {
          languageEditionId: edition.id,
          versionNumber: (latest._max.versionNumber ?? current.versionNumber) + 1,
          contentSchemaVersion: current.contentSchemaVersion,
          contentJson: JSON.stringify(content),
          author: "human",
        },
      });
    };

    await addReference(workA.id, "cue-single", singleVersion.id);
    await addReference(workA.id, "cue-multiple-a", multipleVersion.id);
    await addReference(workB.id, "cue-multiple-b", multipleVersion.id);

    expect(await backfillCompositionScopes(db)).toBe(2);

    const singleRow = await db.composition.findUniqueOrThrow({ where: { id: single.id } });
    expect(singleRow.scope).toBe("work");
    expect(singleRow.workId).toBe(workA.id);
    const multipleRow = await db.composition.findUniqueOrThrow({
      where: { id: multiple.id },
    });
    expect(multipleRow.scope).toBe("shared");
    expect(multipleRow.workId).toBeNull();
    const orphanRow = await db.composition.findUniqueOrThrow({ where: { id: orphan.id } });
    expect(orphanRow.scope).toBe("unclassified");
    expect(orphanRow.workId).toBeNull();
  });
});
