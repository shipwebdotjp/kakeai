import type { LiveImageCard, LiveImageState } from "@kakeai/contracts";
import { LiveCardAssetError, resolveAssetUrl } from "../asset";
import { createElement, setAttribute, setHidden, setText } from "../dom";
import { createCardShell } from "./shell";
import type { CardUpdate, CardView, CardViewDependencies } from "./types";

export function createImageView(
  card: LiveImageCard,
  document: Document,
  dependencies: CardViewDependencies,
): CardView {
  const element = createCardShell(document, "image", card.id);
  const figure = createElement(document, "figure", "kc-image");
  const frame = createElement(document, "div", "kc-image-frame");
  const image = createElement(document, "img", "kc-image-img");
  image.setAttribute("alt", "");
  image.setAttribute("decoding", "async");
  image.setAttribute("loading", "eager");
  frame.append(image);

  const meta = createElement(document, "figcaption", "kc-image-meta");
  const caption = createElement(document, "span", "kc-image-caption");
  const credit = createElement(document, "span", "kc-image-credit");
  meta.append(caption, credit);
  figure.append(frame, meta);
  element.append(figure);

  let disposed = false;
  let requestVersion = 0;
  let assetId: string | undefined;
  let altValue = "";

  const fail = (error: unknown): void => {
    if (!disposed) {
      dependencies.onFailure(error);
    }
  };

  image.addEventListener("error", () => {
    if (disposed) {
      return;
    }
    fail(
      new LiveCardAssetError(
        assetId ?? "",
        `画像を読み込めませんでした: ${assetId ?? "(unknown)"} @ ${image.getAttribute("src") ?? ""}`,
      ),
    );
  });

  const loadAsset = (nextAssetId: string): void => {
    const version = ++requestVersion;
    assetId = nextAssetId;
    image.setAttribute("data-asset-id", nextAssetId);
    image.removeAttribute("src");
    const resolution = resolveAssetUrl(dependencies.resolveAsset, nextAssetId);
    if (typeof resolution === "string") {
      if (!disposed && version === requestVersion) {
        image.setAttribute("src", resolution);
      }
      return;
    }
    void resolution.then(
      (url) => {
        if (disposed || version !== requestVersion) {
          return;
        }
        image.setAttribute("src", url);
      },
      (error: unknown) => {
        if (disposed || version !== requestVersion) {
          return;
        }
        fail(error);
      },
    );
  };

  return {
    element,
    update(state): CardUpdate {
      const typed = state as LiveImageState;
      const updateTargets: Element[] = [];
      if (setAttribute(element, "data-fit", typed.fit)) {
        updateTargets.push(frame);
      }
      const nextAlt = typed.alt ?? "";
      if (altValue !== nextAlt) {
        altValue = nextAlt;
        image.setAttribute("alt", nextAlt);
      }
      if (setText(caption, typed.caption)) updateTargets.push(caption);
      if (setText(credit, typed.credit)) updateTargets.push(credit);
      setHidden(meta, !typed.caption && !typed.credit);
      if (assetId !== typed.assetId) {
        loadAsset(typed.assetId);
      }
      return { updateTargets, chartTargets: [], exitTargets: [] };
    },
    dispose(): void {
      disposed = true;
      requestVersion += 1;
    },
  };
}
