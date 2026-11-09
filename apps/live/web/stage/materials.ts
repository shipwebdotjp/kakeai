import type { LivePackageShow, MaterialCard } from "@kakeai/contracts";
import { packageUrl } from "./elements";

/**
 * Renders the single material card in the centre slot. The card is a trusted
 * Kakeai export: a PNG, a short muted MP4, or static HTML in a scriptless
 * sandbox. A load failure hides the slot instead of breaking the stage.
 */
export class StageMaterials {
  private readonly cards = new Map<string, MaterialCard>();
  private currentKey: string | null = null;
  private currentContent: HTMLElement | null = null;

  constructor(private readonly slot: HTMLElement) {}

  setShow(show: LivePackageShow | null): void {
    this.cards.clear();
    if (show === null) {
      return;
    }
    for (const card of show.materials) {
      this.cards.set(card.id, card);
    }
  }

  render(materialId: string, focus: boolean): void {
    const card = this.cards.get(materialId);
    if (card === undefined) {
      this.clear();
      return;
    }
    const key = `${card.id}:${card.file}`;
    if (key !== this.currentKey) {
      this.releaseContent();
      const content = this.buildContent(card);
      if (content === null) {
        this.clear();
        return;
      }
      this.currentContent = content;
      this.currentKey = key;
      this.slot.replaceChildren(content);
    }
    this.slot.hidden = false;
    this.slot.classList.toggle("focus", focus);
  }

  hide(): void {
    this.clear();
  }

  private buildContent(card: MaterialCard): HTMLElement | null {
    switch (card.kind) {
      case "image": {
        const image = document.createElement("img");
        image.src = packageUrl(card.file);
        image.alt = "";
        image.addEventListener("error", () => {
          if (this.currentContent === image) {
            this.clear();
          }
        });
        return image;
      }
      case "video": {
        const video = document.createElement("video");
        video.src = packageUrl(card.file);
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.autoplay = true;
        video.addEventListener("error", () => {
          if (this.currentContent === video) {
            this.clear();
          }
        });
        void video.play().catch(() => undefined);
        return video;
      }
      case "html": {
        const frame = document.createElement("iframe");
        // ADR-0126: static package HTML must not run scripts. Same-origin keeps
        // relative package assets working; `allow-scripts` is deliberately absent.
        frame.setAttribute("sandbox", "allow-same-origin");
        frame.setAttribute("title", "素材カード");
        frame.src = packageUrl(card.file);
        return frame;
      }
      default:
        return null;
    }
  }

  private releaseContent(): void {
    const content = this.currentContent;
    if (content instanceof HTMLVideoElement) {
      content.pause();
      content.removeAttribute("src");
      content.load();
    } else if (content instanceof HTMLIFrameElement) {
      content.removeAttribute("src");
    }
    this.currentContent = null;
  }

  private clear(): void {
    this.releaseContent();
    this.slot.replaceChildren();
    this.slot.hidden = true;
    this.slot.classList.remove("focus");
    this.currentKey = null;
  }
}
