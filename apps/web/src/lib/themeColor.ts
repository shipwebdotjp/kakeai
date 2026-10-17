/**
 * Theme definitions store colors as an uppercase `#RRGGBB` string
 * (`accentColorSchema` in `@kakeai/contracts`). The UI keeps incomplete input
 * local to the field so a half-typed value never reaches the definition.
 */

const THEME_HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/;

/**
 * Normalizes color input to the canonical uppercase `#RRGGBB` form, or `null`
 * when the input is not a complete color yet. The leading `#` is optional.
 */
export function normalizeHexInput(value: string): string | null {
  const trimmed = value.trim();
  const upper = (trimmed.startsWith("#") ? trimmed : `#${trimmed}`).toUpperCase();
  return THEME_HEX_COLOR_PATTERN.test(upper) ? upper : null;
}
