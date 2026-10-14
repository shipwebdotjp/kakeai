import { describe, expect, it } from "vitest";
import { decodeVoicevoxVoiceId, encodeVoicevoxVoiceId } from "./voicevox-compatible.ts";
import { TtsInputRejectedError } from "./errors.ts";

describe("encodeVoicevoxVoiceId", () => {
  it("encodes a speaker and style into an opaque voice id", () => {
    expect(encodeVoicevoxVoiceId("uuid-1", 2)).toBe("uuid-1:2");
    expect(encodeVoicevoxVoiceId("uuid-aivis", -1)).toBe("uuid-aivis:-1");
  });
});

describe("decodeVoicevoxVoiceId", () => {
  it("decodes an encoded voice id", () => {
    expect(decodeVoicevoxVoiceId("uuid-1:2")).toEqual({ speakerUuid: "uuid-1", styleId: 2 });
    expect(decodeVoicevoxVoiceId("uuid-aivis:-1")).toEqual({
      speakerUuid: "uuid-aivis",
      styleId: -1,
    });
  });

  it("rejects malformed voice ids", () => {
    for (const voiceId of ["uuid-1", "uuid-1:", ":2", "", "uuid-1:2.5", "uuid-1:0x10", "uuid-1: 2"]) {
      expect(() => decodeVoicevoxVoiceId(voiceId)).toThrow(TtsInputRejectedError);
    }
  });
});
