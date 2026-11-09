/**
 * Small DOM helpers shared by card views. They avoid `innerHTML` for content
 * and only toggle attributes, so Shadow DOM isolation and keyed updates stay
 * predictable.
 */

export function createElement<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className !== undefined) {
    element.className = className;
  }
  return element;
}

export function setText(element: Element, text: string | undefined): boolean {
  const next = text ?? "";
  const previous = element.textContent ?? "";
  const wasHidden = element.hasAttribute("hidden");
  const shouldHide = text === undefined || text.length === 0;
  let changed = false;
  if (previous !== next) {
    element.textContent = next;
    changed = true;
  }
  if (wasHidden !== shouldHide) {
    if (shouldHide) {
      element.setAttribute("hidden", "");
    } else {
      element.removeAttribute("hidden");
    }
    changed = true;
  }
  return changed;
}

export function setHidden(element: Element, hidden: boolean): boolean {
  return toggleAttribute(element, "hidden", hidden);
}

export function setAttribute(
  element: Element,
  name: string,
  value: string | null,
): boolean {
  const previous = element.getAttribute(name);
  if (previous === value) {
    return false;
  }
  if (value === null) {
    element.removeAttribute(name);
  } else {
    element.setAttribute(name, value);
  }
  return true;
}

export function toggleAttribute(
  element: Element,
  name: string,
  enabled: boolean,
): boolean {
  return setAttribute(element, name, enabled ? "" : null);
}

export function removeElement(element: Element): void {
  if (element.parentNode !== null) {
    element.parentNode.removeChild(element);
  }
}
