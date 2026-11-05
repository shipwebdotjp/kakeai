import { TEXT_PRESET_WIDTH_PX, type TextPresetWidth } from "@kakeai/contracts";

/** Upper bound that never exceeds the canvas content width. */
export function textPresetWidthMaxWidthCss(width: TextPresetWidth): string {
  return `min(${TEXT_PRESET_WIDTH_PX[width]}px,var(--kakeai-content-width,1600px))`;
}

/** Occupied-width style for an explicit preset; omitted means no width style. */
export function textPresetWidthLayoutStyle(width: TextPresetWidth | undefined): string {
  if (width === undefined) {
    return "";
  }
  return `width:100%;max-width:${textPresetWidthMaxWidthCss(width)}`;
}
