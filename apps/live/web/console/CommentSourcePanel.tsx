import { useEffect, useMemo, useState } from "react";
import type { ConsoleSnapshot } from "@kakeai/contracts";
import { formatTimestamp } from "./format";

interface CommentSourcePanelProps {
  snapshot: ConsoleSnapshot;
  onSetLiveChat: (liveChatId: string) => void;
  onPauseComments: () => void;
  onResumeComments: () => void;
  onBlockAuthor: (author: string) => void;
  onBlockTopic: (topic: string) => void;
}

export function CommentSourcePanel({
  snapshot,
  onSetLiveChat,
  onPauseComments,
  onResumeComments,
  onBlockAuthor,
  onBlockTopic,
}: CommentSourcePanelProps) {
  const status = snapshot.commentSource;
  const [liveChatId, setLiveChatId] = useState(status.liveChatId ?? "");
  const [author, setAuthor] = useState("");
  const [topic, setTopic] = useState("");

  useEffect(() => {
    setLiveChatId(status.liveChatId ?? "");
  }, [status.liveChatId]);

  const authors = useMemo(
    () =>
      [...new Set(snapshot.comments.map((entry) => entry.comment.authorName))].slice(0, 200),
    [snapshot.comments],
  );

  return (
    <section className="panel">
      <h2>コメントソース</h2>
      <div className="source-grid">
        <span className="source-label">種類</span>
        <span>{status.kind}</span>
        <span className="source-label">状態</span>
        <span>{status.state}</span>
        <span className="source-label">liveChatId</span>
        <span className="mono">{status.liveChatId ?? "—"}</span>
        <span className="source-label">ポーリング</span>
        <span>{status.pollingIntervalMs > 0 ? `${status.pollingIntervalMs} ms` : "—"}</span>
        <span className="source-label">最終取得</span>
        <span className="mono">
          {status.lastPolledAt === null ? "—" : formatTimestamp(status.lastPolledAt)}
        </span>
        <span className="source-label">クォータ</span>
        <span>
          {status.quota === null
            ? "—"
            : `${status.quota.requests} 回 / ${status.quota.units} units`}
        </span>
        <span className="source-label">認証期限</span>
        <span className="mono">
          {status.authExpiresAt === null ? "—" : formatTimestamp(status.authExpiresAt)}
        </span>
      </div>

      {status.needsReauth ? (
        <p className="source-warning">
          認証が失効しています。`npm run live -- auth --config &lt;file&gt;` で再認証してください。
        </p>
      ) : null}
      {status.lastError !== null ? (
        <p className="source-error">最終エラー: {status.lastError}</p>
      ) : null}

      <div className="inline-form">
        <input
          aria-label="liveChatId"
          placeholder="liveChatId を手動指定"
          value={liveChatId}
          onChange={(event) => setLiveChatId(event.target.value)}
        />
        <button
          type="button"
          disabled={liveChatId.trim() === "" || liveChatId === status.liveChatId}
          onClick={() => onSetLiveChat(liveChatId.trim())}
        >
          設定
        </button>
      </div>

      <div className="inline-form">
        <button type="button" onClick={onPauseComments}>
          コメント一時停止
        </button>
        <button type="button" onClick={onResumeComments}>
          コメント再開
        </button>
      </div>

      <div className="inline-form">
        <select
          aria-label="ブロックする投稿者"
          value={authors.includes(author) ? author : ""}
          onChange={(event) => setAuthor(event.target.value)}
        >
          <option value="">投稿者を選択</option>
          {authors.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <input
          aria-label="投稿者名"
          placeholder="投稿者名"
          value={author}
          onChange={(event) => setAuthor(event.target.value)}
        />
        <button
          type="button"
          className="danger"
          disabled={author.trim() === ""}
          onClick={() => onBlockAuthor(author.trim())}
        >
          投稿者ブロック
        </button>
      </div>

      <div className="inline-form">
        <input
          aria-label="ブロックする話題"
          placeholder="ブロックする話題"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
        />
        <button
          type="button"
          className="danger"
          disabled={topic.trim() === ""}
          onClick={() => {
            onBlockTopic(topic.trim());
            setTopic("");
          }}
        >
          話題ブロック
        </button>
      </div>
    </section>
  );
}
