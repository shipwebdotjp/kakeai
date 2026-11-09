import { liveCardSchema, type LiveCard } from "@kakeai/contracts";
import { parseHTML } from "linkedom";

export interface TestEnvironment {
  document: Document;
  window: Window;
  host: HTMLElement;
}

export function createEnvironment(): TestEnvironment {
  const parsed = parseHTML(
    "<!doctype html><html><head></head><body></body></html>",
  );
  const document = parsed.document as unknown as Document;
  const window = parsed.window as unknown as Window;
  const host = document.createElement("div") as unknown as HTMLElement;
  document.body.appendChild(host);
  return { document, window, host };
}

export function parseCard(input: unknown): LiveCard {
  return liveCardSchema.parse(input);
}

export function cardVisual(cardId: string, stateId: string) {
  return { kind: "card" as const, cardId, stateId };
}

export function mustQuery<T extends Element = HTMLElement>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector(selector);
  if (element === null) {
    throw new Error(`要素が見つかりません: ${selector}`);
  }
  return element as T;
}

export function queryAll(root: ParentNode, selector: string): Element[] {
  return [...root.querySelectorAll(selector)];
}

/** Lets a rejected or resolved asset promise settle. */
export function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
