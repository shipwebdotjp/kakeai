import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  ConsoleSnapshot,
  LiveCommand,
  LiveNoticeLevel,
  LiveServerMessage,
  RunLogEvent,
} from "@kakeai/contracts";
import { openLiveSocket, type LiveSocket, type LiveSocketStatus } from "../shared/socket";
import "./styles.css";

interface NoticeEntry {
  id: number;
  level: LiveNoticeLevel;
  message: string;
  at: string;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString("ja-JP", { hour12: false });
}

function shortSessionId(sessionId: string): string {
  return sessionId.length <= 18 ? sessionId : `${sessionId.slice(0, 10)}…${sessionId.slice(-4)}`;
}

const STATUS_LABELS: Record<LiveSocketStatus, string> = {
  open: "接続中",
  connecting: "接続待ち",
  closed: "切断",
};

const PHASE_LABELS: Record<ConsoleSnapshot["phase"], string> = {
  pre_show: "開始前",
  opening: "オープニング",
  script: "本編",
  material: "素材",
  comment: "コメント",
  closing: "クロージング",
  post_show: "終了後",
  paused: "一時停止",
  safe_mode: "安全モード",
  error: "エラー",
};

function phaseCanPause(phase: ConsoleSnapshot["phase"]): boolean {
  return (
    phase === "opening" ||
    phase === "script" ||
    phase === "material" ||
    phase === "comment" ||
    phase === "closing" ||
    phase === "safe_mode"
  );
}

