import type {
  LiveCharacterSheet,
  LiveSide,
  StageCharacterState,
} from "@kakeai/contracts";
import {
  selectCharacterFace,
  type CharacterFaceSelection,
} from "../../src/runtime/character-select.ts";
import { blinkTiming, mouthTiming } from "../../src/runtime/character-timing.ts";
import { resolveStandingPlacement } from "../../src/runtime/standing-placement.ts";
import { packageUrl } from "./elements";

interface CharacterElements {
  base: HTMLImageElement;
  brow: HTMLImageElement;
  eye: HTMLImageElement;
  mouth: HTMLImageElement;
  placeholder: HTMLDivElement;
  placeholderName: HTMLSpanElement;
  placeholderExpression: HTMLSpanElement;
  art: HTMLDivElement;
}

function createImage(className: string): HTMLImageElement {
  const image = document.createElement("img");
  image.className = className;
  image.alt = "";
  image.decoding = "async";
  return image;
}

function createCharacterElements(section: HTMLElement): CharacterElements {
  const frame = document.createElement("div");
  frame.className = "character-frame";
  const bounce = document.createElement("div");
  bounce.className = "character-bounce";
  const art = document.createElement("div");
  art.className = "character-art";
  const base = createImage("character-base");
  const brow = createImage("character-layer character-brow");
  const eye = createImage("character-layer character-eye");
  const mouth = createImage("character-layer character-mouth");
  brow.hidden = true;
  eye.hidden = true;
  mouth.hidden = true;
  for (const layer of [brow, eye, mouth]) {
    layer.addEventListener("load", () => {
      layer.hidden = false;
    });
    layer.addEventListener("error", () => {
      layer.hidden = true;
    });
  }
  art.append(base, brow, eye, mouth);

  const placeholder = document.createElement("div");
  placeholder.className = "character-placeholder";
  placeholder.hidden = true;
  const placeholderName = document.createElement("span");
  placeholderName.className = "character-placeholder-name";
  const placeholderExpression = document.createElement("span");
  placeholderExpression.className = "character-placeholder-expression";
  placeholder.append(placeholderName, placeholderExpression);

  bounce.append(art, placeholder);
  frame.append(bounce);
  section.replaceChildren(frame);
  return { base, brow, eye, mouth, placeholder, placeholderName, placeholderExpression, art };
}

class CharacterView {
  private sheet: LiveCharacterSheet | null = null;
  private speakerName: string;
  private selectionKey: string | null = null;
  private eyeFile: string | null = null;
  private mouthFile: string | null = null;
  private mouthSpeakingFile: string | null = null;
  private mouthOpen = false;
  private blinkTimer: number | null = null;
  private blinkResetTimer: number | null = null;
  private mouthTimer: number | null = null;
  private readonly elements: CharacterElements;
  private seed: string;

  constructor(
    readonly side: LiveSide,
    readonly section: HTMLElement,
    speakerName: string,
  ) {
    this.speakerName = speakerName;
    this.seed = side;
    this.elements = createCharacterElements(section);
    this.elements.base.addEventListener("error", () => this.showPlaceholder());
    this.elements.base.addEventListener("load", () => {
      this.elements.art.hidden = false;
      this.elements.placeholder.hidden = true;
    });
    this.renderPlaceholder(null);
  }

  setSheet(sheet: LiveCharacterSheet | null): void {
    this.sheet = sheet;
    const character = sheet?.characters.find((entry) => entry.side === this.side);
    if (character !== undefined) {
      this.speakerName = character.name;
      this.seed = character.id;
    }
    this.selectionKey = null;
    this.renderPlaceholder(null);
  }

  setSpeakerName(name: string): void {
    this.speakerName = name;
  }

  render(state: StageCharacterState | null): void {
    if (state === null) {
      this.section.hidden = true;
      this.stopBlink();
      this.stopMouth();
      return;
    }
    this.section.hidden = false;
    const selection =
      this.sheet === null ? null : selectCharacterFace(this.sheet, this.side, state.expression);
    if (selection === null) {
      this.showPlaceholder(state.expression);
    } else {
      this.applySelection(selection, state.expression);
    }
    this.setSpeaking(state.speaking);
  }

