import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  jobSchema,
  liveFixtureCommentsSchema,
  liveShowProfileSchema,
  type Job,
  type LiveExportFailure,
  type LiveShowProfile,
} from "@kakeai/contracts";

export interface LiveExportIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export interface RunLiveExportOptions {
  fetchImpl?: typeof fetch;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_API_URL = "http://127.0.0.1:4317";
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 1000;
const REQUEST_TIMEOUT_MS = 30_000;

class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode = 1,
    readonly details: unknown = undefined,
  ) {
    super(message);
  }
}

function usage(): string {
  return [
    "Usage: npm run live:export -- --work <workId> --script-version <scriptVersionId> --profile <show-profile.json> --out <dir>",
    "",
    "Options:",
    "  --work <id>              Work ID",
    "  --script-version <id>    ScriptVersion ID",
    "  --profile <file>         Show Profile JSON",
    "  --out <dir>              New output directory (must not exist; absolute or relative)",
    "  --timeout-ms <ms>        total polling budget (default: 1800000)",
    "  --interval-ms <ms>       polling interval (default: 1000)",
    "  --help                   show this help",
  ].join("\n");
}

function parsePositive(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new CliError("LIVE_EXPORT_CLI_USAGE", `${name} は正の整数で指定してください。`, 2);
  }
  return parsed;
}

function errorEnvelope(value: unknown): { code: string; message: string; details?: unknown } | null {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return null;
  }
  const error = (value as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  if (typeof code !== "string" || typeof message !== "string") {
    return null;
  }
  return {
    code,
    message,
    details: (error as { details?: unknown }).details,
  };
}

async function readProfile(path: string): Promise<{ profile: LiveShowProfile; fixture?: unknown }> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new CliError("LIVE_EXPORT_PROFILE_NOT_FOUND", `プロファイルを読めません: ${path}`, 1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError("LIVE_EXPORT_PROFILE_INVALID", "プロファイルのJSONが不正です。", 1);
  }
  const profile = liveShowProfileSchema.safeParse(parsed);
  if (!profile.success) {
    throw new CliError(
      "LIVE_EXPORT_PROFILE_INVALID",
      "Show Profile がスキーマに一致しません。",
      1,
      profile.error.issues,
    );
  }
  const fixturePath = profile.data.test?.fixture;
  if (fixturePath === undefined) {
    return { profile: profile.data };
  }
  const absoluteFixture = resolve(dirname(path), fixturePath);
  let fixtureRaw: string;
  try {
    fixtureRaw = await readFile(absoluteFixture, "utf8");
  } catch {
    throw new CliError(
      "LIVE_EXPORT_FIXTURE_NOT_FOUND",
      `fixture を読めません: ${absoluteFixture}`,
      1,
    );
  }
  let fixtureJson: unknown;
  try {
    fixtureJson = JSON.parse(fixtureRaw);
  } catch {
    throw new CliError("LIVE_EXPORT_FIXTURE_INVALID", "fixture のJSONが不正です。", 1);
  }
  const fixture = liveFixtureCommentsSchema.safeParse(fixtureJson);
  if (!fixture.success) {
    throw new CliError(
      "LIVE_EXPORT_FIXTURE_INVALID",
      "fixture がスキーマに一致しません。",
      1,
      fixture.error.issues,
    );
  }
  return { profile: profile.data, fixture: fixture.data };
}

function failureSummary(job: Job): LiveExportFailure[] {
  return job.liveExportResult?.failures ?? [];
}

