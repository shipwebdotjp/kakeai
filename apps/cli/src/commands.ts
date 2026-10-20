import {
  agentOperationCatalog,
  type AgentOperationDescriptor,
  type AgentOperationName,
} from "@kakeai/contracts";

/** CLI-only convenience command, equivalent to MCP's `kakeai_job_wait`. */
export const JOB_WAIT_COMMAND = "job.wait" as const;

export type CliCommand =
  | {
      kind: "operation";
      operation: AgentOperationName;
      longRunning: boolean;
    }
  | { kind: "jobWait" };

/**
 * Subcommands are derived from the Agent operation catalog, so the CLI can
 * never expose an operation the operation core does not publish (deletion,
 * external publishing and paid generation are absent by construction).
 */
export function resolveCliCommand(name: string): CliCommand | undefined {
  if (name === JOB_WAIT_COMMAND) {
    return { kind: "jobWait" };
  }
  const descriptor = agentOperationCatalog.find((entry) => entry.name === name);
  if (descriptor === undefined) {
    return undefined;
  }
  return {
    kind: "operation",
    operation: descriptor.name,
    longRunning: descriptor.longRunning,
  };
}

export function operationDescriptors(): readonly AgentOperationDescriptor[] {
  return agentOperationCatalog;
}

/** Every accepted run subcommand, in catalog order plus the convenience one. */
export function subcommandNames(): string[] {
  return [...agentOperationCatalog.map((entry) => entry.name), JOB_WAIT_COMMAND];
}
