import { useEffect, useState } from "react";
import { parseDurationSeconds, formatSeconds } from "../duration";
import { textFieldClass } from "../../ui";

interface DurationFieldProps {
  label: string;
  valueMs: number;
  onCommit: (valueMs: number) => void;
  disabled?: boolean;
}

/** Free-typed seconds field; only a valid positive value is committed on blur. */
export function DurationField({ label, valueMs, onCommit, disabled }: DurationFieldProps) {
  const [text, setText] = useState(() => formatSeconds(valueMs));

  useEffect(() => {
    setText(formatSeconds(valueMs));
  }, [valueMs]);

  const commit = () => {
    const parsed = parseDurationSeconds(text);
    if (parsed === null) {
      setText(formatSeconds(valueMs));
      return;
    }
    onCommit(parsed);
  };

  return (
    <label className="block text-sm">
      {label}
      <span className="mt-1 flex items-center gap-1">
        <input
          className={`w-24 ${textFieldClass}`}
          inputMode="numeric"
          value={text}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
        <span className="text-xs text-muted-foreground">秒</span>
      </span>
    </label>
  );
}

interface OptionalNumberFieldProps {
  label: string;
  value: number | undefined;
  onCommit: (value: number | undefined) => void;
  min?: number;
  placeholder?: string;
}
export function OptionalNumberField({
  label,
  value,
  onCommit,
  min = 0,
  placeholder = "継承",
}: OptionalNumberFieldProps) {
  const [text, setText] = useState(value === undefined ? "" : String(value));

  useEffect(() => {
    setText(value === undefined ? "" : String(value));
  }, [value]);

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === "") {
      onCommit(undefined);
      return;
    }
    if (!/^\d+$/.test(trimmed)) {
      setText(value === undefined ? "" : String(value));
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed) || parsed < min) {
      setText(value === undefined ? "" : String(value));
      return;
    }
    onCommit(parsed);
  };

  return (
    <label className="block text-sm">
      {label}
      <input
        className={`mt-1 w-28 ${textFieldClass}`}
        inputMode="numeric"
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

interface NonNegativeSecondsFieldProps {
  label: string;
  valueMs: number;
  onCommit: (valueMs: number) => void;
}

/** Same as DurationField but allows 0 (buffer, reserve, thinking time). */
export function NonNegativeSecondsField({
  label,
  valueMs,
  onCommit,
}: NonNegativeSecondsFieldProps) {
  const [text, setText] = useState(() => formatSeconds(valueMs));

  useEffect(() => {
    setText(formatSeconds(valueMs));
  }, [valueMs]);

  const commit = () => {
    const trimmed = text.trim();
    if (!/^\d+$/.test(trimmed)) {
      setText(formatSeconds(valueMs));
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      setText(formatSeconds(valueMs));
      return;
    }
    onCommit(parsed * 1000);
  };

  return (
    <label className="block text-sm">
      {label}
      <span className="mt-1 flex items-center gap-1">
        <input
          className={`w-24 ${textFieldClass}`}
          inputMode="numeric"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
        <span className="text-xs text-muted-foreground">秒</span>
      </span>
    </label>
  );
}

interface RequiredNumberFieldProps {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  min?: number;
}

/** Required positive integer; invalid temporary input is reverted on blur. */
export function RequiredNumberField({
  label,
  value,
  onCommit,
  min = 1,
}: RequiredNumberFieldProps) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    if (!/^\d+$/.test(text.trim())) {
      setText(String(value));
      return;
    }
    const parsed = Number(text.trim());
    if (!Number.isSafeInteger(parsed) || parsed < min) {
      setText(String(value));
      return;
    }
    onCommit(parsed);
  };

  return (
    <label className="block text-sm">
      {label}
      <input
        className={`mt-1 w-28 ${textFieldClass}`}
        inputMode="numeric"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

interface OptionalDurationFieldProps {
  label: string;
  valueMs: number | undefined;
  onCommit: (valueMs: number | undefined) => void;
}

/** Optional duration: blank means "not set" (used by format CutIn placeholders). */
export function OptionalDurationField({
  label,
  valueMs,
  onCommit,
}: OptionalDurationFieldProps) {
  const [text, setText] = useState(
    valueMs === undefined ? "" : formatSeconds(valueMs),
  );

  useEffect(() => {
    setText(valueMs === undefined ? "" : formatSeconds(valueMs));
  }, [valueMs]);

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === "") {
      onCommit(undefined);
      return;
    }
    const parsed = parseDurationSeconds(trimmed);
    if (parsed === null) {
      setText(valueMs === undefined ? "" : formatSeconds(valueMs));
      return;
    }
    onCommit(parsed);
  };

  return (
    <label className="block text-sm">
      {label}
      <span className="mt-1 flex items-center gap-1">
        <input
          className={`w-24 ${textFieldClass}`}
          inputMode="numeric"
          value={text}
          placeholder="未設定"
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
        <span className="text-xs text-muted-foreground">秒</span>
      </span>
    </label>
  );
}
