import { z } from "zod";
import { idSchema } from "../content/primitives";
import {
  DEFAULT_TRANSITION_POLICY,
  type CueLayer,
  type TransitionPolicy,
} from "../content/layers";
import {
  DEFAULT_ANIMATION_POLICY,
  animationSpecSchema,
  type AnimationPolicy,
} from "../content/animation";
import {
  MAX_NESTED_VISUAL_DEPTH,
  fitSchema,
  focalPointSchema,
  nestedVisualSchema,
  type NestedVisual,
} from "../content/nested";
import type { AssetKindName, AssetReference } from "../content/asset-reference";

export const textAnchorSchema = z.enum(["left", "center", "right"]);

export interface TemplateDisplay {
  label: string;
  description: string;
  category: string;
}

export type TemplateFieldSpec =
  | { kind: "media"; key: string; label: string; assetKinds: readonly AssetKindName[] }
  | { kind: "nestedMedia"; key: string; label: string; assetKinds: readonly AssetKindName[] }
  | { kind: "text"; key: string; label: string }
  | { kind: "optionalText"; key: string; label: string }
  | { kind: "select"; key: string; label: string; options: readonly { value: string; label: string }[]; optional?: boolean }
  | { kind: "color"; key: string; label: string }
  | { kind: "animation"; key: string; label: string };

export interface VisualTemplateDefinition {
  id: string;
  version: number;
  inputSchema: z.ZodTypeAny;
  layers: readonly CueLayer[];
  transitionPolicy: TransitionPolicy;
  animationPolicy: AnimationPolicy;
  display: TemplateDisplay;
  inputFields?: readonly TemplateFieldSpec[];
  collectAssetRefs: (input: unknown, path: (string | number)[], depth?: number) => AssetReference[];
}

const MEDIA_KINDS = ["image", "video"] as const;

const FIT_OPTIONS = [
  { value: "cover", label: "cover" },
  { value: "contain", label: "contain" },
] as const;

const ANCHOR_OPTIONS = [
  { value: "left", label: "左" },
  { value: "center", label: "中央" },
  { value: "right", label: "右" },
] as const;

const DEVICE_FRAME_OPTIONS = [
  { value: "laptop", label: "ラップトップ" },
  { value: "phone", label: "スマートフォン" },
] as const;

export const textTitleInputSchema = z.strictObject({
  title: z.string(),
  subtitle: z.string(),
  anchor: textAnchorSchema.optional(),
});

const textTitleV1: VisualTemplateDefinition = {
  id: "text.title",
  version: 1,
  inputSchema: textTitleInputSchema,
  layers: ["overlay"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "タイトル", description: "見出しとサブタイトル", category: "text" },
  inputFields: [
    { kind: "text", key: "title", label: "タイトル" },
    { kind: "text", key: "subtitle", label: "サブタイトル" },
    { kind: "select", key: "anchor", label: "配置", options: ANCHOR_OPTIONS, optional: true },
  ],
  collectAssetRefs: () => [],
};

export const textBodyInputSchema = z.strictObject({
  heading: z.string(),
  body: z.string(),
});

const textBodyV1: VisualTemplateDefinition = {
  id: "text.body",
  version: 1,
  inputSchema: textBodyInputSchema,
  layers: ["overlay"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "本文", description: "見出しと本文", category: "text" },
  inputFields: [
    { kind: "text", key: "heading", label: "見出し" },
    { kind: "text", key: "body", label: "本文" },
  ],
  collectAssetRefs: () => [],
};

export const mediaFullBleedInputSchema = z.strictObject({
  assetId: idSchema,
  fit: fitSchema,
  focalPoint: focalPointSchema.optional(),
});

const mediaFullBleedV1: VisualTemplateDefinition = {
  id: "media.full-bleed",
  version: 1,
  inputSchema: mediaFullBleedInputSchema,
  layers: ["background"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "背景（全面）", description: "画像・動画を全面に敷く", category: "media" },
  inputFields: [
    { kind: "media", key: "assetId", label: "素材", assetKinds: MEDIA_KINDS },
    { kind: "select", key: "fit", label: "fit", options: FIT_OPTIONS },
  ],
  collectAssetRefs: (input, path) => {
    const parsed = mediaFullBleedInputSchema.safeParse(input);
    if (!parsed.success) {
      return [];
    }
    return [{ assetId: parsed.data.assetId, allowedKinds: MEDIA_KINDS, path: [...path, "assetId"] }];
  },
};

export const mediaCardInputSchema = z.strictObject({
  assetId: idSchema,
  heading: z.string(),
  caption: z.string().optional(),
  focalPoint: focalPointSchema.optional(),
});

const mediaCardV1: VisualTemplateDefinition = {
  id: "media.card",
  version: 1,
  inputSchema: mediaCardInputSchema,
  layers: ["card"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "カード", description: "画像・動画を見出し付きカードで表示", category: "media" },
  inputFields: [
    { kind: "media", key: "assetId", label: "素材", assetKinds: MEDIA_KINDS },
    { kind: "text", key: "heading", label: "見出し" },
    { kind: "optionalText", key: "caption", label: "補足文" },
  ],
  collectAssetRefs: (input, path) => {
    const parsed = mediaCardInputSchema.safeParse(input);
    if (!parsed.success) {
      return [];
    }
    return [{ assetId: parsed.data.assetId, allowedKinds: MEDIA_KINDS, path: [...path, "assetId"] }];
  },
};

