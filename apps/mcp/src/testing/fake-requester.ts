import type { AgentOperationName } from "@kakeai/contracts";
import type { AgentRequester } from "../server.ts";

export type FakeHandler = (operation: AgentOperationName, input: unknown) => unknown;

/**
 * Adapts a plain function to the typed client interface. Tests use this to
 * drive the MCP server without a socket.
 */
export function createFakeRequester(handle: FakeHandler): AgentRequester {
  return {
    request: ((operation: string, input: unknown) =>
      Promise.resolve().then(() =>
        handle(operation as AgentOperationName, input),
      )) as unknown as AgentRequester["request"],
  };
}
