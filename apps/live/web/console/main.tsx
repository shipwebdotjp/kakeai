import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  ConsoleSnapshot,
  LiveCommand,
  LiveNoticeLevel,
  LiveServerMessage,
  RunLogEvent,
} from "@kakeai/contracts";
import { openLiveSocket, type LiveSocket, type LiveSocketStatus } from "../shared/socket";
import { EventsPanel, NoticesPanel, type NoticeEntry } from "./ActivityPanels";
import { CommentCornerPanel } from "./CommentCornerPanel";
import { CommentsPanel } from "./CommentsPanel";
import { CommentSourcePanel } from "./CommentSourcePanel";
import { formatTime } from "./format";
import { GenerationPanel } from "./GenerationPanel";
import { PHASE_LABELS, STATUS_LABELS, phaseCanPause } from "./labels";
import { PreviewPanel } from "./PreviewPanel";
import { QueuePanel } from "./QueuePanel";
import { StagePanel } from "./StagePanel";
import "./styles.css";

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
    setNotices((current) =>
      [{ id: noticeId.current, level, message, at: new Date().toISOString() }, ...current].slice(
        0,
        12,
      ),
    );
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

  useEffect(() => {
    const isCandidate =
      snapshot !== null &&
      snapshot.stages.some(
        (stage) =>
          stage.sessionId === takeoverSession &&
          stage.role === "preview" &&
          stage.explicitPreview !== true,
      );
    if (takeoverSession !== "" && !isCandidate) {
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

            <QueuePanel
              snapshot={snapshot}
              onSkip={() => sendCommand({ kind: "skip_cue" })}
            />

            <GenerationPanel snapshot={snapshot} onCommand={sendCommand} />

            <CommentsPanel
              snapshot={snapshot}
              onPin={(commentId, note) =>
                sendCommand({
                  kind: "pin_comment",
                  commentId,
                  ...(note === undefined ? {} : { note }),
                })
              }
              onUnpin={(commentId) => sendCommand({ kind: "unpin_comment", commentId })}
              onSkip={(commentId) => sendCommand({ kind: "skip_comment", commentId })}
            />
          </section>

          <aside className="sidebar">
            <PreviewPanel />
            <CommentCornerPanel snapshot={snapshot} />
            <CommentSourcePanel
              snapshot={snapshot}
              onSetLiveChat={(liveChatId) =>
                sendCommand({ kind: "set_live_chat", liveChatId })
              }
              onPauseComments={() => sendCommand({ kind: "pause_comments" })}
              onResumeComments={() => sendCommand({ kind: "resume_comments" })}
              onBlockAuthor={(author) => sendCommand({ kind: "block_author", author })}
              onBlockTopic={(topic) => sendCommand({ kind: "block_topic", topic })}
            />
            <StagePanel
              snapshot={snapshot}
              takeoverSession={takeoverSession}
              onSelectTakeover={setTakeoverSession}
              onTakeover={(sessionId) =>
                sendCommand({ kind: "takeover_program", sessionId })
              }
            />
            <NoticesPanel notices={notices} />
            <EventsPanel events={events} />
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