export const characterStandingV1InputSchema = z.strictObject({
  characterId: idSchema,
  appearanceId: idSchema,
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  scale: z.number().positive(),
});

const characterStandingV1: VisualTemplateDefinition = {
  id: "character.standing",
  version: 1,
  inputSchema: characterStandingV1InputSchema,
  layers: ["standing"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "立ち絵（旧）", description: "保存済み版の描画用", category: "character" },
  collectAssetRefs: () => [],
};

export const standingSideSchema = z.enum(["left", "right"]);

export const characterStandingV2InputSchema = z.strictObject({
  characterId: idSchema,
  appearanceId: idSchema,
  side: standingSideSchema,
  scale: z.number().positive(),
});

const characterStandingV2: VisualTemplateDefinition = {
  id: "character.standing",
  version: 2,
  inputSchema: characterStandingV2InputSchema,
  layers: ["standing"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { label: "立ち絵", description: "左右1体ずつ立ち絵を表示", category: "character" },
  collectAssetRefs: () => [],
};

export const deviceFrameInputSchema = z.strictObject({
  screen: nestedVisualSchema,
  frame: z.enum(["laptop", "phone"]),
  backgroundColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
});

export const deviceFrameV2InputSchema = z.strictObject({
  screen: nestedVisualSchema,
  frame: z.enum(["laptop", "phone"]),
  backgroundColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  animation: animationSpecSchema.optional(),
});

const DEVICE_FRAME_DISPLAY: TemplateDisplay = {
  label: "デバイスフレーム",
  description: "端末枠内に画像・動画を表示するコンポジション",
  category: "composition",
};

const DEVICE_FRAME_FIELDS: readonly TemplateFieldSpec[] = [
  { kind: "nestedMedia", key: "screen", label: "画面", assetKinds: MEDIA_KINDS },
  { kind: "select", key: "frame", label: "フレーム", options: DEVICE_FRAME_OPTIONS },
  { kind: "color", key: "backgroundColor", label: "背景色" },
];

function collectDeviceFrameRefs(
  schema: z.ZodTypeAny,
  input: unknown,
  path: (string | number)[],
  depth: number,
): AssetReference[] {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return [];
  }
  return collectNestedAssetRefs(
    (parsed.data as { screen: NestedVisual }).screen,
    [...path, "screen"],
    depth,
  );
}

const sceneDeviceFrameV1: VisualTemplateDefinition = {
  id: "scene.device-frame",
  version: 1,
  inputSchema: deviceFrameInputSchema,
  layers: ["background", "card"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: { ...DEVICE_FRAME_DISPLAY, label: "デバイスフレーム（旧）" },
  inputFields: DEVICE_FRAME_FIELDS,
  collectAssetRefs: (input, path, depth = 0) =>
    collectDeviceFrameRefs(deviceFrameInputSchema, input, path, depth),
};

const sceneDeviceFrameV2: VisualTemplateDefinition = {
  id: "scene.device-frame",
  version: 2,
  inputSchema: deviceFrameV2InputSchema,
  layers: ["background", "card"],
  transitionPolicy: DEFAULT_TRANSITION_POLICY,
  animationPolicy: DEFAULT_ANIMATION_POLICY,
  display: DEVICE_FRAME_DISPLAY,
  inputFields: [
    ...DEVICE_FRAME_FIELDS,
    { kind: "animation", key: "animation", label: "画面の登場アニメーション" },
  ],
  collectAssetRefs: (input, path, depth = 0) =>
    collectDeviceFrameRefs(deviceFrameV2InputSchema, input, path, depth),
};

export const visualTemplateDefinitions: readonly VisualTemplateDefinition[] = [
  textTitleV1,
  textBodyV1,
  mediaFullBleedV1,
  mediaCardV1,
  characterStandingV1,
  characterStandingV2,
  sceneDeviceFrameV1,
  sceneDeviceFrameV2,
];

export { textTitleV1, textBodyV1, mediaFullBleedV1, mediaCardV1 };
export { characterStandingV1, characterStandingV2, sceneDeviceFrameV1, sceneDeviceFrameV2 };

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

export function getTemplateInputFields(
  id: string,
  version: number,
): readonly TemplateFieldSpec[] | undefined {
  return getVisualTemplate(id, version)?.inputFields;
}

export function isEditableTemplate(id: string, version: number): boolean {
  const fields = getTemplateInputFields(id, version);
  return fields !== undefined && fields.length > 0;
}

export function collectNestedAssetRefs(
  node: NestedVisual,
  path: (string | number)[],
  depth = 0,
): AssetReference[] {
  if (depth >= MAX_NESTED_VISUAL_DEPTH) {
    return [];
  }
  if (node.kind === "media") {
    return [{ assetId: node.assetId, allowedKinds: MEDIA_KINDS, path: [...path, "assetId"] }];
  }
  const definition = getVisualTemplate(node.template.id, node.template.version);
  if (!definition) {
    return [];
  }
  return definition.collectAssetRefs(node.input, [...path, "input"], depth + 1);
}

export interface VisualTemplateCatalogEntry extends TemplateDisplay {
  id: string;
  version: number;
  layers: readonly CueLayer[];
  editable: boolean;
}

export function listVisualTemplateCatalog(): VisualTemplateCatalogEntry[] {
  return visualTemplateDefinitions.map((definition) => ({
    id: definition.id,
    version: definition.version,
    layers: definition.layers,
    editable: isEditableTemplate(definition.id, definition.version),
    ...definition.display,
  }));
}
