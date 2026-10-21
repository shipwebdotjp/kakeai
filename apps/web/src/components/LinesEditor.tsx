import { useEffect, useRef, useState } from "react";
import { Ellipsis, Play } from "lucide-react";
import {
  useFieldArray,
  useWatch,
  type Control,
  type UseFormGetValues,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import {
  MAX_TTS_SPEECH_TEXT_LENGTH,
  MAX_TTS_SPEED_SCALE,
  MIN_TTS_SPEED_SCALE,
  voiceAdapterDescriptorFor,
  type ContentDocument,
  type FaceSet,
  type ScriptOperation,
  type VoiceAdapterId,
  type Warning,
  type VoiceProfile,
} from "@kakeai/contracts";
import type {
  CharacterFormValue,
  DocumentFormValues,
  LineFormValue,
  SpeakerFormValue,
  StandingFormValue,
  TakeFormValue,
} from "../content/form";
import {
  countLineCueReferences,
  DEFAULT_NEW_LINE_GAP_BEFORE_MS,
  generatedTakePolicy,
  lineSummary,
  mergeTake,
  newSpeakerId,
  type GeneratedTakeSelect,
} from "../content/form";
import {
  applyStructuralOperation,
  applyStructuralOperations,
} from "../content/structural";
import { useAssets, useGenerateTtsTake } from "../api/hooks";
import { type AdapterVoicesState, adapterLabel } from "../lib/voiceAdapters";
import {
  buttonDangerClass,
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  iconButtonClass,
  metaTextClass,
  textFieldClass,
} from "../ui";
import { Collapsible, useStoredCollapsible } from "./Collapsible";
import { MediaPicker } from "./MediaPicker";
import { TakeAudioPlayer } from "./TakeAudioPlayer";

interface LinesEditorProps {
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
  faceSets: FaceSet[];
  faceSetsReady: boolean;
  onSplitScene: (sceneIndex: number, lineIndex: number) => void;
  onJumpToLine?: (lineId: string) => void;
}

function formatDuration(durationMs: number): string {
  const seconds = durationMs / 1000;
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)}秒`;
}

interface LineEditorProps
  extends Omit<
    LinesEditorProps,
    "control" | "onSplitScene" | "base" | "onError" | "onWarnings"
  > {
  lineIndex: number;
  line: LineFormValue;
  standings: StandingFormValue[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onSplit: () => void;
  onRemove: () => void;
  onJumpToLine?: (lineId: string) => void;
  onCommitLineFields: (
    lineId: string,
    operations: ScriptOperation[],
  ) => void;
}

interface LineActionsMenuProps {
  canMoveUp: boolean;
  canMoveDown: boolean;
  canSplit: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const MENU_ITEM_CLASS =
  "block w-full whitespace-nowrap rounded px-2 py-1 text-left text-sm hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40";

const MENU_DANGER_ITEM_CLASS =
  "block w-full whitespace-nowrap rounded px-2 py-1 text-left text-sm text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-950";

function LineActionsMenu({
  canMoveUp,
  canMoveDown,
  canSplit,
  onMoveUp,
  onMoveDown,
  onSplit,
  onDuplicate,
  onDelete,
}: LineActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current !== null && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="セリフ操作"
        className={iconButtonClass}
        onClick={() => setOpen((previous) => !previous)}
      >
        <Ellipsis aria-hidden="true" className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 min-w-48 rounded border border-border bg-surface p-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            className={MENU_ITEM_CLASS}
            disabled={!canMoveUp}
            onClick={() => run(onMoveUp)}
          >
            上へ
          </button>
          <button
            type="button"
            role="menuitem"
            className={MENU_ITEM_CLASS}
            disabled={!canMoveDown}
            onClick={() => run(onMoveDown)}
          >
            下へ
          </button>
          {canSplit && (
            <button
              type="button"
              role="menuitem"
              className={MENU_ITEM_CLASS}
              onClick={() => run(onSplit)}
            >
              このセリフの前でシーンを分割
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className={MENU_ITEM_CLASS}
            onClick={() => run(onDuplicate)}
          >
            複製
          </button>
          <button
            type="button"
            role="menuitem"
            className={MENU_DANGER_ITEM_CLASS}
            onClick={() => run(onDelete)}
          >
            削除
          </button>
        </div>
      )}
    </div>
  );
}

const MIN_SPEED = MIN_TTS_SPEED_SCALE;
const MAX_SPEED = MAX_TTS_SPEED_SCALE;
const SPEED_STEP = 0.05;

function LineEditor({
  register,
  getValues,
  setValue,
  sceneIndex,
  sceneId,
  lineIndex,
  line,
  canMoveUp,
  canMoveDown,
  onMove,
  onDuplicate,
  onSplit,
  onRemove,
  onJumpToLine,
  onCommitLineFields,
  speakers,
  characters,
  standings,
  faceSets,
  faceSetsReady,
  voiceProfiles,
  adapterVoices,
  savedVoiceByLineId,
  bulkRunning,
  scriptVersionId,
}: LineEditorProps) {
  const assets = useAssets();
  const generate = useGenerateTtsTake(scriptVersionId);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [speedScale, setSpeedScale] = useState(1);
  const [autoPlayToken, setAutoPlayToken] = useState(0);
  const autoPlayTakeIdRef = useRef<string | null>(null);
  const manualProfileRef = useRef<string | null>(null);

  const speaker = speakers.find((entry) => entry.id === line.speakerId);
  const characterId = speaker?.characterId ?? null;
  const character = characters.find((entry) => entry.id === characterId);
  const standingAppearanceIds = new Set(
    (standings ?? [])
      .filter((standing) => standing?.characterId === characterId)
      .map((standing) => standing?.appearanceId),
  );
  const faceSet = faceSets.find((entry) =>
    character?.appearances.some(
      (appearance) => appearance.faceSetId === entry.id && standingAppearanceIds.has(appearance.id),
    ),
  );
  const presets = faceSet?.expressions ?? [];
  const staleExpression =
    line.expressionId !== null &&
    faceSetsReady &&
    !presets.some((preset) => preset.id === line.expressionId);
  const profileId = character?.voiceProfileId ?? speaker?.voiceProfileId ?? null;
  const profile = voiceProfiles.find((entry) => entry.id === profileId);
  const adapterState = profile === undefined ? undefined : adapterVoices[profile.adapterId];
  const adapterName = profile === undefined ? "" : adapterLabel(profile.adapterId);
  const listedVoices = adapterState?.voices;
  const voices = listedVoices ?? [];
  const manualVoice =
    profile !== undefined &&
    voiceAdapterDescriptorFor(profile.adapterId).voiceSelection === "list-or-manual";
  const effectiveVoiceId = voiceId ?? profile?.voiceId ?? null;
  const voice = voices.find((entry) => entry.voiceId === effectiveVoiceId);

  useEffect(() => {
    if (profile === undefined) {
      manualProfileRef.current = null;
      setVoiceId(null);
      return;
    }
    if (manualVoice) {
      if (manualProfileRef.current !== profile.id) {
        manualProfileRef.current = profile.id;
        setVoiceId(profile.voiceId);
      }
      return;
    }
    manualProfileRef.current = null;
    setVoiceId((previous) => {
      if (previous !== null && voices.some((entry) => entry.voiceId === previous)) {
        return previous;
      }
      return voices.some((entry) => entry.voiceId === profile.voiceId)
        ? profile.voiceId
        : (voices[0]?.voiceId ?? null);
    });
  }, [profile?.id, profile?.voiceId, listedVoices, manualVoice]);

  useEffect(() => {
    setSpeedScale(1);
  }, [profile?.id, effectiveVoiceId]);

  const fileName = (assetId: string): string =>
    assets.data?.find((asset) => asset.id === assetId)?.originalFilename ?? assetId;

  const path = `scenes.${sceneIndex}.lines.${lineIndex}` as const;

  const addTake = (
    assetId: string,
    durationMs: number,
    source: "manual" | "tts",
    select: GeneratedTakeSelect = "always",
  ): string => {
    const scenes = getValues("scenes");
    for (let targetSceneIndex = 0; targetSceneIndex < scenes.length; targetSceneIndex += 1) {
      const scene = scenes[targetSceneIndex];
      if (scene === undefined) {
        continue;
      }
      const targetLineIndex = scene.lines.findIndex((entry) => entry.id === line.id);
      if (targetLineIndex === -1) {
        continue;
      }
      const current = scene.lines[targetLineIndex];
      if (current === undefined) {
        continue;
      }
      const next = mergeTake(current, { assetId, durationMs, source }, select);
      setValue(`scenes.${targetSceneIndex}.lines.${targetLineIndex}.takes`, next.takes, {
        shouldDirty: true,
      });
      setValue(
        `scenes.${targetSceneIndex}.lines.${targetLineIndex}.selectedAudioTakeId`,
        next.selectedAudioTakeId,
        { shouldDirty: true },
      );
      return next.selectedAudioTakeId ?? "";
    }
    return "";
  };

  const addManualTake = (assetId: string) => {
    const asset = assets.data?.find((entry) => entry.id === assetId);
    if (asset === undefined || asset.durationMs === null) {
      return;
    }
    addTake(assetId, asset.durationMs, "manual");
  };

  const deleteTake = (takeId: string) => {
    const takes = (getValues(`${path}.takes`) ?? []) as TakeFormValue[];
    setValue(
      `${path}.takes`,
      takes.filter((take) => take.id !== takeId),
      { shouldDirty: true },
    );
    if (getValues(`${path}.selectedAudioTakeId`) === takeId) {
      setValue(`${path}.selectedAudioTakeId`, null, { shouldDirty: true });
    }
  };

  const commitExpression = (expressionId: string | null) => {
    onCommitLineFields(line.id, [
      {
        op: "line.setExpression",
        sceneId,
        lineId: line.id,
        expressionId,
      },
    ]);
  };

  const onChangeCharacter = (nextId: string) => {
    const clearExpression: ScriptOperation = {
      op: "line.setExpression",
      sceneId,
      lineId: line.id,
      expressionId: null,
    };
    if (nextId === "") {
      onCommitLineFields(line.id, [
        {
          op: "line.setSpeaker",
          sceneId,
          lineId: line.id,
          speakerId: null,
        },
        clearExpression,
      ]);
      return;
    }
    const existing = speakers.find((entry) => entry.characterId === nextId);
    if (existing !== undefined) {
      onCommitLineFields(line.id, [
        {
          op: "line.setSpeaker",
          sceneId,
          lineId: line.id,
          speakerId: existing.id,
        },
        clearExpression,
      ]);
      return;
    }
    const selected = characters.find((entry) => entry.id === nextId);
    const speakerId = newSpeakerId();
    setValue(
      "speakers",
      [
        ...getValues("speakers"),
        {
          id: speakerId,
          name: selected?.name ?? "",
          characterId: nextId,
          voiceProfileId: selected?.voiceProfileId ?? null,
        },
      ],
      { shouldDirty: true },
    );
    onCommitLineFields(line.id, [
      {
        op: "line.setSpeaker",
        sceneId,
        lineId: line.id,
        speakerId,
      },
      clearExpression,
    ]);
  };

  const onGenerate = () => {
    if (effectiveVoiceId === null) {
      return;
    }
    const policy = generatedTakePolicy("individual");
    generate.mutate(
      {
        narrationSegmentId: line.id,
        voiceId: effectiveVoiceId.trim(),
        speedScale,
        speechText: getValues(`${path}.speechText`) ?? line.speechText,
      },
      {
        onSuccess: (result) => {
          const takeId = addTake(result.assetId, result.durationMs, "tts", policy.select);
          if (policy.autoplay) {
            autoPlayTakeIdRef.current = takeId;
            setAutoPlayToken((token) => token + 1);
          }
        },
      },
    );
  };

  const takes = line.takes;
  const saved = savedVoiceByLineId.has(line.id);
  const savedVoice = savedVoiceByLineId.get(line.id) ?? null;
  const voiceMatches = saved && profileId === savedVoice;
  const speechLength = line.speechText.trim().length;
  const speechReady = speechLength > 0 && speechLength <= MAX_TTS_SPEECH_TEXT_LENGTH;
  const ttsDisabled =
    bulkRunning || generate.isPending || effectiveVoiceId === null || !voiceMatches || !speechReady;
  const audioNeedsAttention =
    staleExpression ||
    generate.isError ||
    (profileId !== null && profile === undefined) ||
    (profile !== undefined &&
      adapterState?.loading !== true &&
      (adapterState === undefined ||
        adapterState.failed ||
        (!manualVoice && voice === undefined)));
  const audioSummary = takes.length === 0 ? "音声なし" : `候補 ${takes.length}件`;
  const [audioOpen, setAudioOpen] = useStoredCollapsible(`line-audio-${line.id}`, false);

  const captionPath = `${path}.captionText` as const;
  const speechPath = `${path}.speechText` as const;
  const gapPath = `${path}.gapBeforeMs` as const;
  const captionFocusRef = useRef(line.captionText);
  const speechFocusRef = useRef(line.speechText);
  const gapFocusRef = useRef(line.gapBeforeMs);
  const captionRegistration = register(captionPath);
  const speechRegistration = register(speechPath);
  const gapRegistration = register(gapPath, {
    valueAsNumber: true,
    min: 0,
  });

  useEffect(() => {
    if (audioNeedsAttention) {
      setAudioOpen(true);
    }
  }, [audioNeedsAttention, setAudioOpen]);

  return (
    <div id={`line-${line.id}`} className="my-2 grid gap-1.5 rounded border border-border p-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium break-words">
          {lineIndex + 1}. {lineSummary(line, speakers)}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {onJumpToLine !== undefined && (
            <button
              type="button"
              className={iconButtonClass}
              title="プレビューをこのセリフへ移動"
              aria-label="プレビューをこのセリフへ移動"
              onClick={() => onJumpToLine(line.id)}
            >
              <Play aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
          <LineActionsMenu
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            canSplit={lineIndex > 0}
            onMoveUp={() => onMove(-1)}
            onMoveDown={() => onMove(1)}
            onSplit={onSplit}
            onDuplicate={onDuplicate}
            onDelete={onRemove}
          />
        </span>
      </div>
      <textarea
        rows={2}
        placeholder="字幕テキスト"
        className={`block w-full ${textFieldClass}`}
        {...captionRegistration}
        onFocus={(event) => {
          captionFocusRef.current = event.target.value;
        }}
        onBlur={(event) => {
          captionRegistration.onBlur?.(event);
          if (event.target.value === captionFocusRef.current) {
            return;
          }
          onCommitLineFields(line.id, [
            {
              op: "line.setText",
              sceneId,
              lineId: line.id,
              captionText: event.target.value,
            },
          ]);
        }}
      />
      <input
        placeholder="読み上げテキスト（TTS用）"
        className={`block w-full ${textFieldClass}`}
        {...speechRegistration}
        onFocus={(event) => {
          speechFocusRef.current = event.target.value;
        }}
        onBlur={(event) => {
          speechRegistration.onBlur?.(event);
          if (event.target.value === speechFocusRef.current) {
            return;
          }
          onCommitLineFields(line.id, [
            {
              op: "line.setText",
              sceneId,
              lineId: line.id,
              speechText: event.target.value,
            },
          ]);
        }}
      />
      <label className="inline-flex items-center gap-1.5 text-sm">
        このセリフの前の間（ms）
        <input
          type="number"
          min={0}
          className={`w-24 ${textFieldClass}`}
          {...gapRegistration}
          onFocus={(event) => {
            gapFocusRef.current = event.target.valueAsNumber;
          }}
          onBlur={(event) => {
            gapRegistration.onBlur?.(event);
            const parsed = event.target.valueAsNumber;
            if (!Number.isFinite(parsed)) {
              setValue(
                gapPath,
                Number.isFinite(gapFocusRef.current) ? gapFocusRef.current : 0,
                { shouldDirty: true },
              );
              return;
            }
            const gapBeforeMs = Math.max(0, Math.floor(parsed));
            if (gapBeforeMs !== parsed) {
              setValue(gapPath, gapBeforeMs, { shouldDirty: true });
            }
            if (gapBeforeMs === gapFocusRef.current) {
              return;
            }
            onCommitLineFields(line.id, [
              {
                op: "line.setGap",
                sceneId,
                lineId: line.id,
                gapBeforeMs,
              },
            ]);
          }}
        />
      </label>
      <label className="inline-flex items-center gap-1.5 text-sm">
        キャラクター
        <select
          className={textFieldClass}
          value={characterId ?? ""}
          onChange={(event) => onChangeCharacter(event.target.value)}
        >
          <option value="">なし</option>
          {characters.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name || entry.id}
            </option>
          ))}
        </select>
      </label>
      <Collapsible
        title="音声詳細"
        summary={audioNeedsAttention ? `要確認・${audioSummary}` : audioSummary}
        open={audioOpen}
        onOpenChange={setAudioOpen}
      >
      {staleExpression ? (
        <p className={metaTextClass}>
          表情「{line.expressionId}」は参照先の立ち絵・表情セットにありません。
          <button
            type="button"
            className={buttonNeutralClass}
            onClick={() => commitExpression(null)}
          >
            クリア
          </button>
        </p>
      ) : presets.length > 0 ? (
        <label className="inline-flex items-center gap-1.5 text-sm">
          表情
          <select
            className={textFieldClass}
            value={line.expressionId ?? ""}
            onChange={(event) =>
              commitExpression(
                event.target.value === "" ? null : event.target.value,
              )
            }
          >
            <option value="">
              通常（{presets.find((preset) => preset.id === "normal")?.name ?? "normal"}）
            </option>
            {presets
              .filter((preset) => preset.id !== "normal")
              .map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name || preset.id}
                </option>
              ))}
          </select>
        </label>
      ) : null}

      <div className="mt-1">
        {takes.length === 0 ? (
          <p className={metaTextClass}>音声なし（字幕のみ）</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {takes.map((take) => (
              <li key={take.id} className="flex flex-wrap items-center gap-2 py-0.5">
                <label className="inline-flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name={`line-${line.id}`}
                    checked={line.selectedAudioTakeId === take.id}
                    onChange={() =>
                      setValue(`${path}.selectedAudioTakeId`, take.id, { shouldDirty: true })
                    }
                  />
                  {take.source === "tts" ? "TTS: " : ""}
                  {fileName(take.assetId)}（{formatDuration(take.durationMs)}）
                </label>
                <TakeAudioPlayer
                  assetId={take.assetId}
                  autoPlayToken={autoPlayTakeIdRef.current === take.id ? autoPlayToken : 0}
                />
                <button
                  type="button"
                  className={buttonDangerClass}
                  onClick={() => deleteTake(take.id)}
                >
                  候補削除
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {line.selectedAudioTakeId !== null && (
            <button
              type="button"
              className={buttonNeutralClass}
              onClick={() => setValue(`${path}.selectedAudioTakeId`, null, { shouldDirty: true })}
            >
              音声解除
            </button>
          )}
          <MediaPicker
            label="音声追加"
            inline
            kinds={["audio"]}
            selectedAssetId={null}
            variant="add"
            onSelect={(assetId) => {
              if (assetId !== null) {
                addManualTake(assetId);
              }
            }}
          />
        </div>
      </div>

      <div className="mt-2">
        <p className={metaTextClass}>TTS生成</p>
        {profileId === null ? (
          <p className={metaTextClass}>
            キャラクターを選び、声プロファイルを設定すると TTS を生成できます。
          </p>
        ) : profile === undefined ? (
          <p className={metaTextClass}>
            この話者に声プロファイルが設定されていません。
          </p>
        ) : adapterState?.loading ? (
          <p className={metaTextClass}>音声一覧を読み込み中…</p>
        ) : adapterState === undefined || adapterState.failed ? (
          <p className={errorTextClass}>
            {adapterName} ENGINE に接続できません。起動しているか確認してください。
          </p>
        ) : !manualVoice && voice === undefined ? (
          <p className={errorTextClass}>
            声プロファイルの声が {adapterName} ENGINE に見つかりません。
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5">
              声
              {manualVoice ? (
                <>
                  <input
                    className={textFieldClass}
                    list={`line-voice-${line.id}`}
                    value={effectiveVoiceId ?? ""}
                    onChange={(event) => {
                      const next = event.target.value.trim();
                      setVoiceId(next.length === 0 ? null : next);
                    }}
                  />
                  <datalist id={`line-voice-${line.id}`}>
                    {voices.map((entry) => (
                      <option key={entry.voiceId} value={entry.voiceId}>
                        {entry.name}
                      </option>
                    ))}
                  </datalist>
                </>
              ) : (
                <select
                  className={textFieldClass}
                  value={effectiveVoiceId ?? ""}
                  onChange={(event) => {
                    setVoiceId(event.target.value === "" ? null : event.target.value);
                  }}
                >
                  {voices.map((entry) => (
                    <option key={entry.voiceId} value={entry.voiceId}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label className="inline-flex items-center gap-1.5">
              話速
              <input
                type="number"
                min={MIN_SPEED}
                max={MAX_SPEED}
                step={SPEED_STEP}
                className={`w-20 ${textFieldClass}`}
                value={speedScale}
                onChange={(event) => {
                  const raw = event.target.value;
                  if (raw === "") {
                    return;
                  }
                  const next = Number(raw);
                  if (Number.isFinite(next)) {
                    setSpeedScale(Math.min(MAX_SPEED, Math.max(MIN_SPEED, next)));
                  }
                }}
              />
              倍
            </label>
            <button
              type="button"
              className={buttonPrimaryClass}
              disabled={ttsDisabled}
              onClick={onGenerate}
            >
              {generate.isPending ? "生成中…" : "TTS生成"}
            </button>
          </div>
        )}
        {!saved && (
          <p className={metaTextClass}>新しいセリフは一度保存してから生成できます。</p>
        )}
        {saved && !voiceMatches && profileId !== null && (
          <p className={metaTextClass}>声の変更は保存後に生成できます。</p>
        )}
        {saved && voiceMatches && speechLength === 0 && profileId !== null && (
          <p className={metaTextClass}>読み上げテキストを入力してください。</p>
        )}
        {saved && voiceMatches && speechLength > MAX_TTS_SPEECH_TEXT_LENGTH && (
          <p className={metaTextClass}>読み上げテキストが長すぎます。</p>
        )}
        {generate.isError && <p className={errorTextClass}>{generate.error.message}</p>}
      </div>
      </Collapsible>
    </div>
  );
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
  faceSets,
  faceSetsReady,
  onSplitScene,
  onJumpToLine,
}: LinesEditorProps) {
  const { fields, replace } = useFieldArray({
    control,
    name: `scenes.${sceneIndex}.lines`,
  });
  const watchedLines = useWatch({ control, name: `scenes.${sceneIndex}.lines` }) ?? [];
  const watchedStandings = useWatch({ control, name: `scenes.${sceneIndex}.standings` }) ?? [];

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
      onError(error instanceof Error ? error.message : "構造操作に失敗しました。");
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
      const next = applyStructuralOperations(
        base,
        getValues(),
        operations,
        [],
      );
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
        `このセリフは ${usage} 件のCueの表示区間に使われています。削除すると該当するCueの区間を調整します。`,
      )
    ) {
      return;
    }
    runStructural({ op: "line.remove", sceneId, lineId: line.id });
  };

  return (
    <div className="mt-3 border-t border-dashed border-border pt-2">
      <h4 className="mb-2 font-semibold">セリフ</h4>
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
            faceSets={faceSets}
            faceSetsReady={faceSetsReady}
            voiceProfiles={voiceProfiles}
            adapterVoices={adapterVoices}
            savedVoiceByLineId={savedVoiceByLineId}
            bulkRunning={bulkRunning}
          />
        );
      })}
      <button
        type="button"
        className={buttonNeutralClass}
        onClick={() =>
          runStructural({
            op: "line.add",
            sceneId,
            gapBeforeMs: DEFAULT_NEW_LINE_GAP_BEFORE_MS,
          })
        }
      >
        セリフを追加
      </button>
    </div>
  );
}
