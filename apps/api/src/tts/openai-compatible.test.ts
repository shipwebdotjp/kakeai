import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createOpenAiCompatibleAdapter } from "./openai-compatible.ts";
import { TtsEngineUnavailableError, TtsInputRejectedError } from "./errors.ts";

let server: Server;
let baseUrl: string;
let lastSpeechBody: Record<string, unknown> | null = null;
let speechMode: "ok" | "reject" | "fail" = "ok";
const wavBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]);

function handle(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/v1/models") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ object: "list", data: [{ id: "kokoro" }, { id: "qwen3-tts" }] }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/v1/audio/voices") {
    const model = url.searchParams.get("model");
    res.setHeader("Content-Type", "application/json");
    if (model === "kokoro") {
      res.end(JSON.stringify({ object: "list", data: [{ id: "af_heart", name: "Heart" }] }));
    } else {
      res.statusCode = 200;
      res.end(JSON.stringify({ object: "list", data: [] }));
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/audio/speech") {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        lastSpeechBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      } catch {
        lastSpeechBody = null;
      }
      if (speechMode === "reject") {
        res.statusCode = 422;
        res.end("bad input");
        return;
      }
      if (speechMode === "fail") {
        res.statusCode = 500;
        res.end("engine failure");
        return;
      }
      res.setHeader("Content-Type", "audio/wav");
      res.end(wavBytes);
    });
    return;
  }
  res.statusCode = 404;
  res.end();
}

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("mock server did not bind");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("openai-compatible adapter", () => {
  const adapter = createOpenAiCompatibleAdapter("openai-compatible");

  it("lists models from /v1/models", async () => {
    expect(await adapter.listModels!({ baseUrl })).toEqual(["kokoro", "qwen3-tts"]);
  });

  it("lists voices for the configured model", async () => {
    const listing = await adapter.listVoices({ baseUrl }, { settings: { model: "kokoro" } });
    expect(listing.voices).toEqual([{ voiceId: "af_heart", name: "Heart" }]);
    expect(listing.engineVersion).toBeNull();
  });

  it("returns no voices without a model or when the endpoint yields none", async () => {
    expect((await adapter.listVoices({ baseUrl }, { settings: null })).voices).toEqual([]);
    expect(
      (await adapter.listVoices({ baseUrl }, { settings: { model: "unknown" } })).voices,
    ).toEqual([]);
  });

  it("treats an unreachable engine as unavailable", async () => {
    await expect(adapter.listModels!({ baseUrl: "http://127.0.0.1:1" })).rejects.toBeInstanceOf(
      TtsEngineUnavailableError,
    );
    await expect(
      adapter.listVoices({ baseUrl: "http://127.0.0.1:1" }, { settings: { model: "kokoro" } }),
    ).rejects.toBeInstanceOf(TtsEngineUnavailableError);
  });

  it("synthesizes wav through /v1/audio/speech", async () => {
    speechMode = "ok";
    lastSpeechBody = null;
    const audio = await adapter.synthesize(
      { baseUrl },
      {
        text: "Hello",
        voiceId: "af_heart",
        speedScale: 1.25,
        settings: { model: "kokoro" },
      },
    );
    expect(audio.mediaType).toBe("audio/wav");
    expect(audio.data.byteLength).toBe(wavBytes.byteLength);
    expect(lastSpeechBody).toMatchObject({
      model: "kokoro",
      input: "Hello",
      voice: "af_heart",
      response_format: "wav",
      speed: 1.25,
    });
  });

  it("rejects input when the engine returns 4xx", async () => {
    speechMode = "reject";
    await expect(
      adapter.synthesize(
        { baseUrl },
        { text: "x", voiceId: "af_heart", speedScale: 1, settings: { model: "kokoro" } },
      ),
    ).rejects.toBeInstanceOf(TtsInputRejectedError);
  });

  it("treats 5xx as engine unavailable", async () => {
    speechMode = "fail";
    await expect(
      adapter.synthesize(
        { baseUrl },
        { text: "x", voiceId: "af_heart", speedScale: 1, settings: { model: "kokoro" } },
      ),
    ).rejects.toBeInstanceOf(TtsEngineUnavailableError);
    speechMode = "ok";
  });

  it("sends reference audio fields without voice in ICL mode", async () => {
    speechMode = "ok";
    lastSpeechBody = null;
    const audio = await adapter.synthesize(
      { baseUrl },
      {
        text: "こんにちは",
        voiceId: "ageha",
        speedScale: 1.25,
        settings: {
          model: "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16",
          refAudioAssetId: "asset-ref",
          refText: "仕組みはそれほど難しくないよ。",
          langCode: "Japanese",
          maxTokens: 4096,
        },
        refAudioPath: "/data/assets/ref.wav",
      },
    );
    expect(audio.mediaType).toBe("audio/wav");
    expect(lastSpeechBody).toMatchObject({
      model: "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16",
      input: "こんにちは",
      ref_audio: "/data/assets/ref.wav",
      ref_text: "仕組みはそれほど難しくないよ。",
      lang_code: "Japanese",
      max_tokens: 4096,
      response_format: "wav",
    });
    expect(lastSpeechBody).not.toHaveProperty("voice");
    expect(lastSpeechBody).not.toHaveProperty("speed");
  });

  it("sends the default max tokens when omitted in ICL mode", async () => {
    speechMode = "ok";
    lastSpeechBody = null;
    await adapter.synthesize(
      { baseUrl },
      {
        text: "こんにちは",
        voiceId: "ageha",
        speedScale: 1,
        settings: {
          model: "qwen3-tts",
          refAudioAssetId: "asset-ref",
          refText: "書き起こし",
          langCode: "Japanese",
        },
        refAudioPath: "/data/assets/ref.wav",
      },
    );
    expect(lastSpeechBody).toMatchObject({ max_tokens: 4096 });
  });

  it("rejects ICL synthesis without a resolved reference audio path", async () => {    await expect(
      adapter.synthesize(
        { baseUrl },
        {
          text: "x",
          voiceId: "ageha",
          speedScale: 1,
          settings: {
            model: "qwen3-tts",
            refAudioAssetId: "asset-ref",
            refText: "text",
            langCode: "Japanese",
          },
        },
      ),
    ).rejects.toBeInstanceOf(TtsInputRejectedError);
  });

  it("rejects synthesis without model settings", async () => {
    await expect(
      adapter.synthesize(
        { baseUrl },
        { text: "x", voiceId: "af_heart", speedScale: 1, settings: {} },
      ),
    ).rejects.toBeInstanceOf(TtsInputRejectedError);
  });
});
