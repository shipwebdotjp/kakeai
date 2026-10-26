import { useId } from "react";
import { ChevronDown, ChevronUp, Copy, Trash2 } from "lucide-react";
import {
  type Control,
  type UseFormGetValues,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import {
  type Asset,
  type ContentDocument,
  type FaceSet,
  type VoiceAdapterId,
  type VoiceProfile,
  type Warning,
} from "@kakeai/contracts";
import {
  type CharacterFormValue,
  type DocumentFormValues,
  type SceneFormValue,
  type SpeakerFormValue,
} from "../../content/form";
import { type StandingTransferMode } from "../../content/structural";
import { SCENE_LABELS, sceneDisplayName } from "../../content/labels";
import type { AdapterVoicesState } from "../../lib/voiceAdapters";
import {
  badgeDangerClass,
  badgeInfoClass,
  badgeNeutralClass,
  badgeWarningClass,
  buttonDangerClass,
  buttonNeutralClass,
  detailsSummaryClass,
  editAreaClass,
  iconButtonLargeClass,
  sectionCardClass,
  textFieldClass,
} from "../../ui";
import { InsertSceneFields } from "./InsertSceneFields";
import { TimingFields } from "./TimingFields";
import {
  SCENE_TRANSITION_LABELS,
  isMiddleScene,
  sceneHasStandings,
} from "./shared";
import { Collapsible, useStoredCollapsible } from "../Collapsible";
import { sceneFoldKey, sectionFoldKey } from "../../lib/collapseState";
import { CueList } from "../CueList";
import { LinesEditor } from "../LinesEditor";
import { StandingFields } from "../StandingFields";
import { SceneAudioFields } from "../SceneAudioFields";

function sceneSettingsSummary(
  scene: SceneFormValue,
  sceneIndex: number,
): string {
  const parts = [scene.accentKind === "custom" ? "自由色" : "テーマ色"];
  parts.push(
    scene.timingMode === "fixed" ? `固定 ${scene.durationMs}ms` : "自動",
  );
  if (sceneIndex > 0) {
    parts.push(
      SCENE_TRANSITION_LABELS[scene.transitionPreset] ?? scene.transitionPreset,
    );
  }
  return parts.join(" / ");
}

interface SceneBlockProps {
  control: Control<DocumentFormValues>;
  register: UseFormRegister<DocumentFormValues>;
  getValues: UseFormGetValues<DocumentFormValues>;
  setValue: UseFormSetValue<DocumentFormValues>;
  base: ContentDocument;
  scene: SceneFormValue;
  sceneIndex: number;
  pointOrdinal: number;
  prevKind: SceneFormValue["kind"] | undefined;
  nextKind: SceneFormValue["kind"] | undefined;
  durationMs: number | null;
  durationError: string | null;
  durationLines: readonly {
    lineId: string;
    startMs: number;
    endMs: number;
    gapBeforeMs: number;
    durationMs: number;
  }[];
  errorCount: number;
  warningCount: number;
  assets: readonly Asset[];
  assetsLoading: boolean;
  assetsError: boolean;
  speakers: SpeakerFormValue[];
  characters: CharacterFormValue[];
  voiceProfiles: VoiceProfile[];
  adapterVoices: Record<VoiceAdapterId, AdapterVoicesState>;
  savedVoiceByLineId: ReadonlyMap<string, string | null>;
  bulkRunning: boolean;
  faceSets: FaceSet[];
  faceSetsReady: boolean;
  scriptVersionId: string;
  onMove: (sceneIndex: number, direction: -1 | 1) => void;
  onRemoveScene: (sceneIndex: number) => void;
  onClonePrevious: (sceneIndex: number) => void;
  onRemoveCue: (sceneIndex: number, cueId: string) => void;
  onCommitCue: (sceneIndex: number, cueId: string) => void;
  onMoveCueRequest: (sceneIndex: number, cueId: string) => void;
  onCopyCueRequest: (sceneIndex: number, cueId: string) => void;
  onCommitStanding: (sceneIndex: number, side: "left" | "right") => void;
  onTransferStandingsRequest: (
    sceneIndex: number,
    mode: StandingTransferMode,
  ) => void;
  onCommitAudioCue: (sceneIndex: number, cueIndex: number) => void;
  onSplitScene: (sceneIndex: number, lineIndex: number) => void;
  onJumpToLine?: (lineId: string) => void;
  onWarnings: (warnings: Warning[]) => void;
  onError: (message: string) => void;
}

export function SceneBlock(props: SceneBlockProps) {
  const { scene, sceneIndex } = props;
  const [sceneOpen, setSceneOpen] = useStoredCollapsible(
    sceneFoldKey(scene.id),
    false,
  );
  const bodyId = useId();
  const displayName = sceneDisplayName(scene, props.pointOrdinal);
  const lineCount = scene.lines.length;
  const cueCount = scene.cues.length;
  const audioCount = scene.audioCues.length;
  const unvoicedCount =
    scene.kind === "point"
      ? scene.lines.filter((line) => line.selectedAudioTakeId === null).length
      : 0;
  const durationText =
    props.durationMs !== null
      ? `${(props.durationMs / 1000).toFixed(1)}秒`
      : (props.durationError ?? "尺不明");
  const headerSummary =
    scene.kind === "point"
      ? `セリフ${lineCount}件・映像演出${cueCount}件・${durationText}`
      : `映像演出${cueCount}件・${durationText}`;

  return (
    <section id={`scene-${scene.id}`} className={sectionCardClass}>
      <div className="mt-0 mb-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={sceneOpen}
          aria-controls={bodyId}
          aria-label={`シーン「${displayName}」を${sceneOpen ? "閉じる" : "開く"}`}
          onClick={() => setSceneOpen(!sceneOpen)}
          className={detailsSummaryClass}
        >
          <ChevronDown
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 transition-transform ${sceneOpen ? "" : "-rotate-90"}`}
          />
          <span className="font-normal text-muted-foreground">
            {headerSummary}
          </span>
          {unvoicedCount > 0 && (
            <span className={badgeWarningClass}>未音声{unvoicedCount}件</span>
          )}
          {props.errorCount > 0 && (
            <span className={badgeDangerClass}>エラー{props.errorCount}件</span>
          )}
          {props.warningCount > 0 && (
            <span className={badgeWarningClass}>
              警告{props.warningCount}件
            </span>
          )}
        </button>
        <input
          aria-label="シーン名"
          placeholder="シーン名"
          className={`min-w-[160px] flex-1 font-semibold ${textFieldClass}`}
          {...props.register(`scenes.${sceneIndex}.label`)}
        />
        <span
          className={
            scene.kind === "point" ? badgeInfoClass : badgeNeutralClass
          }
        >
          {SCENE_LABELS[scene.kind] ?? scene.kind}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {scene.id}
        </span>
        {(scene.kind === "point" || scene.kind === "insert") && (
          <span className="ml-auto flex gap-1">
            {scene.kind === "point" && (
              <button
                type="button"
                className={buttonNeutralClass}
                disabled={props.prevKind !== "point"}
                onClick={() => props.onClonePrevious(sceneIndex)}
              >
                <Copy aria-hidden="true" className="h-4 w-4" />
                前のシーンを複製
              </button>
            )}
            <button
              type="button"
              className={iconButtonLargeClass}
              aria-label="上へ移動"
              title="上へ移動"
              disabled={!isMiddleScene(props.prevKind)}
              onClick={() => props.onMove(sceneIndex, -1)}
            >
              <ChevronUp aria-hidden="true" className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={iconButtonLargeClass}
              aria-label="下へ移動"
              title="下へ移動"
              disabled={!isMiddleScene(props.nextKind)}
              onClick={() => props.onMove(sceneIndex, 1)}
            >
              <ChevronDown aria-hidden="true" className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={buttonDangerClass}
              onClick={() => props.onRemoveScene(sceneIndex)}
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
              削除
            </button>
          </span>
        )}
      </div>

      <div id={bodyId} hidden={!sceneOpen}>
        <Collapsible
          title="シーン設定"
          summary={sceneSettingsSummary(scene, sceneIndex)}
          storageKey={`scene-settings-${scene.id}`}
        >
          <TimingFields
            control={props.control}
            register={props.register}
            setValue={props.setValue}
            sceneIndex={sceneIndex}
            sceneKind={scene.kind}
            insertLoop={
              scene.kind === "insert" &&
              scene.cues.find((cue) => cue.id === scene.mainVisualCueId)?.fields
                .loop === "true"
            }
          />

          <Collapsible
            title="尺の内訳"
            className="mt-1 text-xs"
            storageKey={`scene-duration-${scene.id}`}
          >
            {(() => {
              if (props.durationMs === null) {
                return props.durationError !== null ? (
                  <p>尺の計算: {props.durationError}</p>
                ) : null;
              }
              return (
                <>
                  <p>シーン尺: {(props.durationMs / 1000).toFixed(1)}秒</p>
                  {props.durationLines.length > 0 && (
                    <ol className="my-1 ml-4 list-decimal p-0">
                      {props.durationLines
                        .flatMap((line) => {
                          const entries: { key: string; text: string }[] = [];
                          if (line.gapBeforeMs > 0) {
                            entries.push({
                              key: `${line.lineId}-gap`,
                              text: `間 ${((line.startMs - line.gapBeforeMs) / 1000).toFixed(2)}s 〜 ${(line.startMs / 1000).toFixed(2)}s（${(line.gapBeforeMs / 1000).toFixed(2)}秒）`,
                            });
                          }
                          entries.push({
                            key: line.lineId,
                            text: `${(line.startMs / 1000).toFixed(2)}s 〜 ${(line.endMs / 1000).toFixed(2)}s（${(line.durationMs / 1000).toFixed(2)}秒）`,
                          });
                          return entries;
                        })
                        .map((entry) => (
                          <li key={entry.key}>{entry.text}</li>
                        ))}
                    </ol>
                  )}
                </>
              );
            })()}
          </Collapsible>
        </Collapsible>

        <Collapsible
          title={
            scene.kind === "insert"
              ? `映像演出（インサート動画）`
              : `映像演出（${cueCount}件）`
          }
          storageKey={sectionFoldKey(scene.id, "visual")}
          defaultOpen
          className={editAreaClass}
        >
          {scene.kind === "insert" ? (
            <InsertSceneFields
              scene={scene}
              sceneIndex={sceneIndex}
              assets={props.assets}
              assetsLoading={props.assetsLoading}
              assetsError={props.assetsError}
              register={props.register}
              setValue={props.setValue}
              onError={props.onError}
              bare
            />
          ) : (
            <CueList
              control={props.control}
              register={props.register}
              setValue={props.setValue}
              getValues={props.getValues}
              sceneIndex={sceneIndex}
              sceneId={scene.id}
              lines={scene.lines}
              speakers={props.speakers}
              sceneDurationMs={props.durationMs}
              onRemoveCue={(cueId) => props.onRemoveCue(sceneIndex, cueId)}
              onCommitCue={(cueId) => props.onCommitCue(sceneIndex, cueId)}
              onMoveCue={(cueId) => props.onMoveCueRequest(sceneIndex, cueId)}
              onCopyCue={(cueId) => props.onCopyCueRequest(sceneIndex, cueId)}
              bare
            />
          )}
        </Collapsible>

        {scene.kind !== "insert" && (
          <StandingFields
            control={props.control}
            register={props.register}
            getValues={props.getValues}
            setValue={props.setValue}
            sceneIndex={sceneIndex}
            sceneId={scene.id}
            characters={props.characters}
            onCommitStanding={(side) =>
              props.onCommitStanding(sceneIndex, side)
            }
            onMoveStandings={
              sceneHasStandings(scene)
                ? () => props.onTransferStandingsRequest(sceneIndex, "move")
                : null
            }
            onCopyStandings={
              sceneHasStandings(scene)
                ? () => props.onTransferStandingsRequest(sceneIndex, "copy")
                : null
            }
            onSwapStandings={() =>
              props.onTransferStandingsRequest(sceneIndex, "swap")
            }
          />
        )}

        <Collapsible
          title={
            audioCount === 0
              ? "シーン音声（未設定）"
              : `シーン音声（${audioCount}件）`
          }
          storageKey={sectionFoldKey(scene.id, "audio")}
          defaultOpen
          className={editAreaClass}
        >
          <SceneAudioFields
            control={props.control}
            register={props.register}
            getValues={props.getValues}
            setValue={props.setValue}
            sceneIndex={sceneIndex}
            onCommitAudioCue={(cueIndex) =>
              props.onCommitAudioCue(sceneIndex, cueIndex)
            }
            bare
          />
        </Collapsible>

        {scene.kind === "point" && (
          <Collapsible
            title={`セリフ（${lineCount}件）`}
            summary={unvoicedCount > 0 ? `未音声${unvoicedCount}件` : undefined}
            storageKey={sectionFoldKey(scene.id, "lines")}
            defaultOpen
            className={editAreaClass}
          >
            <LinesEditor
              control={props.control}
              register={props.register}
              getValues={props.getValues}
              setValue={props.setValue}
              base={props.base}
              onError={props.onError}
              sceneIndex={sceneIndex}
              sceneId={scene.id}
              scriptVersionId={props.scriptVersionId}
              speakers={props.speakers}
              characters={props.characters}
              voiceProfiles={props.voiceProfiles}
              adapterVoices={props.adapterVoices}
              savedVoiceByLineId={props.savedVoiceByLineId}
              bulkRunning={props.bulkRunning}
              faceSets={props.faceSets}
              faceSetsReady={props.faceSetsReady}
              onSplitScene={props.onSplitScene}
              onJumpToLine={props.onJumpToLine}
              onWarnings={props.onWarnings}
              bare
            />
          </Collapsible>
        )}
      </div>
    </section>
  );
}
