import type { LiveFormatDocumentV1 } from "@kakeai/contracts";

/**
 * External refetches may only replace the draft while it has no local edits.
 * `document === baseline` means every local change was saved (or never made),
 * so adopting the incoming document cannot discard user input.
 */
export function canAdoptExternalFormatDocument(
  document: LiveFormatDocumentV1,
  baseline: LiveFormatDocumentV1,
): boolean {
  return document === baseline;
}
