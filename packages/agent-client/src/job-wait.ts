import { z } from "zod";
import {
  jobSchema,
  type AgentOperationInputMap,
  type AgentOperationName,
  type AgentOperationOutputMap,
  type Job,
} from "@kakeai/contracts";

/**
 * Bounded `job.get` polling offered by the bindings as a convenience around
 * long-running operations. It is not an Agent operation: it only calls
 * `job.get`, and MCP and CLI must behave identically.
 */
export const DEFAULT_JOB_WAIT_TIMEOUT_MS = 60_000;
export const DEFAULT_JOB_WAIT_INTERVAL_MS = 500;
export const MAX_JOB_WAIT_TIMEOUT_MS = 600_000;
export const MIN_JOB_WAIT_INTERVAL_MS = 10;
export const MAX_JOB_WAIT_INTERVAL_MS = 30_000;

export const jobWaitInputSchema = z.strictObject({
  jobId: z.string().trim().min(1),
  /** Total time budget. `0` performs exactly one `job.get`. */
  timeoutMs: z
    .number()
    .int()
    .min(0)
    .max(MAX_JOB_WAIT_TIMEOUT_MS)
    .optional(),
  intervalMs: z
    .number()
    .int()
    .min(MIN_JOB_WAIT_INTERVAL_MS)
    .max(MAX_JOB_WAIT_INTERVAL_MS)
    .optional(),
});
export type JobWaitInput = z.infer<typeof jobWaitInputSchema>;

export const jobWaitResultSchema = z.strictObject({
  job: jobSchema,
  /** `true` means the budget expired while the Job was still running. */
  timedOut: z.boolean(),
  polls: z.number().int().positive(),
});
export type JobWaitResult = z.infer<typeof jobWaitResultSchema>;

export const TERMINAL_JOB_STATUSES = ["succeeded", "failed", "cancelled"] as const;

export function isTerminalJobStatus(status: Job["status"]): boolean {
  return (TERMINAL_JOB_STATUSES as readonly string[]).includes(status);
}

export interface JobWaitDependencies {
  getJob: (jobId: string) => Promise<Job>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

/** The subset of an Agent client needed to poll `job.get`. */
export interface JobPollingRequester {
  request<N extends AgentOperationName>(
    operation: N,
    input: AgentOperationInputMap[N],
  ): Promise<AgentOperationOutputMap[N]>;
}

/** Adapts an Agent client (or a typed stub) to the polling dependency. */
export function createJobGetter(requester: JobPollingRequester): (jobId: string) => Promise<Job> {
  return async (jobId) => (await requester.request("job.get", { jobId })).job;
}

/**
 * Bounded polling loop over `job.get`. One poll always happens, even with a
 * zero budget, so callers get the current status instead of an empty result.
 * Budget expiry is a successful result with `timedOut: true`, never an error.
 */
export async function waitForJob(
  input: JobWaitInput,
  dependencies: JobWaitDependencies,
): Promise<JobWaitResult> {
  const parsed = jobWaitInputSchema.parse(input);
  const timeoutMs = parsed.timeoutMs ?? DEFAULT_JOB_WAIT_TIMEOUT_MS;
  const intervalMs = parsed.intervalMs ?? DEFAULT_JOB_WAIT_INTERVAL_MS;
  const deadline = dependencies.now() + timeoutMs;

  let polls = 0;
  for (;;) {
    const job = await dependencies.getJob(parsed.jobId);
    polls += 1;
    if (isTerminalJobStatus(job.status)) {
      return { job, timedOut: false, polls };
    }
    const remaining = deadline - dependencies.now();
    if (remaining <= 0) {
      return { job, timedOut: true, polls };
    }
    await dependencies.sleep(Math.min(intervalMs, remaining));
  }
}
