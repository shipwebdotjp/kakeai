import { describe, expect, it } from "vitest";
import { audioUrlForStage } from "./audio-url.ts";

describe("stage audio URLs", () => {
  it("maps package paths to /package and run audio to /run/generated", () => {
    expect(audioUrlForStage("audio/prepared/cue-1.wav")).toBe(
      "/package/audio/prepared/cue-1.wav",
    );
    expect(audioUrlForStage("run:generated/cue-1-ab12cd.wav")).toBe(
      "/run/generated/cue-1-ab12cd.wav",
    );
  });

  it("encodes segments and rejects malformed run URLs", () => {
    expect(audioUrlForStage("media/card 1.png")).toBe("/package/media/card%201.png");
    expect(() => audioUrlForStage("run:generated/../escape.wav")).toThrow();
    expect(() => audioUrlForStage("run:other/foo.wav")).toThrow();
  });
});
