import { useEffect, useState } from "react";
import type { ConsoleSnapshot, LiveCommand, LiveCue } from "@kakeai/contracts";
import { formatTimestamp } from "./format";

const PHASE_LABELS: Record<NonNullable<ConsoleSnapshot["generation"]>["phase"], string> = {
  thinking: "考え中",
  preparing: "音声を準備中",
  ready: "準備完了",
  failed: "失敗",
};

const SOURCE_LABELS: Record<LiveCue["source"], string> = {
  prepared: "準備済み",
  generated: "生成",
  manual: "手動",
  fallback: "退避",
};

const SIDE_LABELS: Record<LiveCue["speaker"], string> = { left: "左", right: "右" };

const EDITABLE_STATUSES = new Set<LiveCue["status"]>(["draft", "preparing", "ready"]);
const MOVABLE_STATUSES = new Set<LiveCue["status"]>(["draft", "ready"]);

interface EditDraft {
  cueId: string;
  caption: string;
  speech: string;
  expression: string;
}

interface GenerationPanelProps {
  snapshot: ConsoleSnapshot;
  onCommand: (command: LiveCommand) => void;
}

function audioLabel(cue: LiveCue): string {
  if (cue.audio === null) {
    return "—";
  }
  return cue.audio.startsWith("run:") ? cue.audio : `package: ${cue.audio}`;
}

/**
 * Generated-response monitor and operator controls. Commands return no result
 * over the socket, so every action is fire-and-forget; the next snapshot and
 * the existing notice channel show the outcome. Every displayed string is
 * rendered as a React text node.
 */
