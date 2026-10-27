import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toAgentJsonSchema } from "./agent-json-schema";
import {
  AGENT_PROTOCOL_MIN_VERSION,
  AGENT_PROTOCOL_VERSION,
  agentOperationContracts,
  agentOperationInputSchemas,
  agentOperationNames,
  agentOperationOutputSchemas,
  agentSchemaDigestInputOf,
  agentSchemaGetResultSchema,
  agentTemplateInputContracts,
  agentThumbnailTemplateContracts,
  buildAgentOperationContracts,
  buildAgentSchemaGetResult,
  computeAgentOperationDigest,
  computeAgentSchemaDigest,
  isAgentProtocolVersionSupported,
  type AgentOperationContract,
} from "./agent";

function withChangedInput(
  contracts: readonly AgentOperationContract[],
  name: string,
): AgentOperationContract[] {
  return contracts.map((contract) =>
    contract.name === name
      ? {
          ...contract,
          input: {
            ...contract.input,
            properties: {
              ...(contract.input.properties as Record<string, unknown>),
              addedField: { type: "string" },
            },
          },
        }
      : contract,
  );
}

function withChangedOutput(
  contracts: readonly AgentOperationContract[],
  name: string,
): AgentOperationContract[] {
  return contracts.map((contract) =>
    contract.name === name
      ? {
          ...contract,
          output: {
            ...contract.output,
            properties: {
              ...(contract.output.properties as Record<string, unknown>),
              addedField: { type: "string" },
            },
          },
        }
      : contract,
  );
}

describe("operation contracts", () => {
  it("covers every agent operation in the fixed order", () => {
    const contracts = agentOperationContracts();
    expect(contracts.map((contract) => contract.name)).toEqual([
      ...agentOperationNames,
    ]);
    expect(buildAgentOperationContracts().map((contract) => contract.name)).toEqual([
      ...agentOperationNames,
    ]);
  });

  it("normalises each operation with the shared JSON Schema conversion", () => {
    for (const contract of agentOperationContracts()) {
      expect(contract.input).toEqual(
        toAgentJsonSchema(agentOperationInputSchemas[contract.name], "input"),
      );
      expect(contract.output).toEqual(
        toAgentJsonSchema(agentOperationOutputSchemas[contract.name], "output"),
      );
      expect(contract.input.$schema).toBeUndefined();
      expect(contract.output.$schema).toBeUndefined();
      expect(contract.input.type).toBe("object");
      expect(contract.output.type).toBe("object");
    }
  });

  it("keeps every operation schema representable as JSON Schema", () => {
    // The shared conversion tolerates unrepresentable constructs so that a
    // binding never fails at runtime, but a contract that cannot be
    // represented would make the digest blind to a change inside it. The
    // strict conversion therefore has to succeed for every operation.
    for (const name of agentOperationNames) {
      expect(() =>
        z.toJSONSchema(agentOperationInputSchemas[name], { io: "input" }),
      ).not.toThrow();
      expect(() =>
        z.toJSONSchema(agentOperationOutputSchemas[name], { io: "output" }),
      ).not.toThrow();
    }
  });
});

