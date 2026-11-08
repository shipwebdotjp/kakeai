import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  LiveVoiceProfileSnapshot,
  TtsAdapter,
  TtsSynthesisRequest,
} from "@kakeai/contracts";
import type { AppConfig } from "../config.ts";
import { dataDirectories } from "../storage/paths.ts";
import { wavFixture } from "../testing/tts-mocks.ts";
import { LiveExportError } from "./errors";
import { PackageWriter } from "./package-writer";
import type { ResolvedAssetFile, ResolvedLiveProfile } from "./profile-resolution";
import { prepareVoices } from "./prepare-voices";

let dir: string;
let config: AppConfig;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "kakeai-live-voices-"));
  config = {
    directories: dataDirectories(dir),
    voiceBaseUrls: {
      voicevox: "http://127.0.0.1:50021",
      aivisspeech: "http://127.0.0.1:10101",
      "openai-compatible": "http://127.0.0.1:8899",
    },
  } as AppConfig;
  await mkdir(config.directories.tmp, { recursive: true });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("prepareVoices", () => {
  it("copies reference audio and passes its package path to test synthesis", async () => {
    const refPath = join(dir, "ref.wav");
    await writeFile(refPath, wavFixture(1000, 440));
    const asset: ResolvedAssetFile = {
      assetId: "ref-1",
      path: refPath,
      kind: "audio",
      mediaType: "audio/wav",
      sha256: "a".repeat(64),
      byteSize: 1,
      durationMs: 1000,
      widthPx: null,
      heightPx: null,
      hasAudio: true,
    };
    const profile: LiveVoiceProfileSnapshot = {
      id: "voice-ref",
      name: "参照声",
      adapterId: "openai-compatible",
      voiceId: "ignored",
      locale: "ja-JP",
      settings: { model: "test-model", refAudioAssetId: "ref-1", langCode: "Japanese" },
    };
    const resolved: ResolvedLiveProfile = {
      cues: [],
      cutIns: [],
      speakers: [
        {
          id: "speaker-left",
          name: "左",
          side: "left",
          characterId: "char-left",
          voiceProfileId: "voice-ref",
        },
      ],
      sideBySpeakerId: new Map([["speaker-left", "left"]]),
      speakerBySide: new Map(),
    };
    const writer = new PackageWriter(join(dir, "package"));
    let captured: TtsSynthesisRequest | undefined;
    const fake: TtsAdapter = {
      id: "openai-compatible",
      listVoices: async () => ({ voices: [], engineVersion: null }),
      synthesize: async (_context, request) => {
        captured = request;
        return { data: wavFixture(500, 440), mediaType: "audio/wav" };
      },
    };

    const prepared = await prepareVoices(
      resolved,
      new Map([[profile.id, profile]]),
      new Map([["ref-1", asset]]),
      writer,
      config,
      { adapterFor: () => fake },
    );

    expect(captured?.refAudioPath).toBe(join(dir, "package", "media/voice/ref-0001.wav"));
    expect(prepared.byProfileId.get("voice-ref")?.refAudio).toBe("media/voice/ref-0001.wav");
    expect(
      (prepared.byProfileId.get("voice-ref")?.settings as Record<string, unknown>).refAudioAssetId,
    ).toBeUndefined();
    expect(prepared.manifestVoices[0]?.refAudioSha256).not.toBeNull();
  });

  it("fails the voice when test synthesis throws", async () => {
    const asset: ResolvedAssetFile = {
      assetId: "audio-1",
      path: join(dir, "missing.wav"),
      kind: "audio",
      mediaType: "audio/wav",
      sha256: "a".repeat(64),
      byteSize: 1,
      durationMs: 1000,
      widthPx: null,
      heightPx: null,
      hasAudio: true,
    };
    const profile: LiveVoiceProfileSnapshot = {
      id: "voice-1",
      name: "声",
      adapterId: "voicevox",
      voiceId: "voice-1",
      locale: "ja-JP",
      settings: {},
    };
    const resolved: ResolvedLiveProfile = {
      cues: [],
      cutIns: [],
      speakers: [
        {
          id: "speaker-left",
          name: "左",
          side: "left",
          characterId: "char-left",
          voiceProfileId: "voice-1",
        },
      ],
      sideBySpeakerId: new Map([["speaker-left", "left"]]),
      speakerBySide: new Map(),
    };
    const fake: TtsAdapter = {
      id: "voicevox",
      listVoices: async () => ({ voices: [], engineVersion: null }),
      synthesize: async () => {
        throw new Error("engine down");
      },
    };
    await expect(
      prepareVoices(
        resolved,
        new Map([[profile.id, profile]]),
        new Map([["audio-1", asset]]),
        new PackageWriter(join(dir, "package-2")),
        config,
        { adapterFor: () => fake },
      ),
    ).rejects.toBeInstanceOf(LiveExportError);
  });
});
