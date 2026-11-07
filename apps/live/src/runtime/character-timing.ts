export interface BlinkTiming {
  /** Milliseconds between blinks (3–6s). */
  intervalMs: number;
  /** Milliseconds the eye layer stays closed (100–150ms). */
  durationMs: number;
}

export interface MouthTiming {
  /** Milliseconds between normal/open mouth frames (100–140ms). */
  intervalMs: number;
}

/** FNV-1a: a small deterministic seed so each character keeps its own rhythm. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function blinkTiming(seed: string): BlinkTiming {
  const hash = hashSeed(seed);
  return {
    intervalMs: 3000 + (hash % 3001),
    durationMs: 100 + ((hash >>> 12) % 51),
  };
}

export function mouthTiming(seed: string): MouthTiming {
  const hash = hashSeed(seed);
  return { intervalMs: 100 + ((hash >>> 9) % 41) };
}
