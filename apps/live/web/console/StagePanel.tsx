import { useMemo } from "react";
import type { ConsoleSnapshot } from "@kakeai/contracts";
import { formatTimestamp, shortSessionId } from "./format";

interface StagePanelProps {
  snapshot: ConsoleSnapshot;
  takeoverSession: string;
  onSelectTakeover: (sessionId: string) => void;
  onTakeover: (sessionId: string) => void;
}

export function StagePanel({
  snapshot,
  takeoverSession,
  onSelectTakeover,
  onTakeover,
}: StagePanelProps) {
  const previewStages = useMemo(
    () =>
      snapshot.stages.filter(
        (stage) => stage.role === "preview" && stage.explicitPreview !== true,
      ),
    [snapshot.stages],
  );

  return (
    <section className="panel">
      <h2>ステージ接続</h2>
      {snapshot.stages.length === 0 ? (
        <p className="muted">接続中のステージはありません。</p>
      ) : (
        <ul className="stages">
          {snapshot.stages.map((stage) => (
            <li key={stage.sessionId}>
              <span className={`role role-${stage.role}`}>{stage.role}</span>
              <span className="mono">{shortSessionId(stage.sessionId)}</span>
              <span className="muted">
                接続 {formatTimestamp(stage.connectedAt)} / 期限{" "}
                {formatTimestamp(stage.leaseExpiresAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="takeover">
        <select
          id="takeover-session"
          aria-label="program を引き継ぐステージ"
          value={takeoverSession}
          onChange={(event) => onSelectTakeover(event.target.value)}
        >
          <option value="">preview ステージを選択</option>
          {previewStages.map((stage) => (
            <option key={stage.sessionId} value={stage.sessionId}>
              {shortSessionId(stage.sessionId)}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={takeoverSession === ""}
          onClick={() => {
            if (takeoverSession !== "") {
              onTakeover(takeoverSession);
            }
          }}
        >
          program を引き継ぐ
        </button>
      </div>
    </section>
  );
}
