import { useEffect, useState } from "react";
import { normalizeHexInput } from "../lib/themeColor";
import { textFieldClass } from "../ui";

interface ColorFieldProps {
  /** Rendered above the swatch. Omit when the caller already renders a label. */
  label?: string;
  /** Accessible name for the swatch and code input. Falls back to `label`. */
  ariaLabel?: string;
  /** Canonical `#RRGGBB` value from the definition. */
  value: string;
  /** Called with a canonical `#RRGGBB` value once the input is complete. */
  onChange: (value: string) => void;
}

/**
 * Swatch plus hex text input. The text draft is kept local so a half-typed
 * value never reaches the definition (and therefore never fails the preview
 * request); only a complete color is committed.
 */
export function ColorField({ label, ariaLabel, value, onChange }: ColorFieldProps) {
  const [draft, setDraft] = useState(value);

  // Follow definition changes from elsewhere (theme switch, revert, publish)
  // without clobbering what the user is currently typing.
  useEffect(() => {
    setDraft((current) => (normalizeHexInput(current) === value ? current : value));
  }, [value]);

  const commitText = (next: string) => {
    setDraft(next);
    const normalized = normalizeHexInput(next);
    if (normalized !== null) {
      onChange(normalized);
    }
  };

  const commitSwatch = (next: string) => {
    const normalized = normalizeHexInput(next);
    if (normalized === null) {
      return;
    }
    setDraft(normalized);
    onChange(normalized);
  };

  const invalid = normalizeHexInput(draft) === null;
  const accessibleName = ariaLabel ?? label ?? "カラーコード";

  return (
    <div className="min-w-0">
      {label !== undefined && (
        <span className="mb-1 block text-xs font-semibold">{label}</span>
      )}
      <div className="flex min-w-0 items-center gap-2">
        <input
          type="color"
          className="h-8 w-12 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-50"
          value={normalizeHexInput(value) ?? "#000000"}
          aria-label={`${accessibleName} のカラーピッカー`}
          onChange={(event) => commitSwatch(event.target.value)}
        />
        <input
          type="text"
          className={`w-full min-w-0 flex-1 font-mono text-xs ${textFieldClass} ${
            invalid ? "border-red-400" : ""
          }`}
          value={draft}
          spellCheck={false}
          aria-invalid={invalid}
          aria-label={`${accessibleName} のカラーコード`}
          onChange={(event) => commitText(event.target.value)}
        />
      </div>
    </div>
  );
}