  private applySelection(selection: CharacterFaceSelection, expression: string): void {
    const placement = resolveStandingPlacement(selection.appearance.standing);
    this.section.style.setProperty("--character-scale", String(placement.scale));
    this.section.style.setProperty("--character-inset", `${placement.insetPercent}%`);
    this.section.style.setProperty("--character-shift", `${placement.shiftPercent}%`);

    const key = `${selection.appearance.id}:${expression}`;
    if (key !== this.selectionKey) {
      this.selectionKey = key;
      this.elements.base.src = packageUrl(selection.appearance.image);
      this.applyLayer(this.elements.brow, selection.layers.brow?.file ?? null);
      this.applyLayer(this.elements.eye, selection.layers.eye?.file ?? null);
      this.applyLayer(this.elements.mouth, selection.layers.mouth?.file ?? null);
      this.eyeFile = selection.layers.eye?.file ?? null;
      this.mouthFile = selection.layers.mouth?.file ?? null;
      this.mouthSpeakingFile = selection.layers.mouth?.speakingFile ?? null;
      this.startBlink(selection.layers.eye?.blinkFile);
      this.restartMouth();
    }
    this.renderPlaceholder(expression);
  }

  private applyLayer(image: HTMLImageElement, file: string | null): void {
    if (file === null) {
      image.hidden = true;
      image.removeAttribute("src");
      return;
    }
    image.src = packageUrl(file);
  }

  private renderPlaceholder(expression: string | null): void {
    this.elements.placeholderName.textContent = this.speakerName;
    this.elements.placeholderExpression.textContent = expression ?? "";
  }

  private showPlaceholder(expression: string | null = null): void {
    this.elements.art.hidden = true;
    this.elements.placeholder.hidden = false;
    this.renderPlaceholder(expression);
    this.stopBlink();
    this.stopMouth();
  }

  private setSpeaking(speaking: boolean): void {
    this.section.classList.toggle("speaking", speaking);
    if (speaking) {
      this.restartMouth();
    } else {
      this.stopMouth();
    }
  }

  private startBlink(blinkFile: string | undefined): void {
    this.stopBlink();
    if (blinkFile === undefined || this.eyeFile === null) {
      return;
    }
    const timing = blinkTiming(this.seed);
    const schedule = () => {
      this.blinkTimer = window.setTimeout(() => {
        this.elements.eye.src = packageUrl(blinkFile);
        this.blinkResetTimer = window.setTimeout(() => {
          this.elements.eye.src = packageUrl(this.eyeFile ?? "");
          schedule();
        }, timing.durationMs);
      }, timing.intervalMs);
    };
    schedule();
  }

  private stopBlink(): void {
    if (this.blinkTimer !== null) {
      window.clearTimeout(this.blinkTimer);
      this.blinkTimer = null;
    }
    if (this.blinkResetTimer !== null) {
      window.clearTimeout(this.blinkResetTimer);
      this.blinkResetTimer = null;
    }
    if (this.eyeFile !== null && this.elements.eye.src !== "") {
      this.elements.eye.src = packageUrl(this.eyeFile);
    }
  }

  private restartMouth(): void {
    this.stopMouth();
    if (!this.section.classList.contains("speaking") || this.mouthSpeakingFile === null) {
      return;
    }
    const timing = mouthTiming(this.seed);
    this.mouthOpen = false;
    this.mouthTimer = window.setInterval(() => {
      this.mouthOpen = !this.mouthOpen;
      const file = this.mouthOpen ? this.mouthSpeakingFile : this.mouthFile;
      if (file !== null) {
        this.elements.mouth.src = packageUrl(file);
      }
    }, timing.intervalMs);
  }

  private stopMouth(): void {
    if (this.mouthTimer !== null) {
      window.clearInterval(this.mouthTimer);
      this.mouthTimer = null;
    }
    this.mouthOpen = false;
    if (this.mouthFile !== null) {
      this.elements.mouth.src = packageUrl(this.mouthFile);
    }
  }
}

export interface StageCharactersOptions {
  left: HTMLElement;
  right: HTMLElement;
  names: Map<LiveSide, string>;
}

/**
 * Draws the left/right characters from `characters.json`: appearance image,
 * expression face layers, blink, mouth-flap and the speaker bounce. Missing
 * art falls back to a named placeholder instead of breaking the stage.
 */
export class StageCharacters {
  private readonly views: Record<LiveSide, CharacterView>;

  constructor(options: StageCharactersOptions) {
    this.views = {
      left: new CharacterView(
        "left",
        options.left,
        options.names.get("left") ?? "左",
      ),
      right: new CharacterView(
        "right",
        options.right,
        options.names.get("right") ?? "右",
      ),
    };
  }

  setSheet(sheet: LiveCharacterSheet | null): void {
    this.views.left.setSheet(sheet);
    this.views.right.setSheet(sheet);
  }

  setNames(names: Map<LiveSide, string>): void {
    const left = names.get("left");
    const right = names.get("right");
    if (left !== undefined) {
      this.views.left.setSpeakerName(left);
    }
    if (right !== undefined) {
      this.views.right.setSpeakerName(right);
    }
  }

  render(characters: { left: StageCharacterState | null; right: StageCharacterState | null }): void {
    this.views.left.render(characters.left);
    this.views.right.render(characters.right);
  }
}