export function GenerationPanel({ snapshot, onCommand }: GenerationPanelProps) {
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [correctionId, setCorrectionId] = useState("");
  const generation = snapshot.generation;
  const currentCueId = snapshot.currentCueId;
  const generated = snapshot.queue.filter((cue) => cue.source !== "prepared");
  const correctionCues = snapshot.queue.filter(
    (cue) => cue.origin === "live" && cue.source === "prepared",
  );
  const correctionValue = correctionCues.some((cue) => cue.id === correctionId)
    ? correctionId
    : "";

  useEffect(() => {
    if (draft === null) {
      return;
    }
    const cue = snapshot.queue.find((entry) => entry.id === draft.cueId);
    if (
      cue === undefined ||
      cue.id === snapshot.currentCueId ||
      !EDITABLE_STATUSES.has(cue.status)
    ) {
      setDraft(null);
      setEditError(null);
    }
  }, [draft, snapshot.queue, snapshot.currentCueId]);

  const beginEdit = (cue: LiveCue): void => {
    setDraft({
      cueId: cue.id,
      caption: cue.caption,
      speech: cue.speech,
      expression: cue.expression,
    });
    setEditError(null);
  };

  const closeEdit = (): void => {
    setDraft(null);
    setEditError(null);
  };

  const submitEdit = (cue: LiveCue): void => {
    if (draft === null || draft.cueId !== cue.id) {
      return;
    }
    const patch: { caption?: string; speech?: string; expression?: string } = {};
    const caption = draft.caption.trim();
    const speech = draft.speech.trim();
    const expression = draft.expression.trim();
    if (caption !== "" && caption !== cue.caption) {
      patch.caption = caption;
    }
    if (speech !== "" && speech !== cue.speech) {
      patch.speech = speech;
    }
    if (expression !== "" && expression !== cue.expression) {
      patch.expression = expression;
    }
    if (Object.keys(patch).length === 0) {
      setEditError("変更された項目がありません。空欄は送信しません。");
      return;
    }
    onCommand({ kind: "edit_cue", cueId: cue.id, ...patch });
    closeEdit();
  };

  const queuePosition = (cueId: string): number =>
    snapshot.queue.findIndex((entry) => entry.id === cueId);
  const positions = generated.map((cue) => queuePosition(cue.id));

  const canMove = (index: number): boolean =>
    MOVABLE_STATUSES.has(generated[index]?.status ?? "done") &&
    generated[index]?.id !== currentCueId;

  const moveUp = (cueId: string, index: number): void => {
    const before = generated[index - 1];
    // The server only reorders within one segment. Do not jump over a
    // prepared cue that happens to sit between generated rows.
    if (
      before === undefined ||
      positions[index - 1] !== positions[index]! - 1 ||
      !MOVABLE_STATUSES.has(before.status) ||
      !canMove(index)
    ) {
      return;
    }
    onCommand({ kind: "move_cue", cueId, beforeCueId: before.id });
  };

  const moveDown = (cueId: string, index: number): void => {
    const next = generated[index + 1];
    if (
      next === undefined ||
      positions[index + 1] !== positions[index]! + 1 ||
      !MOVABLE_STATUSES.has(next.status) ||
      !canMove(index)
    ) {
      return;
    }
    const afterNext = generated[index + 2];
    const beforeCueId =
      afterNext !== undefined && positions[index + 2] === positions[index + 1]! + 1
        ? afterNext.id
        : null;
    onCommand({ kind: "move_cue", cueId, beforeCueId });
  };

  return (
    <section className="block generation-panel">
      <div className="block-head">
        <h2>生成レス</h2>
        <span className="queue-position">{generated.length} 件</span>
      </div>

      {generation === null ? (
        <p className="muted">
          生成中の応答はありません。コメントコーナーに入ると、ここに生成の進行とキューが表示されます。
        </p>
      ) : (
        <div className={`generation-status generation-status-${generation.phase}`}>
          <div className="generation-status-head">
            <span className="generation-phase">{PHASE_LABELS[generation.phase]}</span>
            {generation.phase === "thinking" || generation.phase === "preparing" ? (
              <span className="generation-progress">処理中…</span>
            ) : null}
            <span className="muted">更新 {formatTimestamp(generation.updatedAt)}</span>
          </div>
          <div className="generation-meta">
            <span>commentId</span>
            <span className="mono">{generation.commentId ?? "—"}</span>
            <span>cueIds</span>
            <span className="mono">
              {generation.cueIds.length === 0 ? "—" : generation.cueIds.join(", ")}
            </span>
            <span>エラー</span>
            <span className={generation.error === null ? "mono" : "generation-error"}>
              {generation.error ?? "—"}
            </span>
          </div>
          {generation.phase === "failed" && generation.error !== null ? (
            <p className="generation-alert" role="alert">
              {generation.error}
            </p>
          ) : null}
        </div>
      )}

      <p className="generation-hint">
        編集は字幕・読み上げ・表情を個別に送ります。読み上げを変えると再TTSします。再生中は
        編集・削除・並べ替えができません（上部の「停止」か下の訂正を使います）。
      </p>

      {generated.length === 0 ? (
        <p className="muted">生成キューはありません。</p>
      ) : (
        <div className="generation-list">
          {generated.map((cue, index) => {
            const isCurrent = cue.id === currentCueId;
            const notStarted = EDITABLE_STATUSES.has(cue.status) && !isCurrent;
            const editable = cue.source === "generated" && notStarted;
            const movable = MOVABLE_STATUSES.has(cue.status) && !isCurrent;
            const cancellable =
              (cue.source === "generated" || cue.source === "manual") && notStarted;
            const regenerable =
              cue.source === "generated" && notStarted && cue.commentId !== null;
            const deletable = cue.status === "ready" && !isCurrent;
            const previous = generated[index - 1];
            const next = generated[index + 1];
            const canMoveUp =
              movable &&
              previous !== undefined &&
              positions[index - 1] === positions[index]! - 1 &&
              MOVABLE_STATUSES.has(previous.status);
            const canMoveDown =
              movable &&
              next !== undefined &&
              positions[index + 1] === positions[index]! + 1 &&
              MOVABLE_STATUSES.has(next.status);
            const speechChanged =
              draft !== null && draft.cueId === cue.id && draft.speech.trim() !== cue.speech;
            return (
              <article
                key={cue.id}
                className={`generation-row${isCurrent ? " current" : ""}`}
              >
                <div className="generation-row-head">
                  <span className="mono">{cue.id}</span>
                  {isCurrent ? <span className="generation-now">再生中</span> : null}
                  <span className={`source-badge source-${cue.source}`}>
                    {SOURCE_LABELS[cue.source]}
                  </span>
                  <span className={`cue-status cue-status-${cue.status}`}>{cue.status}</span>
                  <span className="generation-speaker">{SIDE_LABELS[cue.speaker]}</span>
                  <span className="mono">{cue.commentId ?? "comment: —"}</span>
                </div>

                {draft !== null && draft.cueId === cue.id ? (
                  <div className="generation-edit">
                    <label>
                      字幕
                      <input
                        value={draft.caption}
                        onChange={(event) =>
                          setDraft({ ...draft, caption: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      読み上げ
                      <input
                        value={draft.speech}
                        onChange={(event) =>
                          setDraft({ ...draft, speech: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      表情
                      <input
                        value={draft.expression}
                        onChange={(event) =>
                          setDraft({ ...draft, expression: event.target.value })
                        }
                      />
                    </label>
                    {speechChanged ? (
                      <p className="generation-note">読み上げを変更すると再TTSします。</p>
                    ) : null}
                    {editError === null ? null : (
                      <p className="generation-error">{editError}</p>
                    )}
                    <div className="generation-actions">
                      <button
                        type="button"
                        className="primary"
                        onClick={() => submitEdit(cue)}
                      >
                        保存
                      </button>
                      <button type="button" onClick={closeEdit}>
                        閉じる
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="generation-caption">{cue.caption}</p>
                    <p className="generation-speech">読み: {cue.speech}</p>
                    <p className="generation-expression">表情: {cue.expression}</p>
                    <p className="generation-audio mono">audio: {audioLabel(cue)}</p>
                    <div className="generation-actions">
                      <button
                        type="button"
                        disabled={!editable}
                        onClick={() => beginEdit(cue)}
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        disabled={!cancellable}
                        title="生成中・準備完了・未再生のキューをキャンセルします"
                        onClick={() => onCommand({ kind: "cancel_cue", cueId: cue.id })}
                      >
                        キャンセル
                      </button>
                      <button
                        type="button"
                        disabled={!regenerable}
                        onClick={() => onCommand({ kind: "regenerate_cue", cueId: cue.id })}
                      >
                        再生成
                      </button>
                      <button
                        type="button"
                        className="danger"
                        disabled={!deletable}
                        title="準備完了後・再生開始前のキューを削除します"
                        onClick={() => onCommand({ kind: "delete_cue", cueId: cue.id })}
                      >
                        削除
                      </button>
                      <button
                        type="button"
                        aria-label={`${cue.id} を上へ移動`}
                        title="上へ移動"
                        disabled={!canMoveUp}
                        onClick={() => moveUp(cue.id, index)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`${cue.id} を下へ移動`}
                        title="下へ移動"
                        disabled={!canMoveDown}
                        onClick={() => moveDown(cue.id, index)}
                      >
                        ↓
                      </button>
                    </div>
                    {isCurrent ? (
                      <p className="generation-note">
                        再生中は停止・訂正のみ行えます。停止は上部の「停止」から実行します。
                      </p>
                    ) : null}
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}

      <div className="generation-correction">
        <h3>訂正</h3>
        <p className="generation-hint">
          準備済みのライブキューを選び、現在のキューの直後に差し込みます。現在のキューは停止しません。
          再生中のキューが無い場合は、コメントコーナーの応答キューとして再生します。
        </p>
        {correctionCues.length === 0 ? (
          <p className="muted">訂正に使える準備済みライブキューはありません。</p>
        ) : (
          <div className="inline-form">
            <select
              aria-label="訂正する準備済みキュー"
              value={correctionValue}
              onChange={(event) => setCorrectionId(event.target.value)}
            >
              <option value="">訂正キューを選択</option>
              {correctionCues.map((cue) => (
                <option key={cue.id} value={cue.id}>
                  {cue.id}: {cue.caption}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="warning"
              disabled={correctionValue === ""}
              onClick={() =>
                onCommand({ kind: "play_correction", cueId: correctionValue })
              }
            >
              訂正を再生
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
