import type { TtsAdapter, TtsSynthesisRequest } from "@kakeai/contracts";

/** Valid 8kHz mono 16-bit WAV bytes for deterministic duration tests. */
export function wavBytes(dataSize = 1600): Uint8Array {
  const sampleRate = 8000;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return new Uint8Array(buffer);
}

export interface FakeTtsOptions {
  id?: TtsAdapter["id"];
  voices?: Awaited<ReturnType<TtsAdapter["listVoices"]>>;
}

export function fakeTtsAdapter(
  synthesize: (
    request: TtsSynthesisRequest,
  ) => Promise<{ data: Uint8Array; mediaType: string }>,
  options: FakeTtsOptions = {},
): TtsAdapter {
  return {
    id: options.id ?? "voicevox",
    async listVoices() {
      return options.voices ?? { voices: [], engineVersion: null };
    },
    synthesize: (_context, request) => synthesize(request),
  };
}

export function immediateTtsAdapter(): TtsAdapter {
  return fakeTtsAdapter(async () => ({ data: wavBytes(), mediaType: "audio/wav" }));
}
