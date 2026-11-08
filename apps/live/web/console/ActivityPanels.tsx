import type { LiveNoticeLevel, RunLogEvent } from "@kakeai/contracts";
import { formatTimestamp } from "./format";

export interface NoticeEntry {
  id: number;
  level: LiveNoticeLevel;
  message: string;
  at: string;
}

export function NoticesPanel({ notices }: { notices: NoticeEntry[] }) {
  return (
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
  );
}

function eventText(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function EventsPanel({ events }: { events: RunLogEvent[] }) {
  return (
    <section className="panel">
      <h2>イベント</h2>
      {events.length === 0 ? (
        <p className="muted">まだイベントはありません。</p>
      ) : (
        <ul className="events">
          {events.map((event) => {
            const reason = eventText(event.data.reason);
            const message = eventText(event.data.message);
            return (
              <li key={`${event.runId}-${event.sequence}`}>
                <span className="mono">{formatTimestamp(event.at)}</span>
                <span className="event-type">{event.type}</span>
                {event.cueId === undefined || event.cueId === null ? null : (
                  <span className="mono">{event.cueId}</span>
                )}
                {event.cutInId === undefined || event.cutInId === null ? null : (
                  <span className="mono">CutIn: {event.cutInId}</span>
                )}
                {event.segmentId === undefined || event.segmentId === null ? null : (
                  <span className="mono">セグメント: {event.segmentId}</span>
                )}
                {reason === null ? null : (
                  <span className="event-detail">理由: {reason}</span>
                )}
                {message === null ? null : <span className="event-detail">{message}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
