import { createHash } from "node:crypto";
import { readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  liveCardSchema,
  livePackageManifestSchema,
  livePackageShowSchema,
} from "@kakeai/contracts";
import { createTestPackage, readTestManifest, writeTestManifest } from "../testing/package-fixture.ts";
import { loadLivePackage, resolvePackageFilePath } from "./loader.ts";
import { verifyPackageContent } from "./verify.ts";

const roots: string[] = [];

async function fixture(options?: Parameters<typeof createTestPackage>[0]) {
  const pkg = await createTestPackage(options);
  roots.push(pkg.rootDir);
  return pkg;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("live package loader", () => {
  it("loads a valid package and exposes only manifest files", async () => {
    const pkg = await fixture();
    const loaded = await loadLivePackage(pkg.rootDir);
    expect(loaded.show.show.title).toBe("テスト配信");
    expect(loaded.themeCss).toContain("--kakeai-canvas");
    expect(loaded.warnings).toEqual([]);
    expect(loaded.filesByPath.get("theme.css")).toBe(join(loaded.rootDir, "theme.css"));

    const resolved = await resolvePackageFilePath(loaded, "audio/prepared/cue-opening.wav");
    expect(resolved).toBe(await realpath(join(loaded.rootDir, "audio/prepared/cue-opening.wav")));
    await expect(resolvePackageFilePath(loaded, "../manifest.json")).rejects.toMatchObject({
      code: "unsafe_path",
    });
    await expect(resolvePackageFilePath(loaded, "manifest.json")).rejects.toMatchObject({
      code: "reference_missing",
    });
  });

  it("loads a 30-minute fixture with multiple comment corners", async () => {
    const pkg = await fixture({
      includeCommentCorner: true,
      commentCorners: 2,
      targetDurationMs: 1_800_000,
      fixtureComments: [
        { atMs: 1_000, author: "みかん", text: "最初のコメント", kind: "normal" },
      ],
    });
    const loaded = await loadLivePackage(pkg.rootDir);
    expect(loaded.show.show.targetDurationMs).toBe(1_800_000);
    expect(loaded.show.segments.map((segment) => segment.kind)).toEqual([
      "opening",
      "script",
      "comment",
      "script",
      "comment",
      "closing",
    ]);
    expect(loaded.show.cues.filter((cue) => cue.origin === "script")).toHaveLength(2);
    expect(loaded.filesByPath.has("audio/prepared/cue-script-2.wav")).toBe(true);
    expect(loaded.filesByPath.has("fixtures/comments.json")).toBe(true);
  });

  it("rejects escaping paths in the manifest", async () => {
    const pkg = await fixture();
    const manifest = await readTestManifest(pkg.rootDir);
    await writeTestManifest(pkg.rootDir, {
      ...manifest,
      files: [{ ...manifest.files[0]!, path: "../outside.txt" }, ...manifest.files.slice(1)],
    });
    await expect(loadLivePackage(pkg.rootDir)).rejects.toMatchObject({ code: "invalid_manifest" });
  });

  it("rejects missing and extra files", async () => {
    const missing = await fixture();
    await rm(join(missing.rootDir, "theme.css"));
    await expect(loadLivePackage(missing.rootDir)).rejects.toMatchObject({ code: "missing_file" });

    const extra = await fixture();
    await writeFile(join(extra.rootDir, "extra.txt"), "not listed", "utf8");
    await expect(loadLivePackage(extra.rootDir)).rejects.toMatchObject({ code: "extra_file" });
  });

  it("rejects size and hash mismatches", async () => {
    const sized = await fixture();
    const sizedManifest = await readTestManifest(sized.rootDir);
    await writeTestManifest(sized.rootDir, {
      ...sizedManifest,
      files: sizedManifest.files.map((file) =>
        file.path === "theme.css" ? { ...file, byteSize: file.byteSize + 1 } : file,
      ),
    });
    await expect(loadLivePackage(sized.rootDir)).rejects.toMatchObject({ code: "size_mismatch" });

    const hashed = await fixture();
    const path = join(hashed.rootDir, "theme.css");
    const bytes = await readFile(path);
    bytes[0] = bytes[0] === 0x3a ? 0x2f : 0x3a;
    await writeFile(path, bytes);
    await expect(loadLivePackage(hashed.rootDir)).rejects.toMatchObject({ code: "hash_mismatch" });
  });

  it("verifies card assets in a v2 package", async () => {
    const pkg = await fixture();
    const card = liveCardSchema.parse({
      id: "card-headline",
      type: "headline",
      states: [{ id: "state-1", title: "今日のニュース" }],
    });
    const fallbackCue = {
      id: "cue-fallback",
      origin: "live" as const,
      speaker: "left" as const,
      caption: "少し補足します。",
      speech: "すこし ほそくします。",
      expression: "normal",
      audio: "audio/prepared/cue-fallback.wav",
      durationMs: 1000,
    };
    const show = livePackageShowSchema.parse({
      ...pkg.show,
      schemaVersion: 2,
      cues: [...pkg.show.cues, fallbackCue],
      safety: { ...pkg.show.safety, fallbackCueId: fallbackCue.id },
      cards: [card],
      cardAssets: [
        {
          id: "asset-1",
          file: "cards/asset-1.png",
          mediaType: "image/png",
          width: 1,
          height: 1,
        },
      ],
    });
    const cardAssetFile = {
      path: "cards/asset-1.png",
      sha256: "a".repeat(64),
      byteSize: 10,
      mediaType: "image/png" as const,
      kind: "card-asset" as const,
      durationMs: null,
      width: 1,
      height: 1,
      hasAudio: false,
    };
    const fallbackAudioFile = {
      path: "audio/prepared/cue-fallback.wav",
      sha256: "a".repeat(64),
      byteSize: 10,
      mediaType: "audio/wav" as const,
      kind: "prepared-audio" as const,
      durationMs: 1000,
      width: null,
      height: null,
      hasAudio: true,
    };
    const manifest = livePackageManifestSchema.parse({
      ...pkg.manifest,
      packageSchemaVersion: 2,
      source: {
        programId: "program-1",
        programVersionId: "program-version-1",
        programVersionNumber: 1,
        programDocumentSha256: "a".repeat(64),
        resolutionSnapshotSha256: "a".repeat(64),
        theme: { id: "neutral", version: 1 },
      },
      files: [...pkg.manifest.files, cardAssetFile, fallbackAudioFile],
    });

    expect(() =>
      verifyPackageContent(manifest, show, pkg.characters, new Map()),
    ).not.toThrow();

    const wrongMedia = {
      ...manifest,
      files: manifest.files.map((file) =>
        file.path === "cards/asset-1.png"
          ? { ...file, mediaType: "image/jpeg" as const }
          : file,
      ),
    };
    expect(() =>
      verifyPackageContent(wrongMedia, show, pkg.characters, new Map()),
    ).toThrow(/mediaType/);

    const missingFile = {
      ...manifest,
      files: manifest.files.filter((file) => file.path !== "cards/asset-1.png"),
    };
    expect(() =>
      verifyPackageContent(missingFile, show, pkg.characters, new Map()),
    ).toThrow(/カード画像/);
  });

  it("rejects mediaType inconsistencies and audio on material cards", async () => {
    const mismatched = await fixture();
    const manifest = await readTestManifest(mismatched.rootDir);
    await writeTestManifest(mismatched.rootDir, {
      ...manifest,
      files: manifest.files.map((file) =>
        file.path === "theme.css" ? { ...file, mediaType: "image/png" } : file,
      ),
    });
    await expect(loadLivePackage(mismatched.rootDir)).rejects.toMatchObject({
      code: "media_type_mismatch",
    });

    const audio = await fixture({ includeMaterial: true });
    const audioManifest = await readTestManifest(audio.rootDir);
    await writeTestManifest(audio.rootDir, {
      ...audioManifest,
      files: audioManifest.files.map((file) =>
        file.path === "materials/card-1.png" ? { ...file, hasAudio: true } : file,
      ),
    });
    await expect(loadLivePackage(audio.rootDir)).rejects.toMatchObject({ code: "material_audio" });
  });

  it("rejects a show that references a file outside the manifest", async () => {
    const pkg = await fixture();
    const showPath = join(pkg.rootDir, "show.json");
    const show = JSON.parse(await readFile(showPath, "utf8")) as {
      cues: { audio: string }[];
    };
    show.cues[0]!.audio = "audio/prepared/missing.wav";
    const text = `${JSON.stringify(show, null, 2)}\n`;
    await writeFile(showPath, text, "utf8");
    const manifest = await readTestManifest(pkg.rootDir);
    const digest = createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
    await writeTestManifest(pkg.rootDir, {
      ...manifest,
      files: manifest.files.map((file) =>
        file.path === "show.json"
          ? { ...file, sha256: digest, byteSize: Buffer.byteLength(text) }
          : file,
      ),
    });
    await expect(loadLivePackage(pkg.rootDir)).rejects.toMatchObject({
      code: "reference_missing",
    });
  });

  it("stops on required fonts and warns on optional fonts", async () => {
    const required = await fixture({
      fonts: [
        {
          role: "caption",
          family: "Missing Font",
          found: false,
          fallback: "sans-serif",
          required: true,
        },
      ],
    });
    await expect(loadLivePackage(required.rootDir)).rejects.toMatchObject({
      code: "required_font_missing",
    });

    const optional = await fixture({
      fonts: [
        {
          role: "title",
          family: "Missing Font",
          found: false,
          fallback: "sans-serif",
          required: false,
        },
      ],
    });
    const loaded = await loadLivePackage(optional.rootDir);
    expect(loaded.warnings).toHaveLength(1);
    expect(loaded.warnings[0]).toContain("Missing Font");
  });

  it("rejects symbolic links inside the package", async () => {
    const pkg = await fixture();
    await symlink(join(pkg.rootDir, "theme.css"), join(pkg.rootDir, "linked.css"));
    await expect(loadLivePackage(pkg.rootDir)).rejects.toMatchObject({ code: "symlink" });
  });
});
