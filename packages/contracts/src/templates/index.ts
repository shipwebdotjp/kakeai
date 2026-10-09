import { z } from "zod";
import { idSchema } from "../content/primitives";

export const textAnchorSchema = z.enum(["left", "center", "right"]);

export const textTitleV1 = {
  id: "text.title",
  version: 1,
  inputSchema: z.strictObject({
    title: z.string(),
    subtitle: z.string(),
    anchor: textAnchorSchema.optional(),
  }),
};

export const textBodyV1 = {
  id: "text.body",
  version: 1,
  inputSchema: z.strictObject({
    heading: z.string(),
    body: z.string(),
  }),
};

export const fitSchema = z.enum(["cover", "contain"]);

export const focalPointSchema = z.strictObject({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const mediaFullBleedV1 = {
  id: "media.full-bleed",
  version: 1,
  inputSchema: z.strictObject({
    assetId: idSchema,
    fit: fitSchema,
    focalPoint: focalPointSchema.optional(),
  }),
};

export const mediaCardV1 = {
  id: "media.card",
  version: 1,
  inputSchema: z.strictObject({
    assetId: idSchema,
    heading: z.string(),
    caption: z.string().optional(),
    focalPoint: focalPointSchema.optional(),
  }),
};

export const characterStandingV1 = {
  id: "character.standing",
  version: 1,
  inputSchema: z.strictObject({
    characterId: idSchema,
    appearanceId: idSchema,
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    scale: z.number().positive(),
  }),
};

export const standingSideSchema = z.enum(["left", "right"]);

export const characterStandingV2 = {
  id: "character.standing",
  version: 2,
  inputSchema: z.strictObject({
    characterId: idSchema,
    appearanceId: idSchema,
    side: standingSideSchema,
    scale: z.number().positive(),
  }),
};

export const visualTemplateDefinitions = [
  textTitleV1,
  textBodyV1,
  mediaFullBleedV1,
  mediaCardV1,
  characterStandingV1,
  characterStandingV2,
] as const;

export const assetBearingTemplateKeys: ReadonlySet<string> = new Set([
  `${mediaFullBleedV1.id}@${mediaFullBleedV1.version}`,
  `${mediaCardV1.id}@${mediaCardV1.version}`,
]);

export interface VisualTemplateDefinition {
  id: string;
  version: number;
  inputSchema: z.ZodTypeAny;
}

export const visualTemplateRegistry: ReadonlyMap<string, VisualTemplateDefinition> = new Map(
  visualTemplateDefinitions.map((definition) => [
    `${definition.id}@${definition.version}`,
    definition,
  ]),
);

export function getVisualTemplate(
  id: string,
  version: number,
): VisualTemplateDefinition | undefined {
  return visualTemplateRegistry.get(`${id}@${version}`);
}
