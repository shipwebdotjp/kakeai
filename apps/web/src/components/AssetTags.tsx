import { useState } from "react";
import { MAX_ASSET_TAGS, MAX_ASSET_TAG_LENGTH } from "@kakeai/contracts";
import { metaTextClass, textFieldClass } from "../ui";

export function TagFilter({
  allTags,
  selected,
  onToggle,
  onClear,
}: {
  allTags: readonly string[];
  selected: readonly string[];
  onToggle: (tag: string) => void;
  onClear: () => void;
}) {
  if (allTags.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={metaTextClass}>タグ:</span>
      {allTags.map((tag) => {
        const active = selected.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            className={`rounded-full border px-2 py-0.5 text-xs ${
              active
                ? "border-brand-500 bg-brand-500 text-white"
                : "border-border bg-surface hover:bg-surface-muted"
            }`}
            onClick={() => onToggle(tag)}
          >
            {tag}
          </button>
        );
      })}
      {selected.length > 0 && (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={onClear}
        >
          解除
        </button>
      )}
    </div>
  );
}

export function AssetTagEditor({
  tags,
  disabled,
  onAdd,
  onRemove,
}: {
  tags: readonly string[];
  disabled: boolean;
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const value = draft.trim();
    if (value.length === 0) {
      setDraft("");
      return;
    }
    if (value.length > MAX_ASSET_TAG_LENGTH || tags.length >= MAX_ASSET_TAGS || tags.includes(value)) {
      return;
    }
    setDraft("");
    onAdd(value);
  };

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-muted px-2 py-0.5 text-xs"
        >
          {tag}
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            disabled={disabled}
            aria-label={`タグ ${tag} を外す`}
            onClick={() => onRemove(tag)}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        disabled={disabled}
        placeholder="タグを追加"
        aria-label="タグを追加"
        className={`w-28 ${textFieldClass}`}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        onBlur={() => {
          if (!disabled) {
            commit();
          }
        }}
      />
    </div>
  );
}
