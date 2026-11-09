import { describe, expect, it } from "vitest";
import { liveFormatDocumentV1Schema } from "@kakeai/contracts";
import { materializeLiveProgramFromFormat } from "./format-materialize.ts";
import { liveFormatFixture } from "../services/live-program-test-helpers.ts";

function shortFormat() {
  const fixture = liveFormatFixture({
    characterId: "char-1",
    voiceProfileId: "voice-1",
  });
  return liveFormatDocumentV1Schema.parse({
    ...fixture,
    targetDurationMs: 130_000,
  });
}

describe("materializeLiveProgramFromFormat", () => {
  it("fails when omitting CutIn time leaves no closing reserve", () => {
    expect(() =>
      materializeLiveProgramFromFormat({
        formatId: "format-1",
        formatUpdatedAt: new Date().toISOString(),
        format: shortFormat(),
      }),
    ).toThrow(/クロージング確保尺/);
  });
});
