import type { VideoGate, VideoGateAudio, VideoPlayback } from "@kakeai/contracts";
import { useAssets } from "../api/hooks";
import {
  lineIndex,
  lineOptionLabel,
  parseVideoPlayback,
  serializeVideoPlayback,
  defaultVideoGate,
  type LineFormValue,
  type SpeakerFormValue,
} from "../content/form";
import {
  buttonDangerClass,
  buttonNeutralClass,
  editAreaClass,
  formLabelClass,
  formLabelTightClass,
  itemCardClass,
  metaTextClass,
  textFieldClass,
} from "../ui";

function numberValue(raw: string, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
}

function audioOf(gate: VideoGate): Extract<VideoGateAudio, { enabled: true }> | null {
  return gate.audio !== undefined && gate.audio.enabled ? gate.audio : null;
}

/**
 * 直接メディア入力・Nested Media が共有する Video Gate Playback の編集UI。
 * フォーム内部では `${field.key}__videoPlayback` の文字列として保持する。
 */
export function VideoPlaybackField({
  assetId,
  value,
  onChange,
  lines,
  speakers,
}: {
  assetId: string;
  value: string;
  onChange: (value: string) => void;
  lines: LineFormValue[];
  speakers: SpeakerFormValue[];
}) {
  const assets = useAssets();
  const asset = (assets.data ?? []).find((entry) => entry.id === assetId);
  if (asset === undefined || asset.kind !== "video") {
    return null;
  }
  const playback = parseVideoPlayback(value);
  if (playback === null) {
    return (
      <div className="my-2">
        <button
          type="button"
          className={buttonNeutralClass}
          disabled={lines.length === 0}
          onClick={() => {
            const first = lines[0];
            if (first === undefined) {
              return;
            }
            onChange(
              serializeVideoPlayback({
                mode: "gated",
                gates: [{ narrationSegmentId: first.id, sourceMs: 0 }],
              }),
            );
          }}
        >
          セリフゲート再生を有効にする
        </button>
        <p className={metaTextClass}>
          台詞の開始をゲートにし、動画が先へ進みすぎたときだけフレームを保持します。
        </p>
      </div>
    );
  }

  const update = (next: VideoPlayback): void => {
    onChange(serializeVideoPlayback(next));
  };
  const sortGates = (gates: VideoGate[]): VideoGate[] => {
    const sorted = [...gates].sort(
      (a, b) =>
        lineIndex(lines, a.narrationSegmentId) - lineIndex(lines, b.narrationSegmentId),
    );
    // 台詞順に並べ替えた結果 sourceMs が昇順でなくなる場合、契約（厳密昇順）を保つよう最小限持ち上げる。
    let previous = -1;
    return sorted.map((gate) => {
      const sourceMs = Math.max(gate.sourceMs, previous + 1);
      previous = sourceMs;
      return sourceMs === gate.sourceMs ? gate : { ...gate, sourceMs };
    });
  };
  const setGate = (index: number, patch: Partial<VideoGate>): void => {
    update({
      ...playback,
      gates: sortGates(
        playback.gates.map((gate, position) =>
          position === index ? { ...gate, ...patch } : gate,
        ),
      ),
    });
  };
  const setAudio = (index: number, audio: VideoGateAudio): void => {
    setGate(index, { audio });
  };
  const usedLines = new Set(playback.gates.map((gate) => gate.narrationSegmentId));
  const firstUnusedLine = lines.find((line) => !usedLines.has(line.id));

  return (
    <div className={editAreaClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">セリフゲート再生</span>
        <button type="button" className={buttonDangerClass} onClick={() => onChange("")}>
          解除
        </button>
      </div>
      <label className={formLabelTightClass}>
        再生終端(ms)
        <input
          type="number"
          min={1}
          className={`w-28 ${textFieldClass}`}
          placeholder="素材の末尾"
          value={playback.sourceEndMs ?? ""}
          onChange={(event) => {
            const raw = event.target.value;
            update({
              ...playback,
              sourceEndMs: raw === "" ? undefined : Math.max(1, numberValue(raw, 1)),
            });
          }}
        />
      </label>
      {playback.gates.map((gate, index) => {
        const audio = audioOf(gate);
        return (
          <div key={gate.narrationSegmentId} className={itemCardClass}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={metaTextClass}>{index + 1}</span>
              <select
                className={textFieldClass}
                value={gate.narrationSegmentId}
                onChange={(event) =>
                  setGate(index, { narrationSegmentId: event.target.value })
                }
              >
                {lines.map((line, linePosition) => (
                  <option
                    key={line.id}
                    value={line.id}
                    disabled={usedLines.has(line.id) && line.id !== gate.narrationSegmentId}
                  >
                    {lineOptionLabel(lines, linePosition, speakers)}
                  </option>
                ))}
              </select>
              <label className={formLabelClass}>
                source(ms)
                <input
                  type="number"
                  min={0}
                  className={`w-24 ${textFieldClass}`}
                  value={gate.sourceMs}
                  onChange={(event) =>
                    setGate(index, { sourceMs: numberValue(event.target.value, gate.sourceMs) })
                  }
                />
              </label>
              <button
                type="button"
                className={buttonDangerClass}
                onClick={() => {
                  const remaining = playback.gates.filter(
                    (_, position) => position !== index,
                  );
                  if (remaining.length === 0) {
                    onChange("");
                  } else {
                    update({ ...playback, gates: remaining });
                  }
                }}
              >
                削除
              </button>
            </div>
            <label className={formLabelTightClass}>
              <input
                type="checkbox"
                checked={audio !== null}
                onChange={(event) =>
                  setAudio(
                    index,
                    event.target.checked
                      ? { enabled: true, gainDb: 0, fadeInMs: 0, fadeOutMs: 0 }
                      : { enabled: false },
                  )
                }
              />
              この区間の音声を出す
            </label>
            {audio !== null && (
              <div className="flex flex-wrap items-center gap-2">
                <label className={formLabelClass}>
                  音量(dB)
                  <input
                    type="number"
                    className={`w-20 ${textFieldClass}`}
                    value={audio.gainDb ?? 0}
                    onChange={(event) =>
                      setAudio(index, {
                        ...audio,
                        gainDb: Math.max(-60, Math.min(12, Number(event.target.value) || 0)),
                      })
                    }
                  />
                </label>
                <label className={formLabelClass}>
                  フェードイン(ms)
                  <input
                    type="number"
                    min={0}
                    className={`w-20 ${textFieldClass}`}
                    value={audio.fadeInMs ?? 0}
                    onChange={(event) =>
                      setAudio(index, {
                        ...audio,
                        fadeInMs: numberValue(event.target.value, 0),
                      })
                    }
                  />
                </label>
                <label className={formLabelClass}>
                  フェードアウト(ms)
                  <input
                    type="number"
                    min={0}
                    className={`w-20 ${textFieldClass}`}
                    value={audio.fadeOutMs ?? 0}
                    onChange={(event) =>
                      setAudio(index, {
                        ...audio,
                        fadeOutMs: numberValue(event.target.value, 0),
                      })
                    }
                  />
                </label>
              </div>
            )}
          </div>
        );
      })}
      {playback.gates.length === 0 ? (
        <p className={metaTextClass}>ゲートがありません。台詞を1つ以上追加してください。</p>
      ) : null}
      <button
        type="button"
        className={buttonNeutralClass}
        disabled={firstUnusedLine === undefined}
        onClick={() => {
          const next = defaultVideoGate(playback.gates, lines);
          if (next === null) {
            return;
          }
          update({
            ...playback,
            gates: sortGates([...playback.gates, next]),
          });
        }}
      >
        ゲートを追加
      </button>
    </div>
  );
}
