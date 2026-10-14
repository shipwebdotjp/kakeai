import { describe, expect, it } from "vitest";
import {
  createVoiceProfileRequestSchema,
  ttsVoiceSchema,
  voiceAdapterDescriptorFor,
  voiceAdapterDescriptors,
  voiceIdSchema,
  voiceProfileExtrasSchema,
  voiceProfileExtrasSchemaFor,
  voiceProfileSchema,
} from "./voice-profile";

describe("voiceAdapterDescriptors", () => {
  it("lists the registered adapters with loopback defaults", () => {
    expect(voiceAdapterDescriptors.map((descriptor) => descriptor.id)).toEqual([
      "voicevox",
      "aivisspeech",
      "openai-compatible",
    ]);
    for (const descriptor of voiceAdapterDescriptors) {
      expect(descriptor.defaultBaseUrl.startsWith("http://127.0.0.1:")).toBe(true);
    }
  });

  it("resolves a descriptor by id and rejects unknown ids", () => {
    expect(voiceAdapterDescriptorFor("voicevox").label).toBe("VOICEVOX");
    expect(voiceAdapterDescriptorFor("openai-compatible").voiceSelection).toBe("list-or-manual");
    expect(voiceAdapterDescriptorFor("openai-compatible").defaultLocale).toBeNull();
    expect(() => voiceAdapterDescriptorFor("other")).toThrow();
  });
});

describe("voiceIdSchema", () => {
  it("accepts opaque adapter-defined voice ids", () => {
    expect(voiceIdSchema.safeParse("uuid-1:2").success).toBe(true);
  });

  it("rejects empty ids", () => {
    expect(voiceIdSchema.safeParse("").success).toBe(false);
  });
});

describe("voiceProfileExtrasSchema", () => {
  it("accepts empty extras for the local adapters", () => {
    expect(voiceProfileExtrasSchema.safeParse({}).success).toBe(true);
    expect(voiceProfileExtrasSchemaFor("voicevox").safeParse({}).success).toBe(true);
    expect(voiceProfileExtrasSchemaFor("aivisspeech").safeParse({}).success).toBe(true);
  });

  it("requires a model for the openai-compatible adapter", () => {
    expect(voiceProfileExtrasSchemaFor("openai-compatible").safeParse({ model: "kokoro" }).success).toBe(
      true,
    );
    expect(voiceProfileExtrasSchemaFor("openai-compatible").safeParse({}).success).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(voiceProfileExtrasSchema.safeParse({ extra: true }).success).toBe(false);
  });
});

describe("ttsVoiceSchema", () => {
  it("accepts a voice with an optional declared locale", () => {
    expect(
      ttsVoiceSchema.safeParse({ voiceId: "uuid-1:2", name: "めたん ノーマル", locale: "ja-JP" })
        .success,
    ).toBe(true);
    expect(ttsVoiceSchema.safeParse({ voiceId: "uuid-1:2", name: "めたん" }).success).toBe(true);
  });
});

describe("createVoiceProfileRequestSchema", () => {
  it("accepts both adapter ids", () => {
    expect(
      createVoiceProfileRequestSchema.safeParse({
        name: "めたん",
        adapterId: "voicevox",
        voiceId: "uuid-1:2",
        locale: "ja-JP",
        settings: {},
      }).success,
    ).toBe(true);
    expect(
      createVoiceProfileRequestSchema.safeParse({
        name: "Aivis",
        adapterId: "aivisspeech",
        voiceId: "uuid-aivis:-1",
        locale: "ja-JP",
        settings: {},
      }).success,
    ).toBe(true);
    expect(
      createVoiceProfileRequestSchema.safeParse({
        name: "Kokoro",
        adapterId: "openai-compatible",
        voiceId: "af_heart",
        locale: "en-US",
        settings: { model: "kokoro" },
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown adapter id", () => {
    expect(
      createVoiceProfileRequestSchema.safeParse({
        name: "x",
        adapterId: "other",
        voiceId: "uuid-1:0",
        locale: "ja-JP",
        settings: {},
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
          voiceId: "uuid-1:2",
          locale: "ja-JP",
          settings: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }).success,
      ).toBe(true);
    }
  });
});
