import { z } from "zod";
import { idSchema, nonNegativeInt, positiveInt, timestampSchema } from "../content/primitives";
import { liveFixtureCommentSchema } from "./comment";
import { livePackageRelativePathSchema } from "./paths";
import { stagePhaseSchema } from "./stage";

/** The port `apps/live` uses when a Run does not request one. */
export const DEFAULT_LIVE_RUN_PORT = 3010;

const absolutePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      if (!value.startsWith("/") || value === "/") {
        return false;
      }
      if (
        value.includes("\0") ||
        value.includes("\\") ||
        /%(?:2e|2f|5c)/i.test(value)
      ) {
        return false;
      }
      const segments = value.split("/").slice(1);
      return (
        segments.length >= 2 &&
        segments.every(
          (segment) => segment !== "" && segment !== "." && segment !== "..",
        )
      );
    },
    {
      message:
        ".. や空・ドットのセグメント、パーセントエンコードされた区切り文字を含まない絶対パスを指定してください",
    },
  );

/**
 * Run lifecycle. `preparing` is the creation snapshot; `launching` means the
 * detached process was spawned but the control endpoint has not answered yet.
 * `running` means the app is reachable (the show itself may still be waiting
 * for the console operator). `stopped`, `ended` and `failed` are terminal.
 */
export const liveRunStatusSchema = z.enum([
  "preparing",
  "launching",
  "running",
  "stopped",
  "failed",
  "ended",
]);
export type LiveRunStatus = z.infer<typeof liveRunStatusSchema>;

export const LIVE_RUN_TERMINAL_STATUSES = ["stopped", "failed", "ended"] as const;

export function isLiveRunTerminal(status: LiveRunStatus): boolean {
  return (LIVE_RUN_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * Allowed lifecycle edges. A reconnect must never move a terminal Run back to
 * running, and a launch is only accepted from `preparing`.
 */
const LIVE_RUN_TRANSITIONS: Record<LiveRunStatus, readonly LiveRunStatus[]> = {
  preparing: ["launching", "stopped", "failed"],
  launching: ["running", "stopped", "failed", "ended"],
  running: ["stopped", "failed", "ended"],
  stopped: [],
  failed: [],
  ended: [],
};

export function canTransitionLiveRun(from: LiveRunStatus, to: LiveRunStatus): boolean {
  return LIVE_RUN_TRANSITIONS[from].includes(to);
}

export const liveRunSourceKindSchema = z.enum(["youtube", "fixture"]);
export type LiveRunSourceKind = z.infer<typeof liveRunSourceKindSchema>;

/**
 * Frozen source stored on the Run and shown to the UI. Fixture files are
 * already copied into the Run directory; `fixtureFile` is relative to it.
 */
export const liveRunSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("youtube"),
    videoUrl: z.string().trim().min(1).max(2000).nullable(),
    liveChatId: z.string().trim().min(1).max(500).nullable(),
  }),
  z.strictObject({
    kind: z.literal("fixture"),
    fixtureFile: livePackageRelativePathSchema,
    fixtureSha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
]);
export type LiveRunSource = z.infer<typeof liveRunSourceSchema>;

/**
 * Run creation input. A fixture is either an existing JSON file (copied into
 * the Run directory) or inline comments (written as the Run fixture file).
 */
export const liveRunSourceInputSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("youtube"),
      videoUrl: z.string().trim().min(1).max(2000).optional(),
      liveChatId: z.string().trim().min(1).max(500).optional(),
    })
    .superRefine((source, ctx) => {
      if (source.videoUrl === undefined && source.liveChatId === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["videoUrl"],
          message: "YouTube のコメントソースには videoUrl または liveChatId が必要です。",
        });
      }
    }),
  z
    .strictObject({
      kind: z.literal("fixture"),
      fixturePath: absolutePathSchema.optional(),
      comments: z.array(liveFixtureCommentSchema).max(10000).optional(),
    })
    .superRefine((source, ctx) => {
      if (
        (source.fixturePath === undefined) === (source.comments === undefined)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["fixturePath"],
          message: "fixturePath と comments のどちらか一方を指定してください。",
        });
      }
    }),
]);
export type LiveRunSourceInput = z.infer<typeof liveRunSourceInputSchema>;

/**
 * Run config written to `<run dir>/run-config.json` and passed to apps/live.
 * It deliberately contains no credentials and no LLM/TTS endpoints.
 */
