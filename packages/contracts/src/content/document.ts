import { z } from "zod";
import { localeSchema } from "./primitives";
import { speakerSchema, speakerV1Schema } from "./speaker";
import { characterSchema } from "./character";
import { audioTakeSchema } from "./narration";
import { sceneSchema } from "./scene";
import { audioCueSchema } from "./audio";
import { characterStandingV1, characterStandingV2 } from "../templates";

export const CONTENT_SCHEMA_VERSION = 2 as const;
export const LEGACY_CONTENT_SCHEMA_VERSION = 1 as const;

export const TEMPLATE_ID = "explanation-scenes" as const;
export const TEMPLATE_VERSION = 1 as const;

export const LEGACY_TEMPLATE_ID = "explanation-5-scenes" as const;

function checkSceneComposition(
  templateId: string,
  kinds: readonly string[],
  ctx: z.RefinementCtx,
): void {
  if (templateId === LEGACY_TEMPLATE_ID) {
    const expected = ["intro", "point", "point", "point", "outro"];
    const matches =
      kinds.length === expected.length && kinds.every((kind, index) => kind === expected[index]);
    if (!matches) {
      ctx.addIssue({
        code: "custom",
        message: `${LEGACY_TEMPLATE_ID}@${TEMPLATE_VERSION} は 導入→要点×3→結び の固定5シーンをこの順で要求します`,
        path: ["scenes"],
      });
    }
    return;
  }
  const ordered =
    kinds.length >= 2 &&
    kinds[0] === "intro" &&
    kinds[kinds.length - 1] === "outro" &&
    kinds.slice(1, -1).every((kind) => kind === "point");
  if (!ordered) {
    ctx.addIssue({
      code: "custom",
      message: `${TEMPLATE_ID}@${TEMPLATE_VERSION} は 導入→要点0件以上→結び の順でシーンを要求します`,
      path: ["scenes"],
    });
  }
}

function checkUnique(
  ids: readonly string[],
  ctx: z.RefinementCtx,
  path: (string | number)[],
): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      duplicates.add(id);
    } else {
      seen.add(id);
    }
  }
  for (const id of duplicates) {
    ctx.addIssue({
      code: "custom",
      message: `IDが重複しています: ${id}`,
      path,
    });
  }
}

const baseDocumentShape = {
  locale: localeSchema,
  template: z.strictObject({
    id: z.union([z.literal(TEMPLATE_ID), z.literal(LEGACY_TEMPLATE_ID)]),
    version: z.literal(TEMPLATE_VERSION),
  }),
  characters: z.array(characterSchema),
  audioTakes: z.array(audioTakeSchema),
  scenes: z.array(sceneSchema),
  audioCues: z.array(audioCueSchema),
};

const contentDocumentV2Object = z.strictObject({
  schemaVersion: z.literal(CONTENT_SCHEMA_VERSION),
  speakers: z.array(speakerSchema),
  ...baseDocumentShape,
});

type ContentDocumentBase = z.infer<typeof contentDocumentV2Object>;

