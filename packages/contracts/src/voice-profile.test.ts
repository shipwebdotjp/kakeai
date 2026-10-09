import { describe, expect, it } from "vitest";
import {
  createVoiceProfileRequestSchema,
  styleIdSchema,
  voiceProfileSchema,
  voiceProfileSettingsSchemaFor,
  voiceProfileSettingsSchema,
} from "./voice-profile";

describe("styleIdSchema", () => {
  it("accepts signed 32-bit integers", () => {
    expect(styleIdSchema.safeParse(0).success).toBe(true);
    expect(styleIdSchema.safeParse(2).success).toBe(true);
    expect(styleIdSchema.safeParse(-1).success).toBe(true);
    expect(styleIdSchema.safeParse(-2147483648).success).toBe(true);
    expect(styleIdSchema.safeParse(2147483647).success).toBe(true);
  });

  it("rejects non-integers and values outside 32 bits", () => {
    expect(styleIdSchema.safeParse(1.5).success).toBe(false);
    expect(styleIdSchema.safeParse(-2147483649).success).toBe(false);
    expect(styleIdSchema.safeParse(2147483648).success).toBe(false);
  });
});

describe("voiceProfileSettingsSchema", () => {
  it("accepts the shared shape for both adapters", () => {
    const settings = { speakerUuid: "uuid-1", defaultStyleId: -1 };
    expect(voiceProfileSettingsSchema.safeParse(settings).success).toBe(true);
    expect(voiceProfileSettingsSchemaFor("voicevox").safeParse(settings).success).toBe(true);
    expect(voiceProfileSettingsSchemaFor("aivisspeech").safeParse(settings).success).toBe(true);
  });

  it("rejects unknown keys", () => {
    expect(
      voiceProfileSettingsSchema.safeParse({
        speakerUuid: "uuid-1",
        defaultStyleId: 0,
        extra: true,
      }).success,
    ).toBe(false);
  });
});

describe("createVoiceProfileRequestSchema", () => {
  it("accepts both adapter ids", () => {
    expect(
      createVoiceProfileRequestSchema.safeParse({
        name: "めたん",
        adapterId: "voicevox",
        settings: { speakerUuid: "uuid-1", defaultStyleId: 2 },
      }).success,
    ).toBe(true);
    expect(
      createVoiceProfileRequestSchema.safeParse({
        name: "Aivis",
        adapterId: "aivisspeech",
        settings: { speakerUuid: "uuid-aivis", defaultStyleId: -1 },
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown adapter id", () => {
    expect(
      createVoiceProfileRequestSchema.safeParse({
        name: "x",
        adapterId: "other",
        settings: { speakerUuid: "uuid-1", defaultStyleId: 0 },
      }).success,
    ).toBe(false);
  });
});

describe("voiceProfileSchema", () => {
  it("accepts a profile per adapter", () => {
    for (const adapterId of ["voicevox", "aivisspeech"] as const) {
      expect(
        voiceProfileSchema.safeParse({
          id: "vp_1",
          name: "ナレーター",
          adapterId,
          settings: { speakerUuid: "uuid-1", defaultStyleId: -1 },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }).success,
      ).toBe(true);
    }
  });
});
