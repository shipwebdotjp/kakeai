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
  agentThumbnailTemplateContracts,
  buildAgentSchemaGetResult,
  buildAgentTemplateInputContract,
  computeAgentSchemaDigest,
} from "./agent";
import { visualTemplateDefinitions } from "./templates";
import { thumbnailTemplateDefinitions } from "./thumbnail/templates";

describe("thumbnail template contracts", () => {
  it("publishes every bundled thumbnail template with its input schema", () => {
    const contracts = agentThumbnailTemplateContracts();
    expect(contracts.map((contract) => `${contract.id}@${contract.version}`).sort()).toEqual(
      thumbnailTemplateDefinitions
        .map((definition) => `${definition.id}@${definition.version}`)
        .sort(),
    );
    for (const definition of thumbnailTemplateDefinitions) {
      const contract = contracts.find(
        (entry) =>
          entry.id === definition.id && entry.version === definition.version,
      );
      expect(contract?.inputSchema).toEqual(
        toAgentJsonSchema(definition.inputSchema, "input"),
      );
    }
  });

  it("keeps every thumbnail example valid against its template schema", () => {
    for (const definition of thumbnailTemplateDefinitions) {
      const parsed = definition.inputSchema.safeParse(definition.exampleInput);
      expect(
        parsed.success,
        `${definition.id}@${definition.version}: ${JSON.stringify(
          parsed.success ? [] : parsed.error.issues,
        )}`,
      ).toBe(true);
    }
  });

  it("validates the thumbnail operation input and output shape", () => {
    const list = agentOperationInputSchemas["thumbnail.listTemplates"];
    const output = agentOperationOutputSchemas["thumbnail.listTemplates"];
    expect(list.safeParse({}).success).toBe(true);
    expect(
      output.safeParse({ templates: agentThumbnailTemplateContracts() }).success,
    ).toBe(true);
    expect(
      output.safeParse({
        templates: [
          {
            id: "thumbnail.cutout-hero",
            version: 1,
            display: { label: "x", description: "" },
            inputSchema: {},
            example: {},
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      agentOperationInputSchemas["thumbnail.create"].safeParse({
        languageEditionId: "led_1",
        label: "候補",
        template: { id: "thumbnail.cutout-hero", version: 1 },
        input: {},
      }).success,
    ).toBe(true);
    expect(
      agentOperationInputSchemas["thumbnail.update"].safeParse({
        thumbnailId: "thm_1",
        label: "候補",
        template: { id: "thumbnail.cutout-hero", version: 1 },
        input: {},
        requestId: "not-a-thumbnail-field",
      }).success,
    ).toBe(false);
  });

  it("folds thumbnail template contracts into the schema digest", () => {
    const result = buildAgentSchemaGetResult();
    const digestInput = agentSchemaDigestInputOf({
      ...result,
      templateInputContracts: agentTemplateInputContracts(),
      thumbnailTemplateContracts: agentThumbnailTemplateContracts(),
      operationContracts: agentOperationContracts(),
    });
    expect(computeAgentSchemaDigest(digestInput)).toBe(result.schemaDigest);

    const first = digestInput.thumbnailTemplateContracts[0]!;
    const changed = {
      ...digestInput,
      thumbnailTemplateContracts: [
        { ...first, example: { changed: true } },
        ...digestInput.thumbnailTemplateContracts.slice(1),
      ],
    };
    expect(computeAgentSchemaDigest(changed)).not.toBe(result.schemaDigest);
  });
});

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
      thumbnailTemplateContracts: agentThumbnailTemplateContracts(),
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