function App() {
  const [snapshot, setSnapshot] = useState<ConsoleSnapshot | null>(null);
  const [status, setStatus] = useState<LiveSocketStatus>("connecting");
  const [notices, setNotices] = useState<NoticeEntry[]>([]);
  const [events, setEvents] = useState<RunLogEvent[]>([]);
  const [takeoverSession, setTakeoverSession] = useState("");
  const socketRef = useRef<LiveSocket | null>(null);
  const noticeId = useRef(0);
  const runIdRef = useRef<string | null>(null);

  const pushNotice = (level: LiveNoticeLevel, message: string) => {
    noticeId.current += 1;
    setNotices((current) => [
      { id: noticeId.current, level, message, at: new Date().toISOString() },
      ...current,
    ].slice(0, 12));
  };

  useEffect(() => {
    const handleMessage = (message: LiveServerMessage) => {
      switch (message.type) {
        case "snapshot":
          setSnapshot(message.snapshot);
          break;
        case "notice":
          pushNotice(message.level, message.message);
          break;
        case "event":
          setEvents((current) => [message.event, ...current].slice(0, 40));
          break;
        case "hello":
          if (runIdRef.current !== null && runIdRef.current !== message.runId) {
            setEvents([]);
            setNotices([]);
            setSnapshot(null);
          }
          runIdRef.current = message.runId;
          break;
        default:
          break;
      }
    };
    const socket = openLiveSocket({ role: "console", onMessage: handleMessage, onStatus: setStatus });
    socketRef.current = socket;
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, []);

  const previewStages = useMemo(
    () => snapshot?.stages.filter((stage) => stage.role === "preview") ?? [],
    [snapshot],
  );

  useEffect(() => {
    if (
      takeoverSession !== "" &&
      snapshot !== null &&
      !snapshot.stages.some((stage) => stage.sessionId === takeoverSession)
    ) {
      setTakeoverSession("");
    }
  }, [snapshot, takeoverSession]);

  const sendCommand = (command: LiveCommand) => {
    const sent = socketRef.current?.send({ type: "command", command }) ?? false;
    if (!sent) {
      pushNotice("warning", "サーバ未接続のためコマンドを送信できませんでした。");
    }
  };

  const phase = snapshot?.phase;

  return (
    <div className="console">
      <header className="topbar">
        <div>
          <h1>Kakeai Live コンソール</h1>
          <p className="show-title">{snapshot?.show.title ?? "ライブパッケージを読み込み中…"}</p>
        </div>
        <div className={`connection connection-${status}`}>
          WebSocket: {STATUS_LABELS[status]}
        </div>
      </header>

      {snapshot === null ? (
        <main className="empty-state">
          <p>ライブサーバに接続しています…</p>
        </main>
      ) : (
        <main className="layout">
          <section className="panel main-panel">
            <div className="summary">
              <div>
                <p className="label">フェーズ</p>
                <p className="phase">{PHASE_LABELS[snapshot.phase]}</p>
                <p className="muted">{snapshot.segment?.label ?? "—"}</p>
              </div>
              <div>
                <p className="label">経過</p>
                <p className="time">{formatTime(snapshot.clock.elapsedMs)}</p>
              </div>
              <div>
                <p className="label">残り</p>
                <p className="time">{formatTime(snapshot.clock.remainingMs)}</p>
              </div>
              <div>
                <p className="label">状態</p>
                <p className="status">{snapshot.status}</p>
              </div>
            </div>

            <div className="controls">
              <button
                type="button"
                className="primary"
                disabled={phase !== "pre_show"}
                onClick={() => sendCommand({ kind: "start" })}
              >
                開始
              </button>
              <button
                type="button"
                disabled={phase === "pre_show" || phase === "post_show"}
                onClick={() => sendCommand({ kind: "end" })}
              >
                終了
              </button>
              <button
                type="button"
                disabled={!phaseCanPause(snapshot.phase)}
                onClick={() => sendCommand({ kind: "pause" })}
              >
                一時停止
              </button>
              <button
                type="button"
                disabled={phase !== "paused"}
                onClick={() => sendCommand({ kind: "resume" })}
              >
                再開
              </button>
              <button
                type="button"
                className="danger"
                disabled={phase === "pre_show" || phase === "post_show"}
                onClick={() => sendCommand({ kind: "stop" })}
              >
                停止
              </button>
              <button
                type="button"
                className="warning"
                disabled={!phaseCanPause(snapshot.phase)}
                onClick={() => sendCommand({ kind: "safe_mode" })}
              >
                安全モード
              </button>
            </div>

            <section className="block">
              <h2>セグメント</h2>
              <ol className="segments">
                {snapshot.show.segments.map((segment) => (
                  <li
                    key={segment.id}
                    className={snapshot.segment?.id === segment.id ? "active" : undefined}
                  >
                    <span className="segment-kind">{segment.kind}</span>
                    <span className="segment-label">{segment.label}</span>
                    <span className="muted">{formatTime(segment.targetDurationMs)}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="block">
              <h2>キュー</h2>
              <div className="queue-scroll">
                <table className="queue">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>話者</th>
                      <th>字幕</th>
                      <th>状態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.queue.map((cue) => (
                      <tr
                        key={cue.id}
                        className={snapshot.currentCueId === cue.id ? "current" : undefined}
                      >
                        <td className="mono">{cue.id}</td>
                        <td>{cue.speaker === "left" ? "左" : "右"}</td>
                        <td className="caption-cell">{cue.caption}</td>
                        <td>
                          <span className={`cue-status cue-status-${cue.status}`}>{cue.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </section>

          <aside className="sidebar">
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
                  value={takeoverSession}
                  onChange={(event) => setTakeoverSession(event.target.value)}
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
                      sendCommand({ kind: "takeover_program", sessionId: takeoverSession });
                    }
                  }}
                >
                  program を引き継ぐ
                </button>
              </div>
            </section>

            <section className="panel">
              <h2>通知</h2>
              {notices.length === 0 ? (
                <p className="muted">通知はありません。</p>
              ) : (
                <ul className="notices">
                  {notices.map((notice) => (
                    <li key={notice.id} className={`notice notice-${notice.level}`}>
                      <span className="mono">{formatTimestamp(notice.at)}</span>
                      <span>{notice.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel">
              <h2>イベント</h2>
              {events.length === 0 ? (
                <p className="muted">まだイベントはありません。</p>
              ) : (
                <ul className="events">
                  {events.map((event) => (
                    <li key={`${event.runId}-${event.sequence}`}>
                      <span className="mono">{formatTimestamp(event.at)}</span>
                      <span className="event-type">{event.type}</span>
                      {event.cueId === undefined || event.cueId === null ? null : (
                        <span className="mono">{event.cueId}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </main>
      )}
    </div>
  );
}

const root = document.getElementById("root");
if (root === null) {
  throw new Error("#root が見つかりません");
}
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