function validateContentDocument(doc: ContentDocumentBase, ctx: z.RefinementCtx): void {
  checkUnique(doc.scenes.map((scene) => scene.id), ctx, ["scenes"]);
  const lineIds = doc.scenes.flatMap((scene) => scene.lines.map((line) => line.id));
  checkUnique(lineIds, ctx, ["scenes"]);
  const lineIdSet = new Set(lineIds);
  checkUnique(doc.audioTakes.map((take) => take.id), ctx, ["audioTakes"]);
  checkUnique(doc.speakers.map((speaker) => speaker.id), ctx, ["speakers"]);
  checkUnique(doc.characters.map((character) => character.id), ctx, ["characters"]);
  checkUnique(
    doc.characters.flatMap((character) =>
      character.appearances.map((appearance) => appearance.id),
    ),
    ctx,
    ["characters"],
  );
  checkUnique(
    doc.scenes.flatMap((scene) => scene.visualCues.map((cue) => cue.id)),
    ctx,
    ["scenes"],
  );
  checkUnique(doc.audioCues.map((cue) => cue.id), ctx, ["audioCues"]);

  const kinds = doc.scenes.map((scene) => scene.kind);
  checkSceneComposition(doc.template.id, kinds, ctx);

  const takeById = new Map(doc.audioTakes.map((take) => [take.id, take]));
  for (const take of doc.audioTakes) {
    if (!lineIdSet.has(take.narrationSegmentId)) {
      ctx.addIssue({
        code: "custom",
        message: `AudioTake ${take.id} の narrationSegmentId が存在しません: ${take.narrationSegmentId}`,
        path: ["audioTakes"],
      });
    }
  }

  const speakerIds = new Set(doc.speakers.map((speaker) => speaker.id));
  const characterIds = new Set(doc.characters.map((character) => character.id));
  const appearanceIdsByCharacter = new Map(
    doc.characters.map((character) => [
      character.id,
      new Set(character.appearances.map((appearance) => appearance.id)),
    ]),
  );

  for (const [index, scene] of doc.scenes.entries()) {
    if ((scene.kind === "intro" || scene.kind === "outro") && scene.timing.mode !== "fixed") {
      ctx.addIssue({
        code: "custom",
        message: `${scene.kind} はテンプレート既定の固定尺を使います`,
        path: ["scenes", index, "timing"],
      });
    }
    const localLineIds = scene.lines.map((line) => line.id);
    for (const line of scene.lines) {
      if (line.speakerId !== null && !speakerIds.has(line.speakerId)) {
        ctx.addIssue({
          code: "custom",
          message: `NarrationSegment ${line.id} の speakerId が存在しません: ${line.speakerId}`,
          path: ["scenes"],
        });
      }
      if (line.selectedAudioTakeId === null) {
        continue;
      }
      const take = takeById.get(line.selectedAudioTakeId);
      if (!take) {
        ctx.addIssue({
          code: "custom",
          message: `NarrationSegment ${line.id} が存在しないAudioTakeを参照しています: ${line.selectedAudioTakeId}`,
          path: ["scenes"],
        });
      } else if (take.narrationSegmentId !== line.id) {
        ctx.addIssue({
          code: "custom",
          message: `AudioTake ${take.id} は NarrationSegment ${line.id} のものではありません`,
          path: ["scenes"],
        });
      }
    }

    for (const cue of scene.visualCues) {
      if (cue.range.kind === "lines") {
        const startIndex = localLineIds.indexOf(cue.range.startLineId);
        const endIndex = localLineIds.indexOf(cue.range.endLineId);
        if (startIndex === -1 || endIndex === -1) {
          ctx.addIssue({
            code: "custom",
            message: `VisualCue ${cue.id} の range が同一Scene内のラインを指していません`,
            path: ["scenes"],
          });
        } else if (startIndex > endIndex) {
          ctx.addIssue({
            code: "custom",
            message: `VisualCue ${cue.id} の range は start <= end である必要があります`,
            path: ["scenes"],
          });
        }
      } else if (cue.range.kind === "offset" && cue.range.startMs > cue.range.endMs) {
        ctx.addIssue({
          code: "custom",
          message: `VisualCue ${cue.id} の offset range は startMs <= endMs である必要があります`,
          path: ["scenes"],
        });
      }

      if (cue.template.id === characterStandingV1.id) {
        let standingDefinition: typeof characterStandingV1 | typeof characterStandingV2 | undefined;
        if (cue.template.version === characterStandingV1.version) {
          standingDefinition = characterStandingV1;
        } else if (cue.template.version === characterStandingV2.version) {
          standingDefinition = characterStandingV2;
        } else {
          standingDefinition = undefined;
        }
        const parsed =
          standingDefinition === undefined
            ? undefined
            : standingDefinition.inputSchema.safeParse(cue.input);
        if (parsed !== undefined && parsed.success) {
          const { characterId, appearanceId } = parsed.data;
          const appearanceIds = appearanceIdsByCharacter.get(characterId);
          if (appearanceIds === undefined) {
            ctx.addIssue({
              code: "custom",
              message: `VisualCue ${cue.id} の characterId が存在しません: ${characterId}`,
              path: ["scenes"],
            });
          } else if (!appearanceIds.has(appearanceId)) {
            ctx.addIssue({
              code: "custom",
              message: `VisualCue ${cue.id} の appearanceId が存在しません: ${appearanceId}`,
              path: ["scenes"],
            });
          }
        }
      }
    }
  }

  for (const speaker of doc.speakers) {
    if (speaker.characterId !== null && !characterIds.has(speaker.characterId)) {
      ctx.addIssue({
        code: "custom",
        message: `Speaker ${speaker.id} の characterId が存在しません: ${speaker.characterId}`,
        path: ["speakers"],
      });
    }
  }

  const sceneIds = new Set(doc.scenes.map((scene) => scene.id));
  for (const cue of doc.audioCues) {
    if (cue.range.kind === "scene" && !sceneIds.has(cue.range.sceneId)) {
      ctx.addIssue({
        code: "custom",
        message: `AudioCue ${cue.id} の sceneId が存在しません: ${cue.range.sceneId}`,
        path: ["audioCues"],
      });
    }
  }
}

export const contentDocumentSchema = contentDocumentV2Object.superRefine(validateContentDocument);

const contentDocumentV1Object = z.strictObject({
  schemaVersion: z.literal(LEGACY_CONTENT_SCHEMA_VERSION),
  speakers: z.array(speakerV1Schema),
  ...baseDocumentShape,
});

export const contentDocumentV1ToV2Schema = contentDocumentV1Object
  .transform((doc): ContentDocument => ({
    ...doc,
    schemaVersion: CONTENT_SCHEMA_VERSION,
    speakers: doc.speakers.map((speaker) => ({ ...speaker, voiceProfileId: null })),
  }))
  .pipe(contentDocumentSchema);

export const contentDocumentInputSchema = z.union([
  contentDocumentSchema,
  contentDocumentV1ToV2Schema,
]);

export function parseContentDocument(input: unknown): ContentDocument {
  return contentDocumentInputSchema.parse(input);
}

export type ContentDocument = z.infer<typeof contentDocumentSchema>;
