import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toAgentJsonSchema } from "./agent-json-schema";

describe("toAgentJsonSchema", () => {
  it("strips the schema dialect and keeps the object shape", () => {
    const json = toAgentJsonSchema(
      z.strictObject({ workId: z.string().min(1) }),
      "input",
    );
    expect(json).toEqual({
      type: "object",
      properties: { workId: { type: "string", minLength: 1 } },
      required: ["workId"],
      additionalProperties: false,
    });
    expect(json.$schema).toBeUndefined();
  });

  it("adds the object type to a union of object schemas", () => {
    const json = toAgentJsonSchema(
      z.union([z.object({ a: z.string() }), z.object({ b: z.number() })]),
      "input",
    );
    expect(json.type).toBe("object");
    expect(json.anyOf).toHaveLength(2);
  });

  it("does not force an object type on a union with a non-object branch", () => {
    const json = toAgentJsonSchema(
      z.union([z.object({ a: z.string() }), z.string()]),
      "input",
    );
    expect(json.type).toBeUndefined();
    expect(json.anyOf).toHaveLength(2);
  });

  it("keeps the object type on a union whose branch is a reference", () => {
    type Node = { value: string; child?: Node };
    const nodeSchema: z.ZodType<Node> = z.lazy(() =>
      z.object({ value: z.string(), child: nodeSchema.optional() }),
    );
    const json = toAgentJsonSchema(
      z.union([nodeSchema, z.object({ other: z.string() })]),
      "input",
    );
    expect(json.type).toBe("object");
    expect(json.anyOf).toHaveLength(2);
  });

  it("keeps the object type on an intersection of object schemas", () => {
    const json = toAgentJsonSchema(
      z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() })),
      "input",
    );
    expect(json.type).toBe("object");
  });

  it("separates the input shape from the output shape", () => {
    const schema = z.strictObject({
      limit: z.number().int().min(1).default(50),
    });
    expect(toAgentJsonSchema(schema, "input")).toEqual({
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 9007199254740991,
          default: 50,
        },
      },
      additionalProperties: false,
    });
    expect(toAgentJsonSchema(schema, "output")).toEqual({
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 9007199254740991,
          default: 50,
        },
      },
      required: ["limit"],
      additionalProperties: false,
    });
  });
});
