import { MessageSquarePlus } from "lucide-react";
import {
  useFieldArray,
  useWatch,
  type Control,
  type UseFormGetValues,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import {
  type ContentDocument,
  type ScriptOperation,
  type VoiceAdapterId,
  type Warning,
  type VoiceProfile,
} from "@kakeai/contracts";
import type {
  CharacterFormValue,
  DocumentFormValues,
  SpeakerFormValue,
} from "../content/form";
import {
  countLineCueReferences,
  DEFAULT_NEW_LINE_GAP_BEFORE_MS,
} from "../content/form";
import {
  applyStructuralOperation,
  applyStructuralOperations,
} from "../content/structural";
import { type AdapterVoicesState } from "../lib/voiceAdapters";
import { buttonNeutralClass, editAreaClass } from "../ui";
import { LineEditor } from "./lines-editor/LineEditor";

export interface LinesEditorProps {
  control: Control<DocumentFormValues>;
  register: UseFormRegister<DocumentFormValues>;
  getValues: UseFormGetValues<DocumentFormValues>;
  setValue: UseFormSetValue<DocumentFormValues>;
  base: ContentDocument;
  onError: (message: string) => void;
  onWarnings: (warnings: Warning[]) => void;
  sceneIndex: number;
  sceneId: string;
  scriptVersionId: string;
  speakers: SpeakerFormValue[];
  characters: CharacterFormValue[];
  voiceProfiles: VoiceProfile[];
  adapterVoices: Record<VoiceAdapterId, AdapterVoicesState>;
  savedVoiceByLineId: ReadonlyMap<string, string | null>;
  bulkRunning: boolean;
  onSplitScene: (sceneIndex: number, lineIndex: number) => void;
  onJumpToLine?: (lineId: string) => void;
  /** SceneEditor側の折りたたみ内に置くときは外枠と見出しを出さない */
  bare?: boolean;
}

export function LinesEditor({
  control,
  register,
  getValues,
  setValue,
  base,
  onError,
  onWarnings,
  sceneIndex,
  sceneId,
  scriptVersionId,
  speakers,
  characters,
  voiceProfiles,
  adapterVoices,
  savedVoiceByLineId,
  bulkRunning,
  onSplitScene,
  onJumpToLine,
  bare = false,
}: LinesEditorProps) {
  const { fields, replace } = useFieldArray({
    control,
    name: `scenes.${sceneIndex}.lines`,
  });
  const watchedLines =
    useWatch({ control, name: `scenes.${sceneIndex}.lines` }) ?? [];
  const watchedStandings =
    useWatch({ control, name: `scenes.${sceneIndex}.standings` }) ?? [];

  const runStructural = (operation: ScriptOperation): void => {
    try {
      const next = applyStructuralOperation(base, getValues(), operation);
      const operationSceneId =
        "sceneId" in operation && typeof operation.sceneId === "string"
          ? operation.sceneId
          : sceneId;
      const scene = next.values.scenes.find(
        (entry) => entry.id === operationSceneId,
      );
      if (scene === undefined) {
        onError("構造操作の対象Sceneが見つかりません。");
        return;
      }
      replace(scene.lines);
      setValue(`scenes.${sceneIndex}.cues`, scene.cues, { shouldDirty: true });
      onWarnings(next.result.warnings);
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "構造操作に失敗しました。",
      );
    }
  };

  const moveLine = (from: number, to: number) => {
    const line = getValues(`scenes.${sceneIndex}.lines.${from}`);
    if (line === undefined) {
      return;
    }
    runStructural({ op: "line.move", sceneId, lineId: line.id, index: to });
  };

  const commitLineFields = (
    lineId: string,
    operations: ScriptOperation[],
  ): void => {
    try {
      const next = applyStructuralOperations(base, getValues(), operations, []);
      const scene = next.values.scenes.find((entry) => entry.id === sceneId);
      const line = scene?.lines.find((entry) => entry.id === lineId);
      const lineIndex = getValues(`scenes.${sceneIndex}.lines`).findIndex(
        (entry) => entry.id === lineId,
      );
      if (line === undefined || lineIndex === -1) {
        onError("セリフの更新対象が見つかりません。");
        return;
      }
      const path = `scenes.${sceneIndex}.lines.${lineIndex}` as const;
      setValue(path, line, { shouldDirty: true });
      onWarnings(next.result.warnings);
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "セリフの更新に失敗しました。",
      );
    }
  };

  const duplicateLine = (lineIndex: number) => {
    const line = getValues(`scenes.${sceneIndex}.lines.${lineIndex}`);
    if (line === undefined) {
      return;
    }
    runStructural({
      op: "line.add",
      sceneId,
      index: lineIndex + 1,
      captionText: line.captionText,
      speechText: line.speechText,
      speakerId: line.speakerId,
      expressionId: line.expressionId,
      gapBeforeMs: Number.isFinite(line.gapBeforeMs) ? line.gapBeforeMs : 0,
    });
  };

  const removeLine = (lineIndex: number) => {
    const scene = getValues(`scenes.${sceneIndex}`);
    const line = scene?.lines[lineIndex];
    if (scene === undefined || line === undefined) {
      return;
    }
    const usage = countLineCueReferences(scene, line.id);
    if (
      usage > 0 &&
      !window.confirm(
        `このセリフは ${usage} 件の映像演出の表示区間に使われています。削除すると該当する映像演出の区間を調整します。`,
      )
    ) {
      return;
    }
    runStructural({ op: "line.remove", sceneId, lineId: line.id });
  };

  return (
    <div className={bare ? undefined : editAreaClass}>
      {!bare && (
        <h4 className="mb-2 text-sm font-semibold text-foreground">セリフ</h4>
      )}
      {fields.map((field, lineIndex) => {
        const line = watchedLines[lineIndex];
        if (line === undefined) {
          return null;
        }
        return (
          <LineEditor
            key={field.id}
            register={register}
            getValues={getValues}
            setValue={setValue}
            sceneIndex={sceneIndex}
            lineIndex={lineIndex}
            line={line}
            canMoveUp={lineIndex > 0}
            canMoveDown={lineIndex < fields.length - 1}
            onMove={(direction) => moveLine(lineIndex, lineIndex + direction)}
            onDuplicate={() => duplicateLine(lineIndex)}
            onSplit={() => onSplitScene(sceneIndex, lineIndex)}
            onRemove={() => removeLine(lineIndex)}
            onJumpToLine={onJumpToLine}
            onCommitLineFields={commitLineFields}
            sceneId={sceneId}
            scriptVersionId={scriptVersionId}
            speakers={speakers}
            characters={characters}
            standings={watchedStandings}
            voiceProfiles={voiceProfiles}
            adapterVoices={adapterVoices}
            savedVoiceByLineId={savedVoiceByLineId}
            bulkRunning={bulkRunning}
          />
        );
      })}
      <button
        type="button"
        className={`mt-2 ${buttonNeutralClass}`}
        onClick={() =>
          runStructural({
            op: "line.add",
            sceneId,
            gapBeforeMs: DEFAULT_NEW_LINE_GAP_BEFORE_MS,
          })
        }
      >
        <MessageSquarePlus aria-hidden="true" className="h-4 w-4" />
        セリフを追加
      </button>
    </div>
  );
}
