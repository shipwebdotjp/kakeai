import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  jobSchema,
  liveFixtureCommentsSchema,
  type Job,
  type LiveExportFailure,
  type LiveFixtureComment,
} from "@kakeai/contracts";
import { CliError, parseArgsOrHelp, usage } from "./live-export-args.ts";

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
const REQUEST_TIMEOUT_MS = 30_000;

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

function failureSummary(job: Job): LiveExportFailure[] {
  return job.liveExportResult?.failures ?? [];
}

async function readFixture(path: string): Promise<LiveFixtureComment[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new CliError("LIVE_EXPORT_FIXTURE_NOT_FOUND", `fixture を読めません: ${path}`, 1);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new CliError("LIVE_EXPORT_FIXTURE_INVALID", "fixture のJSONが不正です。", 1);
  }
  const fixture = liveFixtureCommentsSchema.safeParse(json);
  if (!fixture.success) {
    throw new CliError(
      "LIVE_EXPORT_FIXTURE_INVALID",
      "fixture がスキーマに一致しません。",
      1,
      fixture.error.issues,
    );
  }
  return fixture.data;
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

    const fixture =
      parsed.fixturePath === undefined
        ? undefined
        : await readFixture(resolve(cwd, parsed.fixturePath));
    const requestBody = {
      programVersionId: parsed.programVersionId,
      outDir: resolve(cwd, parsed.outDir),
      ...(fixture === undefined ? {} : { fixture }),
    };

    const created = await requestJson(fetchImpl, `${baseUrl}/api/v1/live-exports`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: new URL(baseUrl).origin,
      },
      body: JSON.stringify(requestBody),
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
