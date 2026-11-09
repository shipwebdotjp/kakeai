import { describe, expect, it } from "vitest";
import { validContentDocument } from "../testing/fixtures";
import {
  importLiveMaterialRequestSchema,
  liveMaterialDurationMsSchema,
  liveMaterialFormatSchema,
  liveMaterialSnapshotSchema,
} from "./index";
import { liveResolutionMaterialSchema } from "./resolution";

const scene = validContentDocument().scenes[0]!;
const HASH = "a".repeat(64);

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    format: "png",
    durationMs: 4000,
    scene,
    assets: [],
    ...overrides,
  };
}

describe("Live Material format contract", () => {
  it("accepts PNG, HTML and MP4 snapshots with a duration", () => {
    expect(liveMaterialFormatSchema.options).toEqual(["png", "html", "mp4"]);
    for (const format of ["png", "html", "mp4"] as const) {
      expect(
        liveMaterialSnapshotSchema.parse(snapshot({ format, durationMs: 8000 })),
      ).toMatchObject({ format, durationMs: 8000 });
    }
  });

  it("requires format and duration in a stored snapshot", () => {
    expect(liveMaterialSnapshotSchema.safeParse(snapshot({ format: undefined })).success).toBe(
      false,
    );
    expect(
      liveMaterialSnapshotSchema.safeParse(snapshot({ durationMs: undefined })).success,
    ).toBe(false);
    expect(liveMaterialSnapshotSchema.safeParse(snapshot({ format: "gif" })).success).toBe(
      false,
    );
  });

  it("rejects durations outside 1..30000ms", () => {
    expect(liveMaterialDurationMsSchema.safeParse(0).success).toBe(false);
    expect(liveMaterialDurationMsSchema.safeParse(1).success).toBe(true);
    expect(liveMaterialDurationMsSchema.safeParse(30_000).success).toBe(true);
    expect(liveMaterialDurationMsSchema.safeParse(30_001).success).toBe(false);
    expect(liveMaterialDurationMsSchema.safeParse(4000.5).success).toBe(false);
  });

  it("defaults import requests to a PNG card with 4000ms", () => {
    const parsed = importLiveMaterialRequestSchema.parse({
      expectedRevision: 0,
      workId: "work-1",
      sceneId: "scene-1",
    });
    expect(parsed).toMatchObject({ format: "png", durationMs: 4000 });

    expect(
      importLiveMaterialRequestSchema.parse({
        expectedRevision: 0,
        workId: "work-1",
        sceneId: "scene-1",
        format: "mp4",
        durationMs: 2500,
      }),
    ).toMatchObject({ format: "mp4", durationMs: 2500 });

    // PNG/HTML are fixed-duration stills; the default is still accepted.
    expect(
      importLiveMaterialRequestSchema.parse({
        expectedRevision: 0,
        workId: "work-1",
        sceneId: "scene-1",
        format: "png",
        durationMs: 4000,
      }),
    ).toMatchObject({ format: "png", durationMs: 4000 });
  });

  it("rejects a custom duration for PNG and HTML import requests", () => {
    const base = {
      expectedRevision: 0,
      workId: "work-1",
      sceneId: "scene-1",
    };
    for (const format of ["png", "html"] as const) {
      expect(
        importLiveMaterialRequestSchema.safeParse({
          ...base,
          format,
          durationMs: 6000,
        }).success,
        format,
      ).toBe(false);
    }
  });

  it("rejects an invalid format or duration in an import request", () => {
    const base = {
      expectedRevision: 0,
      workId: "work-1",
      sceneId: "scene-1",
    };
    expect(
      importLiveMaterialRequestSchema.safeParse({ ...base, format: "gif" }).success,
    ).toBe(false);
    expect(
      importLiveMaterialRequestSchema.safeParse({ ...base, durationMs: 0 }).success,
    ).toBe(false);
    expect(
      importLiveMaterialRequestSchema.safeParse({ ...base, durationMs: 30_001 }).success,
    ).toBe(false);
  });

  it("requires format and duration on resolution material entries", () => {
    const base = {
      materialId: "mat-1",
      name: "素材",
      format: "html",
      durationMs: 4000,
      scene,
      assets: [],
      snapshotSha256: HASH,
      provenanceSha256: HASH,
    };
    expect(liveResolutionMaterialSchema.parse(base)).toMatchObject({
      format: "html",
      durationMs: 4000,
    });
    expect(
      liveResolutionMaterialSchema.safeParse({ ...base, format: undefined }).success,
    ).toBe(false);
    expect(
      liveResolutionMaterialSchema.safeParse({ ...base, durationMs: 30_001 }).success,
    ).toBe(false);
  });
});
