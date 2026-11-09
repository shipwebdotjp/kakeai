import type {
  Asset,
  LiveProgramCue,
  LiveProgramCueSegment,
  LiveProgramDocument,
} from "@kakeai/contracts";
import { updateCue } from "../model/cues";
import { setCueVisual } from "../model/visual";
import { resolveEffectiveVisual } from "../model/visual";
import { formatDuration } from "../duration";
import {
  errorTextClass,
  metaTextClass,
  sectionTitleClass,
  textFieldClass,
  warningTextClass,
} from "../../ui";
import { VisualSelect } from "./VisualSelect";
import type { LiveProgramValidationIssue } from "../model/validation";
import { ValidationIssues } from "./ValidationIssues";

interface CueEditorProps {
  document: LiveProgramDocument;
  segment: LiveProgramCueSegment;
  cue: LiveProgramCue;
  audioAssets: readonly Asset[];
  expressionOptions: readonly string[];
  issues: readonly LiveProgramValidationIssue[];
  onChangeDocument: (updater: (document: LiveProgramDocument) => LiveProgramDocument) => void;
}

export function CueEditor({
  document,
  segment,
  cue,
  audioAssets,
  expressionOptions,
  issues,
  onChangeDocument,
}: CueEditorProps) {
  const effective = resolveEffectiveVisual(segment, cue);
  const missingAudioAssetId =
    cue.audioAssetId !== undefined &&
    !audioAssets.some((asset) => asset.id === cue.audioAssetId)
      ? cue.audioAssetId
      : null;
  const segmentVisualLabel =
    segment.visual === undefined
      ? "なし"
      : segment.visual.kind === "card"
        ? `カード ${segment.visual.cardId} / ${segment.visual.stateId}`
        : `素材 ${segment.visual.materialId}`;

  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <h2 className={sectionTitleClass}>Cue 編集</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          話者
          <select
            className={`mt-1 w-full ${textFieldClass}`}
            value={cue.speaker}
            onChange={(event) =>
              onChangeDocument((current) =>
                updateCue(current, cue.id, {
                  speaker: event.target.value === "right" ? "right" : "left",
                }),
              )
            }
          >
            <option value="left">左</option>
            <option value="right">右</option>
          </select>
          {cue.speaker === "right" && document.cast.right === null && (
            <span className={warningTextClass}>
              右キャラクターが未設定です。版確定時に拒否されます。
            </span>
          )}
        </label>

        <label className="block text-sm">
          表情
          <input
            className={`mt-1 w-full ${textFieldClass}`}
            list={`cue-expression-${cue.id}`}
            value={cue.expression}
            onChange={(event) =>
              onChangeDocument((current) =>
                updateCue(current, cue.id, { expression: event.target.value }),
              )
            }
          />
          <datalist id={`cue-expression-${cue.id}`}>
            {expressionOptions.map((expression) => (
              <option key={expression} value={expression} />
            ))}
          </datalist>
        </label>

        <label className="block text-sm sm:col-span-2">
          字幕
          <textarea
            className={`mt-1 min-h-16 w-full ${textFieldClass}`}
            value={cue.caption}
            onChange={(event) =>
              onChangeDocument((current) =>
                updateCue(current, cue.id, { caption: event.target.value }),
              )
            }
          />
        </label>

        <label className="block text-sm sm:col-span-2">
          読み上げ
          <textarea
            className={`mt-1 min-h-16 w-full ${textFieldClass}`}
            value={cue.speech}
            onChange={(event) =>
              onChangeDocument((current) =>
                updateCue(current, cue.id, { speech: event.target.value }),
              )
            }
          />
        </label>

        <label className="block text-sm sm:col-span-2">
          音声 Asset（任意）
          <select
            className={`mt-1 w-full ${textFieldClass}`}
            value={cue.audioAssetId ?? ""}
            onChange={(event) =>
              onChangeDocument((current) =>
                updateCue(current, cue.id, {
                  audioAssetId:
                    event.target.value === "" ? undefined : event.target.value,
                }),
              )
            }
          >
            <option value="">TTSで生成（音声Assetを使わない）</option>
            {missingAudioAssetId !== null && (
              <option value={missingAudioAssetId} disabled>
                {missingAudioAssetId}（見つかりません）
              </option>
            )}
            {audioAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.originalFilename}（{formatDuration(asset.durationMs ?? 0)}）
              </option>
            ))}
          </select>
          {missingAudioAssetId !== null && (
            <span className={errorTextClass}>
              指定した音声Asset（{missingAudioAssetId}）が利用できません。版確定・書き出しは失敗します。
            </span>
          )}
          <span className={metaTextClass}>
            指定したAssetが利用できない場合、版確定・書き出しは失敗します。
          </span>
        </label>

        <div className="sm:col-span-2">
          <p className="m-0 mb-1 text-sm">中央ビジュアル</p>
          <VisualSelect
            mode="cue"
            value={cue.visual}
            cards={document.cards}
            materials={document.materials}
            onChange={(value) =>
              onChangeDocument((current) => setCueVisual(current, cue.id, value))
            }
          />
          <p className={`mt-1 ${metaTextClass}`}>
            継承 = セグメント既定（{segmentVisualLabel}） / 実効:{" "}
            {effective.source === "cue"
              ? "Cue指定"
              : effective.source === "segment"
                ? "Segment既定"
                : "表示なし"}
          </p>
        </div>
      </div>

      {issues.length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <ValidationIssues issues={issues} />
        </div>
      )}
    </section>
  );
}