function parseJobResponse(value: unknown): Job {
  const parsed = jobSchema.safeParse(value);
  if (!parsed.success) {
    throw new CliError(
      "LIVE_EXPORT_API_INVALID",
      "Kakeai API の Job 応答がスキーマに一致しません。",
      1,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

async function requestJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new CliError(
      "LIVE_EXPORT_API_UNAVAILABLE",
      `Kakeai API に接続できません: ${error instanceof Error ? error.message : String(error)}`,
      1,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CliError("LIVE_EXPORT_API_INVALID", "Kakeai API の応答を解釈できません。", 1);
  }
  if (!response.ok) {
    const error = errorEnvelope(body);
    if (error !== null) {
      throw new CliError(error.code, error.message, 1, error.details);
    }
    throw new CliError("LIVE_EXPORT_API_ERROR", `HTTP ${response.status}`, 1);
  }
  return body;
}

function parseArgsOrHelp(args: readonly string[]): {
  workId: string;
  scriptVersionId: string;
  profilePath: string;
  outDir: string;
  timeoutMs: number;
  intervalMs: number;
} | { help: true } {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...args],
      strict: true,
      allowPositionals: false,
      options: {
        work: { type: "string" },
        "script-version": { type: "string" },
        profile: { type: "string" },
        out: { type: "string" },
        "timeout-ms": { type: "string" },
        "interval-ms": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (error) {
    throw new CliError(
      "LIVE_EXPORT_CLI_USAGE",
      error instanceof Error ? error.message : String(error),
      2,
    );
  }
  if (values.help === true) {
    return { help: true };
  }
  for (const [name, value] of [
    ["--work", values.work],
    ["--script-version", values["script-version"]],
    ["--profile", values.profile],
    ["--out", values.out],
  ] as const) {
    if (value === undefined || value.trim().length === 0) {
      throw new CliError("LIVE_EXPORT_CLI_USAGE", `${name} は必須です。`, 2);
    }
  }
  return {
    workId: values.work!,
    scriptVersionId: values["script-version"]!,
    profilePath: values.profile!,
    outDir: values.out!,
    timeoutMs: parsePositive(values["timeout-ms"], "--timeout-ms", DEFAULT_TIMEOUT_MS),
    intervalMs: parsePositive(values["interval-ms"], "--interval-ms", DEFAULT_INTERVAL_MS),
  };
}

export async function runLiveExport(
  args: readonly string[],
  io: LiveExportIo,
  options: RunLiveExportOptions = {},
): Promise<number> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  try {
    const parsed = parseArgsOrHelp(args);
    if ("help" in parsed) {
      io.stdout(`${usage()}\n`);
      return 0;
    }
    const { profile, fixture } = await readProfile(resolve(cwd, parsed.profilePath));
    const rawBaseUrl = (env.KAKEAI_API_URL ?? DEFAULT_API_URL).trim().replace(/\/+$/, "");
    let baseUrl: string;
    try {
      const parsedUrl = new URL(rawBaseUrl);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw new Error("unsupported protocol");
      }
      baseUrl = `${parsedUrl.origin}${parsedUrl.pathname.replace(/\/+$/, "")}`;
    } catch {
      throw new CliError(
        "LIVE_EXPORT_CLI_USAGE",
        `KAKEAI_API_URL が不正です: ${rawBaseUrl}`,
        2,
      );
    }
    const created = await requestJson(fetchImpl, `${baseUrl}/api/v1/live-exports`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: new URL(baseUrl).origin,
      },
      body: JSON.stringify({
        workId: parsed.workId,
        scriptVersionId: parsed.scriptVersionId,
        profile,
        ...(fixture === undefined ? {} : { fixture }),
        outDir: resolve(cwd, parsed.outDir),
      }),
    });
    const job = parseJobResponse((created as { data?: unknown }).data);
    const deadline = Date.now() + parsed.timeoutMs;
    let latest = job;
    for (;;) {
      if (latest.status === "succeeded") {
        io.stdout(
          `${JSON.stringify({
            jobId: latest.id,
            packagePath: latest.liveExportResult?.packagePath ?? null,
            packageId: latest.liveExportResult?.packageId ?? null,
            manifestSha256: latest.liveExportResult?.manifestSha256 ?? null,
            fileCount: latest.liveExportResult?.fileCount ?? null,
            preparedCueCount: latest.liveExportResult?.preparedCueCount ?? null,
            warnings: latest.liveExportResult?.warnings ?? [],
          })}\n`,
        );
        return 0;
      }
      if (latest.status === "failed" || latest.status === "cancelled") {
        io.stderr(
          `${JSON.stringify({
            jobId: latest.id,
            status: latest.status,
            error: latest.error,
            failures: failureSummary(latest),
          })}\n`,
        );
        return 1;
      }
      if (Date.now() >= deadline) {
        throw new CliError(
          "LIVE_EXPORT_TIMEOUT",
          `Job の完了を待てませんでした: ${latest.id}`,
          1,
        );
      }
      await sleep(parsed.intervalMs);
      let fetched: unknown;
      try {
        fetched = await requestJson(
          fetchImpl,
          `${baseUrl}/api/v1/jobs/${encodeURIComponent(latest.id)}`,
          { method: "GET" },
        );
      } catch (error) {
        if (
          error instanceof CliError &&
          (error.code === "LIVE_EXPORT_API_UNAVAILABLE" ||
            error.code === "LIVE_EXPORT_API_INVALID" ||
            error.code === "LIVE_EXPORT_API_ERROR" ||
            error.code === "INTERNAL_ERROR" ||
            error.code === "DATABASE_BUSY") &&
          Date.now() < deadline
        ) {
          continue;
        }
        throw error;
      }
      latest = parseJobResponse((fetched as { data?: unknown }).data);
    }
  } catch (error) {
    if (error instanceof CliError) {
      io.stderr(
        `${JSON.stringify({
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        })}\n`,
      );
      return error.exitCode;
    }
    io.stderr(
      `${JSON.stringify({
        code: "LIVE_EXPORT_INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error),
      })}\n`,
    );
    return 1;
  }
}