describe("schema.get digests", () => {
  it("exposes the operation digest and the supported protocol version range", () => {
    const result = buildAgentSchemaGetResult();
    expect(agentSchemaGetResultSchema.parse(result)).toEqual(result);
    expect(result.protocolVersion).toBe(AGENT_PROTOCOL_VERSION);
    expect(result.minProtocolVersion).toBe(AGENT_PROTOCOL_MIN_VERSION);
    expect(result.operationDigest).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
    expect(result.schemaDigest).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
  });

  it("still parses a server that predates the digest fields", () => {
    const { operationDigest, minProtocolVersion, ...older } =
      buildAgentSchemaGetResult();
    expect(operationDigest).toBeDefined();
    expect(minProtocolVersion).toBeDefined();
    expect(agentSchemaGetResultSchema.safeParse(older).success).toBe(true);
  });

  it("folds the operation contracts into the schema digest", () => {
    const result = buildAgentSchemaGetResult();
    const descriptor = agentSchemaDigestInputOf({
      ...result,
      templateInputContracts: agentTemplateInputContracts(),
      thumbnailTemplateContracts: agentThumbnailTemplateContracts(),
      operationContracts: agentOperationContracts(),
    });
    expect(descriptor.operationContracts).toHaveLength(agentOperationNames.length);
    expect(computeAgentSchemaDigest(descriptor)).toBe(result.schemaDigest);
    expect(computeAgentOperationDigest(descriptor.operationContracts)).toBe(
      result.operationDigest,
    );
  });

  it("is stable across calls and independent of key order", () => {
    const first = buildAgentSchemaGetResult();
    const second = buildAgentSchemaGetResult();
    expect(second.operationDigest).toBe(first.operationDigest);
    expect(second.schemaDigest).toBe(first.schemaDigest);

    const reordered = agentOperationContracts().map((contract) => ({
      name: contract.name,
      output: Object.fromEntries(Object.entries(contract.output).reverse()),
      input: Object.fromEntries(Object.entries(contract.input).reverse()),
    }));
    expect(computeAgentOperationDigest(reordered)).toBe(first.operationDigest);
  });

  it(
    "changes both digests when any operation input or output changes",
    () => {
      const result = buildAgentSchemaGetResult();
      const baseContracts = agentOperationContracts();
      const templateContracts = agentTemplateInputContracts();
      const thumbnailContracts = agentThumbnailTemplateContracts();
      for (const name of agentOperationNames) {
        const changedInput = withChangedInput(baseContracts, name);
        expect(computeAgentOperationDigest(changedInput)).not.toBe(
          result.operationDigest,
        );
        expect(
          computeAgentSchemaDigest(
            agentSchemaDigestInputOf({
              ...result,
              templateInputContracts: templateContracts,
              thumbnailTemplateContracts: thumbnailContracts,
              operationContracts: changedInput,
            }),
          ),
        ).not.toBe(result.schemaDigest);

        const changedOutput = withChangedOutput(baseContracts, name);
        expect(computeAgentOperationDigest(changedOutput)).not.toBe(
          result.operationDigest,
        );
        expect(
          computeAgentSchemaDigest(
            agentSchemaDigestInputOf({
              ...result,
              templateInputContracts: templateContracts,
              thumbnailTemplateContracts: thumbnailContracts,
              operationContracts: changedOutput,
            }),
          ),
        ).not.toBe(result.schemaDigest);
      }
    },
    60_000,
  );

  it("changes the operation digest when an operation disappears", () => {
    const result = buildAgentSchemaGetResult();
    const withoutLast = agentOperationContracts().slice(0, -1);
    expect(computeAgentOperationDigest(withoutLast)).not.toBe(
      result.operationDigest,
    );
  });

  it("moves both digests when an operation schema itself changes", () => {
    const result = buildAgentSchemaGetResult();
    const changed = agentOperationContracts().map((contract) =>
      contract.name === "work.get"
        ? {
            ...contract,
            input: toAgentJsonSchema(
              z.strictObject({
                workId: z.string().min(1),
                extra: z.string().optional(),
              }),
              "input",
            ),
          }
        : contract,
    );
    expect(computeAgentOperationDigest(changed)).not.toBe(result.operationDigest);
    expect(
      computeAgentSchemaDigest(
        agentSchemaDigestInputOf({
          ...result,
          templateInputContracts: agentTemplateInputContracts(),
          thumbnailTemplateContracts: agentThumbnailTemplateContracts(),
          operationContracts: changed,
        }),
      ),
    ).not.toBe(result.schemaDigest);
  });
});

describe("protocol version range", () => {
  it("accepts only the versions inside the supported range", () => {
    expect(isAgentProtocolVersionSupported(AGENT_PROTOCOL_VERSION)).toBe(true);
    expect(isAgentProtocolVersionSupported(AGENT_PROTOCOL_MIN_VERSION)).toBe(true);
    expect(isAgentProtocolVersionSupported(AGENT_PROTOCOL_MIN_VERSION - 1)).toBe(
      false,
    );
    expect(isAgentProtocolVersionSupported(AGENT_PROTOCOL_VERSION + 1)).toBe(
      false,
    );
    expect(isAgentProtocolVersionSupported(1.5)).toBe(false);
  });
});
