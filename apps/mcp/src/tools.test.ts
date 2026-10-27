import { describe, expect, it } from "vitest";
import {
  agentLongRunningOperationNames,
  agentMutationOperationNames,
  agentOperationInputSchemas,
  agentOperationNames,
  agentOperationOutputSchemas,
  agentReadOperationNames,
  agentRequestIdRequiredOperationNames,
  isAgentLongRunningOperation,
  isAgentMutationOperation,
  isAgentRequestIdRequiredOperation,
  toAgentJsonSchema,
} from "@kakeai/contracts";
import {
  MCP_TOOL_NAME_PATTERN,
  jobWaitToolEntry,
  mcpToolEntries,
  mcpToolName,
  operationToolEntries,
} from "./tools.ts";

describe("MCP tool catalog", () => {
  it("exposes every agent operation exactly once", () => {
    expect(operationToolEntries).toHaveLength(agentOperationNames.length);
    expect(new Set(operationToolEntries.map((entry) => entry.operation))).toEqual(
      new Set(agentOperationNames),
    );
    expect([...operationToolEntries.map((entry) => entry.operation)].sort()).toEqual(
      [...agentOperationNames].sort(),
    );
  });

  it("classifies reads, mutations and job-based operations from contracts", () => {
    for (const entry of operationToolEntries) {
      expect(entry.kind).toBe("operation");
      expect(entry.readOnly).toBe(!isAgentMutationOperation(entry.operation));
      expect(entry.longRunning).toBe(isAgentLongRunningOperation(entry.operation));
      expect(entry.annotations.readOnlyHint).toBe(entry.readOnly);
      expect(entry.annotations.destructiveHint).toBe(false);
    }
    expect(operationToolEntries.filter((entry) => entry.longRunning).map((entry) => entry.operation))
      .toEqual([...agentLongRunningOperationNames]);
    expect(agentLongRunningOperationNames).toEqual([
      "asset.import",
      "render.start",
      "tts.create",
      "tts.createBulk",
    ]);
    expect(agentReadOperationNames.length + agentMutationOperationNames.length).toBe(
      agentOperationNames.length,
    );
  });

  it("advertises idempotent hints only for version-creating operations", () => {
    for (const entry of operationToolEntries) {
      expect(entry.annotations.idempotentHint).toBe(
        entry.readOnly || isAgentRequestIdRequiredOperation(entry.operation),
      );
    }
    expect(
      operationToolEntries
        .filter((entry) => entry.annotations.idempotentHint && !entry.readOnly)
        .map((entry) => entry.operation)
        .sort(),
    ).toEqual([...agentRequestIdRequiredOperationNames].sort());
  });

  it("uses unique MCP-safe names with the canonical operation in the description", () => {
    const names = mcpToolEntries.map((entry) => entry.toolName);
    expect(new Set(names).size).toBe(names.length);
    for (const entry of mcpToolEntries) {
      expect(entry.toolName).toMatch(MCP_TOOL_NAME_PATTERN);
      expect(entry.toolName.startsWith("kakeai_")).toBe(true);
      expect(entry.toolName).not.toContain(".");
      expect(entry.toolName).not.toContain("-");
      expect(entry.toolName).toBe(entry.toolName.toLowerCase());
    }
    for (const entry of operationToolEntries) {
      expect(entry.toolName).toBe(mcpToolName(entry.operation));
      expect(entry.description).toContain(entry.operation);
      if (entry.longRunning) {
        expect(entry.description).toContain("kakeai_job_wait");
      }
    }
    expect(mcpToolName("composition.authoringContext")).toBe(
      "kakeai_composition_authoring_context",
    );
    expect(mcpToolName("script.edit")).toBe("kakeai_script_edit");
  });

  it("generates an object input and output schema for every tool", () => {
    for (const entry of mcpToolEntries) {
      expect(entry.inputSchema.type).toBe("object");
      expect(entry.outputSchema.type).toBe("object");
      expect(entry.description.length).toBeGreaterThan(0);
    }
    const workGet = operationToolEntries.find((entry) => entry.operation === "work.get");
    expect(workGet?.inputSchema.properties).toHaveProperty("workId");
    const jobList = operationToolEntries.find((entry) => entry.operation === "job.list");
    expect(jobList?.inputSchema.properties).toHaveProperty("kind");
    expect(jobList?.inputSchema.required).toEqual(["workId"]);
    const scriptEdit = operationToolEntries.find((entry) => entry.operation === "script.edit");
    expect(scriptEdit?.inputSchema.properties).toHaveProperty("baseScriptVersionId");
    expect(scriptEdit?.inputSchema.properties).toHaveProperty("operations");
    expect(scriptEdit?.inputSchema.required).toEqual(
      expect.arrayContaining(["baseScriptVersionId", "requestId", "operations"]),
    );
    const assetList = operationToolEntries.find((entry) => entry.operation === "asset.list");
    expect(assetList?.inputSchema.properties).toHaveProperty("tags");
    expect(assetList?.inputSchema.properties).toHaveProperty("tagMode");
    expect(assetList?.inputSchema.properties).toHaveProperty("archived");
    expect(assetList?.inputSchema.properties).toHaveProperty("cursor");
    expect(assetList?.inputSchema.properties).toHaveProperty("sort");
    expect(assetList?.inputSchema.properties).toHaveProperty("hasAudio");
    expect(assetList?.inputSchema.properties).toHaveProperty("durationMinMs");
    expect(assetList?.inputSchema.properties).toHaveProperty("durationMaxMs");
    expect(assetList?.inputSchema.properties).toHaveProperty("widthPx");
    expect(assetList?.inputSchema.properties).toHaveProperty("widthMinPx");
    expect(assetList?.inputSchema.properties).toHaveProperty("widthMaxPx");
    expect(assetList?.inputSchema.properties).toHaveProperty("heightPx");
    expect(assetList?.inputSchema.properties).toHaveProperty("heightMinPx");
    expect(assetList?.inputSchema.properties).toHaveProperty("heightMaxPx");
    expect(assetList?.outputSchema.properties).toHaveProperty("nextCursor");
    expect(assetList?.outputSchema.properties).toHaveProperty("total");
    const validate = operationToolEntries.find(
      (entry) => entry.operation === "script.validate",
    );
    expect(validate?.inputSchema.anyOf).toBeDefined();
    const ttsCreate = operationToolEntries.find((entry) => entry.operation === "tts.create");
    expect(ttsCreate?.inputSchema.properties).toHaveProperty("narrationSegmentId");
    expect(ttsCreate?.inputSchema.properties).toHaveProperty("speedScale");
    expect(ttsCreate?.outputSchema.properties).toHaveProperty("job");
    expect(ttsCreate?.longRunning).toBe(true);
    const ttsBulk = operationToolEntries.find((entry) => entry.operation === "tts.createBulk");
    expect(ttsBulk?.inputSchema.properties).toHaveProperty("scriptVersionId");
    expect(ttsBulk?.outputSchema.properties).toHaveProperty("jobs");
    expect(ttsBulk?.outputSchema.properties).toHaveProperty("excluded");
    expect(ttsBulk?.longRunning).toBe(true);
    const characterList = operationToolEntries.find(
      (entry) => entry.operation === "character.list",
    );
    expect(characterList?.toolName).toBe("kakeai_character_list");
    expect(characterList?.readOnly).toBe(true);
    expect(characterList?.outputSchema.properties).toHaveProperty("characters");
    const characterGet = operationToolEntries.find(
      (entry) => entry.operation === "character.get",
    );
    expect(characterGet?.toolName).toBe("kakeai_character_get");
    expect(characterGet?.inputSchema.properties).toHaveProperty("characterId");
    expect(characterGet?.outputSchema.properties).toHaveProperty("character");
    expect(characterGet?.readOnly).toBe(true);
  });

  it("publishes the contract schemas through the shared JSON Schema conversion", () => {
    for (const entry of operationToolEntries) {
      expect(entry.inputSchema).toEqual(
        toAgentJsonSchema(agentOperationInputSchemas[entry.operation], "input"),
      );
      expect(entry.outputSchema).toEqual(
        toAgentJsonSchema(agentOperationOutputSchemas[entry.operation], "output"),
      );
      expect(entry.inputSchema.type).toBe("object");
      expect(entry.outputSchema.type).toBe("object");
      expect(entry.inputSchema.$schema).toBeUndefined();
      expect(entry.outputSchema.$schema).toBeUndefined();
    }
  });

  it("keeps the generated tool schemas in the published shape", () => {
    const workGet = operationToolEntries.find((entry) => entry.operation === "work.get");
    expect(workGet?.inputSchema).toEqual({
      type: "object",
      properties: { workId: { type: "string", minLength: 1 } },
      required: ["workId"],
      additionalProperties: false,
    });
    const jobCancel = operationToolEntries.find(
      (entry) => entry.operation === "job.cancel",
    );
    expect(jobCancel?.inputSchema).toEqual({
      type: "object",
      properties: { jobId: { type: "string", minLength: 1 } },
      required: ["jobId"],
      additionalProperties: false,
    });
    const validate = operationToolEntries.find(
      (entry) => entry.operation === "script.validate",
    );
    expect(validate?.inputSchema.type).toBe("object");
    expect(validate?.inputSchema.anyOf).toHaveLength(2);
  });

  it("includes the job_wait convenience tool and no irreversible tools", () => {
    expect(jobWaitToolEntry.toolName).toBe("kakeai_job_wait");
    expect(mcpToolEntries).toContain(jobWaitToolEntry);
    for (const entry of mcpToolEntries) {
      expect(entry.toolName).not.toMatch(/(delete|remove|destroy|purge|publish_external)/u);
    }
    expect(
      agentOperationNames.filter((name) => /(delete|remove|destroy|purge)/u.test(name)),
    ).toEqual([]);
  });
});
