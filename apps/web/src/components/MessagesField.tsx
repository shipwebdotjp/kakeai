import { MediaPicker } from "./MediaPicker";
import {
  buttonNeutralClass,
  errorTextClass,
  formLabelTextClass,
  metaTextClass,
  textFieldClass,
} from "../ui";

type Json = Record<string, unknown>;

interface MessagesFieldProps {
  label: string;
  fieldKey: string;
  value: string;
  setField: (key: string, value: string) => void;
  maxMessages: number;
}

const IMAGE_KINDS = ["image"] as const;

const SIDE_OPTIONS = [
  { value: "left", label: "左（相手）" },
  { value: "right", label: "右（自分）" },
] as const;

function parseMessages(value: string): Json[] | null {
  if (value.trim().length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return null;
    }
    const isRecord = (entry: unknown): entry is Json =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry);
    return parsed.every(isRecord) ? (parsed as Json[]) : null;
  } catch {
    return null;
  }
}

function iconAssetId(item: Json): string | null {
  const icon = item.icon;
  if (typeof icon === "object" && icon !== null) {
    const assetId = (icon as Json).assetId;
    return typeof assetId === "string" ? assetId : null;
  }
  return null;
}

export function MessagesField({
  label,
  fieldKey,
  value,
  setField,
  maxMessages,
}: MessagesFieldProps) {
  const messages = parseMessages(value);

  if (messages === null) {
    return (
      <div className="my-2">
        <span className={formLabelTextClass}>{label}</span>
        <p className={errorTextClass}>メッセージを読み取れませんでした。JSONで修正してください。</p>
        <textarea
          className={`mt-1 block w-full ${textFieldClass}`}
          rows={4}
          value={value}
          onChange={(event) => setField(fieldKey, event.target.value)}
        />
      </div>
    );
  }

  const commit = (next: Json[]) => setField(fieldKey, JSON.stringify(next));
  const update = (index: number, patch: Json) => {
    commit(messages.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  };

  return (
    <div className="my-2">
      <span className={formLabelTextClass}>{label}</span>
      <p className={metaTextClass}>
        会話を上から順に表示します。左右で吹き出しの向きが変わります。
      </p>
      {messages.map((item, index) => (
        <div key={index} className="mt-2 rounded border border-border p-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`w-32 ${textFieldClass}`}
              value={String(item.name ?? "")}
              placeholder="名前"
              onChange={(event) => update(index, { name: event.target.value })}
            />
            <select
              className={textFieldClass}
              value={String(item.side ?? "left")}
              onChange={(event) => update(index, { side: event.target.value })}
            >
              {SIDE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              className={`w-24 ${textFieldClass}`}
              value={String(item.time ?? "")}
              placeholder="時刻（任意）"
              onChange={(event) => {
                const next: Json = { ...item };
                if (event.target.value.length === 0) {
                  delete next.time;
                } else {
                  next.time = event.target.value;
                }
                commit(messages.map((entry, itemIndex) => (itemIndex === index ? next : entry)));
              }}
            />
            <button
              type="button"
              className={buttonNeutralClass}
              disabled={messages.length <= 1}
              onClick={() => commit(messages.filter((_item, itemIndex) => itemIndex !== index))}
            >
              削除
            </button>
          </div>
          <textarea
            className={`mt-1 block w-full ${textFieldClass}`}
            rows={2}
            value={String(item.body ?? "")}
            placeholder="本文"
            onChange={(event) => update(index, { body: event.target.value })}
          />
          <MediaPicker
            label="アイコン"
            kinds={IMAGE_KINDS}
            selectedAssetId={iconAssetId(item)}
            onSelect={(assetId) => {
              const next: Json = { ...item };
              if (assetId === null) {
                delete next.icon;
              } else {
                next.icon = { kind: "media", assetId };
              }
              commit(messages.map((entry, itemIndex) => (itemIndex === index ? next : entry)));
            }}
          />
        </div>
      ))}
      <button
        type="button"
        className={`mt-2 ${buttonNeutralClass}`}
        disabled={messages.length >= maxMessages}
        onClick={() => {
          if (messages.length >= maxMessages) {
            return;
          }
          commit([...messages, { name: "", body: "", side: "left" }]);
        }}
      >
        メッセージを追加
      </button>
    </div>
  );
}
