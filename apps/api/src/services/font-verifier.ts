import { acquireBrowser, buildChromeArgs } from "@hyperframes/engine";

export interface LocalFaceVerification {
  supported: boolean;
  reason: string | null;
  verified: ReadonlySet<string>;
}

export interface FontFaceVerifier {
  verifyLocalFaces(faceNames: readonly string[]): Promise<LocalFaceVerification>;
}

const VERIFY_TIMEOUT_MS = 20_000;
const UNSUPPORTED_RETRY_MS = 60_000;

export class NoopFontVerifier implements FontFaceVerifier {
  constructor(private reason = "verifier_unavailable") {}

  async verifyLocalFaces(): Promise<LocalFaceVerification> {
    return { supported: false, reason: this.reason, verified: new Set() };
  }
}

export class FakeFontVerifier implements FontFaceVerifier {
  constructor(
    private options: {
      supported?: boolean;
      verified?: readonly string[];
      reason?: string | null;
    } = {},
  ) {}

  async verifyLocalFaces(faceNames: readonly string[]): Promise<LocalFaceVerification> {
    const supported = this.options.supported ?? true;
    if (!supported) {
      return {
        supported: false,
        reason: this.options.reason ?? "verifier_unavailable",
        verified: new Set(),
      };
    }
    const allowed = new Set(this.options.verified ?? faceNames);
    return {
      supported: true,
      reason: null,
      verified: new Set(faceNames.filter((name) => allowed.has(name))),
    };
  }
}

export function sanitizeLocalFaceName(value: string): string {
  return value.replace(/[\\'"<>{}();&\r\n\f]/g, "").trim();
}

function buildVerificationHtml(faceNames: readonly string[]): string {
  const styles = faceNames
    .map(
      (name, index) =>
        `@font-face{font-family:"kakeai-verify-${index}";src:local("${sanitizeLocalFaceName(name)}");}`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset='utf-8'><style>${styles}</style></head><body></body></html>`;
}

function probeScript(faceCount: number): string {
  return `(async () => {
    const results = {};
    for (let i = 0; i < ${faceCount}; i += 1) {
      try {
        const faces = await document.fonts.load('16px "kakeai-verify-' + i + '"');
        results[i] = faces.some((face) => face.status === "loaded");
      } catch {
        results[i] = false;
      }
    }
    return results;
  })()`;
}

export class ChromiumFontVerifier implements FontFaceVerifier {
  private queue: Promise<unknown> = Promise.resolve();
  private cache = new Map<string, boolean>();
  private unsupported: { reason: string; retryAt: number } | undefined;

  async verifyLocalFaces(faceNames: readonly string[]): Promise<LocalFaceVerification> {
    const names = [...new Set(faceNames)];
    if (names.length === 0) {
      return { supported: true, reason: null, verified: new Set() };
    }
    const run = this.queue.then(() => this.verifyUncached(names));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async verifyUncached(names: readonly string[]): Promise<LocalFaceVerification> {
    const cachedVerified = new Set(
      names.filter((name) => this.cache.get(name) === true),
    );
    const missing = names.filter((name) => !this.cache.has(name));
    if (missing.length === 0) {
      return { supported: true, reason: null, verified: cachedVerified };
    }
    if (this.unsupported !== undefined && Date.now() < this.unsupported.retryAt) {
      return {
        supported: false,
        reason: this.unsupported.reason,
        verified: cachedVerified,
      };
    }
    try {
      const verified = await this.probeFaces(missing);
      for (const name of missing) {
        this.cache.set(name, verified.has(name));
      }
      this.unsupported = undefined;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.unsupported = { reason, retryAt: Date.now() + UNSUPPORTED_RETRY_MS };
      return { supported: false, reason, verified: cachedVerified };
    }
    return {
      supported: true,
      reason: null,
      verified: new Set(names.filter((name) => this.cache.get(name) === true)),
    };
  }

  private async probeFaces(names: readonly string[]): Promise<Set<string>> {
    const lease = await acquireBrowser(buildChromeArgs({ width: 64, height: 64 }), {
      enableBrowserPool: false,
      browserTimeout: VERIFY_TIMEOUT_MS,
      protocolTimeout: VERIFY_TIMEOUT_MS,
    });
    try {
      const page = await lease.browser.newPage();
      try {
        page.setDefaultTimeout(VERIFY_TIMEOUT_MS);
        await page.setContent(buildVerificationHtml(names), { waitUntil: "load" });
        const raw = await page.evaluate(probeScript(names.length));
        const results = (raw ?? {}) as Record<string, unknown>;
        const verified = new Set<string>();
        names.forEach((name, index) => {
          if (results[String(index)] === true) {
            verified.add(name);
          }
        });
        return verified;
      } finally {
        await page.close().catch(() => undefined);
      }
    } finally {
      await lease.release().catch(() => undefined);
    }
  }
}
