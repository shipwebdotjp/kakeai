export interface EditorScrollAnchor {
  scrollTop: number;
  targetId: string;
  targetOffset: number;
}

export function escapeEditorId(id: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(id)
    : id.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

export function findEditorTarget(root: HTMLElement, targetId: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`#${escapeEditorId(targetId)}`);
}

export function editorStickyOffset(root: HTMLElement): number {
  const actionBar = root.querySelector<HTMLElement>("#editor-actionbar");
  return (actionBar?.offsetHeight ?? 0) + 8;
}

function offsetWithin(root: HTMLElement, element: HTMLElement): number {
  return element.getBoundingClientRect().top - root.getBoundingClientRect().top;
}

export function captureEditorScrollAnchor(
  root: HTMLElement,
  targetId: string,
): EditorScrollAnchor | null {
  const element = findEditorTarget(root, targetId);
  if (element === null) {
    return null;
  }
  return {
    scrollTop: root.scrollTop,
    targetId,
    targetOffset: offsetWithin(root, element),
  };
}

export function scrollTopForAnchor(
  nextTargetTop: number,
  beforeTargetOffset: number,
): number {
  return Math.max(0, nextTargetTop - beforeTargetOffset);
}

export function restoreEditorScrollAnchor(
  root: HTMLElement,
  anchor: EditorScrollAnchor,
): void {
  const element = findEditorTarget(root, anchor.targetId);
  if (element === null) {
    root.scrollTop = anchor.scrollTop;
    return;
  }
  const nextTargetTop = offsetWithin(root, element) + root.scrollTop;
  root.scrollTop = scrollTopForAnchor(nextTargetTop, anchor.targetOffset);
}

export function scrollEditorTargetIntoView(
  root: HTMLElement,
  targetId: string,
  behavior: ScrollBehavior = "auto",
): boolean {
  const element = findEditorTarget(root, targetId);
  if (element === null) {
    return false;
  }
  const top = offsetWithin(root, element) + root.scrollTop;
  root.scrollTo({ top: Math.max(0, top - editorStickyOffset(root)), behavior });
  return true;
}