export const liveRunConfigSourceSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("youtube"),
      videoUrl: z.string().trim().min(1).max(2000).nullable(),
      liveChatId: z.string().trim().min(1).max(500).nullable(),
    })
    .superRefine((source, ctx) => {
      if (source.videoUrl === null && source.liveChatId === null) {
        ctx.addIssue({
          code: "custom",
          path: ["videoUrl"],
          message: "YouTube のコメントソースには videoUrl または liveChatId が必要です。",
        });
      }
    }),
  z.strictObject({
    kind: z.literal("fixture"),
    fixturePath: absolutePathSchema,
    fixtureSha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
]);
export type LiveRunConfigSource = z.infer<typeof liveRunConfigSourceSchema>;

export const livePackageBuildSchema = z.strictObject({
  packageId: z.string().min(1),
  manifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
  packagePath: absolutePathSchema,
});
export type LivePackageBuild = z.infer<typeof livePackageBuildSchema>;

export const liveRunConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: idSchema,
  programVersionId: idSchema,
  package: livePackageBuildSchema,
  source: liveRunConfigSourceSchema,
  startAt: timestampSchema.nullable(),
  requestedPort: positiveInt.max(65535),
});
export type LiveRunConfig = z.infer<typeof liveRunConfigSchema>;

export const createLiveRunRequestSchema = z.strictObject({
  programVersionId: idSchema,
  packageBuild: livePackageBuildSchema,
  source: liveRunSourceInputSchema,
  startAt: timestampSchema.nullable().optional(),
  requestedPort: positiveInt.max(65535).optional(),
});
export type CreateLiveRunRequest = z.infer<typeof createLiveRunRequestSchema>;

export const liveRunControlSchema = z.strictObject({
  url: z.string().min(1).nullable(),
  tokenRef: z.string().min(1).nullable(),
  pid: nonNegativeInt.nullable(),
});
export type LiveRunControl = z.infer<typeof liveRunControlSchema>;

export const liveRunFailureSchema = z.strictObject({
  code: z.string().min(1).max(100),
  message: z.string().min(1).max(2000),
});
export type LiveRunFailure = z.infer<typeof liveRunFailureSchema>;

export const liveRunStateSchema = z.strictObject({
  ready: z.boolean(),
  showStarted: z.boolean(),
  showEnded: z.boolean(),
  phase: stagePhaseSchema.nullable(),
});
export type LiveRunState = z.infer<typeof liveRunStateSchema>;

export const emptyLiveRunState = (): LiveRunState => ({
  ready: false,
  showStarted: false,
  showEnded: false,
  phase: null,
});

export const liveRunSchema = z.strictObject({
  id: idSchema,
  programVersionId: idSchema,
  packageBuild: livePackageBuildSchema,
  source: liveRunSourceSchema,
  startAt: timestampSchema.nullable(),
  requestedPort: positiveInt.max(65535),
  status: liveRunStatusSchema,
  control: liveRunControlSchema,
  /** Stable URLs for OBS and the operator console. Null before launch. */
  stageUrl: z.string().min(1).nullable(),
  consoleUrl: z.string().min(1).nullable(),
  logDir: absolutePathSchema,
  failure: liveRunFailureSchema.nullable(),
  state: liveRunStateSchema,
  launchedAt: timestampSchema.nullable(),
  endedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type LiveRun = z.infer<typeof liveRunSchema>;

export const liveRunListSchema = z.strictObject({
  items: z.array(liveRunSchema),
  limit: positiveInt,
  offset: nonNegativeInt,
  total: nonNegativeInt,
});
export type LiveRunList = z.infer<typeof liveRunListSchema>;

/** `GET /control/status` on apps/live. Never contains the control token. */
export const liveControlStatusSchema = z.strictObject({
  ok: z.literal(true),
  runId: idSchema.nullable(),
  ready: z.boolean(),
  stageUrl: z.string().min(1),
  consoleUrl: z.string().min(1),
  status: z.enum(["starting", "ready", "running", "ended", "stopped", "failed"]),
  phase: stagePhaseSchema,
  showStarted: z.boolean(),
  showEnded: z.boolean(),
  startedAt: timestampSchema.nullable(),
  failure: liveRunFailureSchema.nullable(),
});
export type LiveControlStatus = z.infer<typeof liveControlStatusSchema>;

export const liveControlStopResponseSchema = z.strictObject({
  ok: z.literal(true),
  status: z.literal("stopped"),
});
export type LiveControlStopResponse = z.infer<
  typeof liveControlStopResponseSchema
>;
