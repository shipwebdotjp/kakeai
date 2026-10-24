import { describe, expect, it } from "vitest";
import { toAgentJsonSchema } from "./agent-json-schema";
import {
  agentOperationContracts,
  agentOperationInputSchemas,
  agentOperationNames,
  agentOperationOutputSchemas,
  agentSchemaDigestInputOf,
  agentTemplateInputContractSchema,
  agentTemplateInputContracts,
  buildAgentSchemaGetResult,
  buildAgentTemplateInputContract,
  computeAgentSchemaDigest,
} from "./agent";
import { visualTemplateDefinitions } from "./templates";

describe("template input contracts", () => {
  it("covers every registered template version", () => {
    const contracts = agentTemplateInputContracts();
    expect(contracts.map((contract) => `${contract.id}@${contract.version}`).sort()).toEqual(
      visualTemplateDefinitions
        .map((definition) => `${definition.id}@${definition.version}`)
        .sort(),
    );
    for (const contract of contracts) {
      expect(agentTemplateInputContractSchema.parse(contract)).toEqual(contract);
    }
  });

  it("publishes the JSON Schema of the schema that validates saves", () => {
    for (const definition of visualTemplateDefinitions) {
      const contract = buildAgentTemplateInputContract(definition.id, definition.version);
      expect(contract?.inputSchema).toEqual(
        toAgentJsonSchema(definition.inputSchema, "input"),
      );
    }
  });

  it("keeps every example valid against its template schema", () => {
    for (const definition of visualTemplateDefinitions) {
      const parsed = definition.inputSchema.safeParse(definition.exampleInput);
      expect(
        parsed.success,
        `${definition.id}@${definition.version}: ${JSON.stringify(
          parsed.success ? [] : parsed.error.issues,
        )}`,
      ).toBe(true);
    }
  });

  it("returns undefined for an unknown id or version", () => {
    expect(buildAgentTemplateInputContract("table.simple", 2)).toBeUndefined();
    expect(buildAgentTemplateInputContract("missing.template", 1)).toBeUndefined();
  });

  it("validates the operation input and output shape", () => {
    const input = agentOperationInputSchemas["template.get"];
    const output = agentOperationOutputSchemas["template.get"];
    expect(agentOperationNames).toContain("template.get");
    expect(input.safeParse({ id: "table.simple", version: 1 }).success).toBe(true);
    expect(input.safeParse({ id: "table.simple" }).success).toBe(false);
    expect(
      output.safeParse({ template: buildAgentTemplateInputContract("table.simple", 1) })
        .success,
    ).toBe(true);
  });

  it("folds template input contracts into the schema digest", () => {
    const result = buildAgentSchemaGetResult();
    const digestInput = agentSchemaDigestInputOf({
      ...result,
      templateInputContracts: agentTemplateInputContracts(),
      operationContracts: agentOperationContracts(),
    });
    expect(computeAgentSchemaDigest(digestInput)).toBe(result.schemaDigest);

    const first = digestInput.templateInputContracts[0]!;
    const changed = {
      ...digestInput,
      templateInputContracts: [
        { ...first, example: { changed: true } },
        ...digestInput.templateInputContracts.slice(1),
      ],
    };
    expect(computeAgentSchemaDigest(changed)).not.toBe(result.schemaDigest);
  });
});
