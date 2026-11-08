import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LivePackageFile } from "@kakeai/contracts";
import {
  createTestPackage,
  readTestManifest,
  writeTestManifest,
} from "../testing/package-fixture.ts";
import { loadLivePackage } from "./loader.ts";

const CUT_IN_ID = "jingle-1";
const CUT_IN_PATH = `media/assets/${"d".repeat(64)}.mp4`;
const CUT_IN_BYTES = Buffer.from("cut-in fixture bytes");
const CUT_IN_DURATION_MS = 4200;

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtureWithCutIn() {
  const pkg = await createTestPackage();
  roots.push(pkg.rootDir);

  const showPath = join(pkg.rootDir, "show.json");
  const show = JSON.parse(await readFile(showPath, "utf8")) as {
    cutIns: unknown[];
    segments: unknown[];
  };
  show.cutIns = [
    {
      id: CUT_IN_ID,
      file: CUT_IN_PATH,
      durationMs: CUT_IN_DURATION_MS,
      hasAudio: true,
      width: 1920,
      height: 1080,
    },
  ];
  show.segments.splice(1, 0, {
    id: "seg-cut",
    kind: "cut_in",
    label: "コメントコーナーへ",
    cutInId: CUT_IN_ID,
  });
  const showText = `${JSON.stringify(show, null, 2)}\n`;
  await writeFile(showPath, showText, "utf8");
  const cutInPath = join(pkg.rootDir, CUT_IN_PATH);
  await mkdir(dirname(cutInPath), { recursive: true });
  await writeFile(cutInPath, CUT_IN_BYTES);

  const manifest = await readTestManifest(pkg.rootDir);
  await writeTestManifest(pkg.rootDir, {
    ...manifest,
    files: [
      ...manifest.files.map((file) =>
        file.path === "show.json"
          ? {
              ...file,
              sha256: createHash("sha256").update(Buffer.from(showText, "utf8")).digest("hex"),
              byteSize: Buffer.byteLength(showText),
            }
          : file,
      ),
      {
        path: CUT_IN_PATH,
        sha256: createHash("sha256").update(CUT_IN_BYTES).digest("hex"),
        byteSize: CUT_IN_BYTES.byteLength,
        mediaType: "video/mp4",
        kind: "cut-in",
        durationMs: CUT_IN_DURATION_MS,
        width: 1920,
        height: 1080,
        hasAudio: true,
      },
    ],
  });
  return pkg;
}

async function mutateCutInEntry(
  rootDir: string,
  mutate: (file: LivePackageFile) => LivePackageFile,
): Promise<void> {
  const manifest = await readTestManifest(rootDir);
  await writeTestManifest(rootDir, {
    ...manifest,
    files: manifest.files.map((file) => (file.path === CUT_IN_PATH ? mutate(file) : file)),
  });
}

describe("live package CutIn verification", () => {
  it("loads the shared CutIn test fixture", async () => {
    const pkg = await createTestPackage({ includeCutIn: true });
    roots.push(pkg.rootDir);

    const loaded = await loadLivePackage(pkg.rootDir);
    expect(loaded.show.cutIns).toHaveLength(1);
    expect(loaded.show.cutIns[0]).toMatchObject({
      id: "jingle-1",
      file: "media/assets/cutin.mp4",
      durationMs: 4000,
      hasAudio: true,
      width: 1920,
      height: 1080,
    });
    expect(loaded.show.segments.map((segment) => segment.kind)).toContain("cut_in");
  });

  it("loads a package with a valid cut-in manifest entry", async () => {
    const pkg = await fixtureWithCutIn();
    const loaded = await loadLivePackage(pkg.rootDir);
    expect(loaded.show.cutIns).toHaveLength(1);
    expect(loaded.show.cutIns[0]).toMatchObject({
      id: CUT_IN_ID,
      file: CUT_IN_PATH,
      durationMs: CUT_IN_DURATION_MS,
      hasAudio: true,
      width: 1920,
      height: 1080,
    });
    expect(loaded.filesByPath.has(CUT_IN_PATH)).toBe(true);
  });

  it("rejects cut-in manifest mismatches", async () => {
    const cases: Array<[string, (file: LivePackageFile) => LivePackageFile]> = [
      ["kind", (file) => ({ ...file, kind: "material" })],
      ["mediaType", (file) => ({ ...file, mediaType: "image/png" })],
      ["duration", (file) => ({ ...file, durationMs: CUT_IN_DURATION_MS - 1 })],
      ["audio", (file) => ({ ...file, hasAudio: false })],
      ["width", (file) => ({ ...file, width: 1280 })],
      ["height", (file) => ({ ...file, height: 720 })],
    ];
    for (const [label, mutate] of cases) {
      const pkg = await fixtureWithCutIn();
      await mutateCutInEntry(pkg.rootDir, mutate);
      await expect(loadLivePackage(pkg.rootDir), label).rejects.toMatchObject({
        code: "media_type_mismatch",
      });
    }
  });

  it("rejects a show CutIn whose file is missing from the manifest", async () => {
    const pkg = await fixtureWithCutIn();
    const manifest = await readTestManifest(pkg.rootDir);
    await writeTestManifest(pkg.rootDir, {
      ...manifest,
      files: manifest.files.filter((file) => file.path !== CUT_IN_PATH),
    });
    await rm(join(pkg.rootDir, CUT_IN_PATH));
    await expect(loadLivePackage(pkg.rootDir)).rejects.toMatchObject({
      code: "reference_missing",
    });
  });
});
