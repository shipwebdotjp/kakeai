import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

/**
 * Shared loopback TTS engine fixture. It speaks the Voicevox-compatible HTTP
 * protocol that both the `voicevox` and `aivisspeech` adapters use, so tests
 * do not carry their own handler copies.
 */

export interface MockTtsCounters {
  synthesis: number;
  speakers: number;
  version: number;
}

export interface MockVoicevoxStyle {
  name: string;
  id: number;
}

export interface MockVoicevoxSpeaker {
  name: string;
  speaker_uuid: string;
  styles: readonly MockVoicevoxStyle[];
}

export interface MockVoicevoxServerOptions {
  speakers: readonly MockVoicevoxSpeaker[];
  /** Audio bytes returned by POST /synthesis. */
  wav: Buffer;
  /** Body returned by POST /audio_query before the adapter sets speedScale. */
  audioQuery?: Record<string, unknown>;
  engineVersion?: string;
}

export interface MockVoicevoxServer {
  baseUrl: string;
  counters: MockTtsCounters;
  /** Last `/audio_query` target, so tests can verify the adapter's voice decoding. */
  lastSynthesisRequest: { speaker: string | null; text: string | null } | null;
  resetCounters: () => void;
  close: () => Promise<void>;
}

/**
 * A 16-bit mono PCM WAV with a sine tone, generated in-process so fixtures do
 * not depend on ffmpeg. Only the worker's ffprobe call needs an external
 * binary.
 */
export function wavFixture(durationMs: number, frequency: number): Buffer {
  const sampleRate = 24_000;
  const bytesPerSample = 2;
  const sampleCount = Math.round((durationMs / 1000) * sampleRate);
  const dataSize = sampleCount * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 8000);
    buffer.writeInt16LE(value, 44 + index * bytesPerSample);
  }
  return buffer;
}

function sendJson(res: ServerResponse, value: unknown): void {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(value));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
    req.on("aborted", () => reject(new Error("request aborted")));
  });
}

/**
 * Starts a Voicevox-compatible mock on an ephemeral loopback port. Callers own
 * the returned `close()`.
 */
export async function startMockVoicevoxServer(
  options: MockVoicevoxServerOptions,
): Promise<MockVoicevoxServer> {
  const counters: MockTtsCounters = { synthesis: 0, speakers: 0, version: 0 };
  const audioQuery = options.audioQuery ?? { speedScale: 1, accent_phrases: [] };
  let lastSynthesisRequest: MockVoicevoxServer["lastSynthesisRequest"] = null;

  const fail = (res: ServerResponse): void => {
    if (!res.writableEnded) {
      res.statusCode = 400;
      res.end();
    }
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/speakers") {
      counters.speakers += 1;
      sendJson(res, options.speakers);
      return;
    }
    if (req.method === "GET" && url.pathname === "/version") {
      counters.version += 1;
      sendJson(res, options.engineVersion ?? "0.19.0");
      return;
    }
    if (req.method === "POST" && url.pathname === "/audio_query") {
      lastSynthesisRequest = {
        speaker: url.searchParams.get("speaker"),
        text: url.searchParams.get("text"),
      };
      void readBody(req)
        .then(() => sendJson(res, audioQuery))
        .catch(() => fail(res));
      return;
    }
    if (req.method === "POST" && url.pathname === "/synthesis") {
      counters.synthesis += 1;
      void readBody(req)
        .then(() => {
          res.setHeader("Content-Type", "audio/wav");
          res.end(options.wav);
        })
        .catch(() => fail(res));
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("mock TTS server did not bind");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    counters,
    get lastSynthesisRequest() {
      return lastSynthesisRequest;
    },
    resetCounters: () => {
      counters.synthesis = 0;
      counters.speakers = 0;
      counters.version = 0;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        // Keep-alive sockets from earlier requests must not delay teardown.
        server.closeAllConnections();
      }),
  };
}
