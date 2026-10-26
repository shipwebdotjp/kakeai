import { describe, expect, it } from "vitest";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import { ONSET_PRESETS, createInsertScene, getVisualTheme, type SnapshotFaceSet, type VisualCue } from "@kakeai/contracts";
import type { AssetResolver, FaceSetResolver } from "../resolver";
import type { CompositionVersionResolver } from "../composition-resolver";
import { CompositionCompileError } from "../compile-error";
import { compileDocument } from "../compiler";
import { cueScope } from "../scope";
import { mixHex } from "../theme";
import { resolver, videoResolver, videoResolverWithDuration, compositionResolver, compositionResolverWithDuration, transition, cue, clipId } from "./test-helpers";

describe("visual theme", () => {
  it("emits theme variables on the composition root", () => {
    const compiled = compileDocument({ document: validContentDocument(), assetResolver: resolver });
    expect(compiled.html).toContain("--kakeai-canvas:#FAF6EE");
    expect(compiled.html).toContain("--kakeai-text:#232B3D");
    expect(compiled.html).toContain("--kakeai-accent-primary:#19736D");
    expect(compiled.html).toContain("--kakeai-accent-secondary:#A84D3E");
    expect(compiled.html).toContain("--kakeai-accent-tertiary:#80600F");
    expect(compiled.html).toContain("--kakeai-scrim:rgba(27,39,64,0.55)");
    expect(compiled.html).toContain("--kakeai-radius-lg:20px");
  });

  it("emits the caption safe area derived from the caption style", () => {
    const compiled = compileDocument({ document: validContentDocument(), assetResolver: resolver });
    expect(compiled.html).toContain("--kakeai-caption-offset:72px");
    expect(compiled.html).toContain("--kakeai-caption-safe:216px");
    expect(compiled.html).toContain("padding-bottom:var(--kakeai-caption-safe");
  });

  it("resolves a theme accent token into a soft scene background", () => {
    const document = validContentDocument();
    document.scenes[1]!.accent = { kind: "theme", token: "secondary" };
    const compiled = compileDocument({ document, assetResolver: resolver });
    const expected = `linear-gradient(135deg, ${mixHex("#A84D3E", "#FAF6EE", 0.72)} 0%, ${mixHex("#A84D3E", "#FAF6EE", 0.88)} 100%)`;
    expect(compiled.html).toContain(`background:${expected}`);
    expect(compiled.html).toContain("--kakeai-accent:#A84D3E");
    expect(compiled.html).toContain("--kakeai-accent-soft:");
    expect(compiled.html).toContain("--kakeai-accent-fg:");
  });

  it("mixes a custom accent with the theme canvas", () => {
    const document = validContentDocument();
    document.scenes[1]!.accent = { kind: "custom", color: "#123456" };
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain("--kakeai-accent:#123456");
    expect(compiled.html).toContain(`--kakeai-accent-soft:${mixHex("#123456", "#FAF6EE", 0.8)}`);
  });

  it("applies theme role defaults to text cues", () => {
    const compiled = compileDocument({ document: validContentDocument(), assetResolver: resolver });
    expect(compiled.html).toContain("color:#175C57");
    expect(compiled.html).toContain("font-size:72px");
    expect(compiled.html).toContain("color:#232B3D");
    expect(compiled.html).toContain("font-size:42px");
    expect(compiled.html).toContain("line-height:1.8");
  });

  it("lets explicit cue styles override theme role defaults", () => {
    const document = validContentDocument();
    document.scenes[1]!.visualCues = [
      cue({
        id: "vc-override",
        template: { id: "text.block", version: 1 },
        layer: "overlay",
        input: {
          text: "上書き",
          role: "body",
          font: "serif",
          fontSize: 100,
          color: "#FF0000",
          decoration: { bold: true },
        },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain("color:#FF0000");
    expect(compiled.html).toContain("font-size:100px");
    expect(compiled.html).toContain("Yu Mincho");
    expect(compiled.html).toContain("font-weight:700");
  });

  it("keeps theme defaults for unspecified decoration flags", () => {
    const document = validContentDocument();
    document.scenes[1]!.visualCues = [
      cue({
        id: "vc-partial",
        template: { id: "text.block", version: 1 },
        layer: "overlay",
        input: { text: "部分", role: "body", decoration: { italic: true } },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain("color:#232B3D");
    expect(compiled.html).toContain("font-style:italic");
    expect(compiled.html).toContain("font-weight:400");
  });

  it("styles burned-in captions from the caption token and scrim", () => {
    const compiled = compileDocument({ document: validContentDocument(), assetResolver: resolver });
    expect(compiled.html).toContain("color:#FFFFFF");
    expect(compiled.html).toContain("background:rgba(27,39,64,0.55)");
  });

  it("falls back to the theme surface for a device-frame without a background color", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-device-theme",
        template: { id: "scene.device-frame", version: 1 },
        layer: "background",
        input: {
          frame: "laptop",
          screen: { kind: "media", assetId: "asset-screen", fit: "cover" },
        },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain("background:#F1EAD9");
  });

  it("keeps the site-specific accent on site mockups", () => {
    const compiled = compileDocument({ document: validContentDocument(), assetResolver: resolver });
    expect(compiled.html).toContain("--kakeai-mockup-accent:#1d9bf0;");
    expect(compiled.html).toContain(
      "background:var(--kakeai-mockup-surface,var(--kakeai-surface))",
    );
  });

  it("rejects an unknown visual theme", () => {
    const document = validContentDocument();
    document.visualTheme = { id: "unknown-theme", version: 1 };
    try {
      compileDocument({ document, assetResolver: resolver });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CompositionCompileError);
      expect((error as CompositionCompileError).issues[0]?.code).toBe("unknown_theme");
    }
  });

  describe("character.standing@3", () => {
    const faceSet: SnapshotFaceSet = {
      id: "faceset-rin",
      name: "リン正面",
      layers: [
        { id: "brow-normal", part: "brow", assetId: "asset-brow", blinkLayerId: null, speakingLayerId: null },
        { id: "eye-normal", part: "eye", assetId: "asset-eye", blinkLayerId: null, speakingLayerId: null },
        { id: "mouth-normal", part: "mouth", assetId: "asset-mouth", blinkLayerId: null, speakingLayerId: null },
        { id: "eye-happy", part: "eye", assetId: "asset-eye-happy", blinkLayerId: null, speakingLayerId: null },
        { id: "fg", part: "foreground", assetId: "asset-fg", blinkLayerId: null, speakingLayerId: null },
      ],
      expressions: [
        { id: "normal", name: "通常", browLayerId: "brow-normal", eyeLayerId: "eye-normal", mouthLayerId: "mouth-normal" },
        { id: "happy", name: "笑い", browLayerId: "brow-normal", eyeLayerId: "eye-happy", mouthLayerId: "mouth-normal" },
      ],
    };

    const faceSetResolver: FaceSetResolver = (faceSetId) => {
      if (faceSetId !== faceSet.id) {
        throw new Error(`unknown face set: ${faceSetId}`);
      }
      return faceSet;
    };

    function faceDocument() {
      const document = validContentDocument();
      document.characters.push({
        id: "character-rin",
        name: "リン",
        names: [],
        voices: [],
        appearances: [
          { id: "appearance-rin", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: "faceset-rin" },
        ],
      });
      document.speakers.push(
        { id: "speaker-rin", name: "リン", characterId: "character-rin", voiceProfileId: null },
      );
      const scene = document.scenes[1]!;
      scene.lines = [
        {
          id: "line-happy",
          speakerId: "speaker-rin",
          captionText: "嬉しい",
          speechText: "うれしい",
          selectedAudioTakeId: null,
          expressionId: "happy",
        },
        {
          id: "line-normal",
          speakerId: "speaker-rin",
          captionText: "普通",
          speechText: "ふつう",
          selectedAudioTakeId: null,
          expressionId: null,
        },
      ];
      scene.visualCues = [
        cue({
          id: "vc-face",
          template: { id: "character.standing", version: 1 },
          layer: "standing",
          order: 0,
          input: {
            characterId: "character-rin",
            appearanceId: "appearance-rin",
            side: "left",
            scale: 1,
          },
        }),
      ];
      return document;
    }

    it("composes base, layers and foreground and switches expression per line", () => {
      const compiled = compileDocument({ document: faceDocument(), assetResolver: resolver, faceSetResolver });
      for (const assetId of [
        "asset-rin",
        "asset-brow",
        "asset-eye",
        "asset-eye-happy",
        "asset-mouth",
        "asset-fg",
      ]) {
        expect(compiled.assetIds).toContain(assetId);
        expect(compiled.html).toContain(`src="/preview/${assetId}"`);
      }
      const normalGroup = cueScope("vc-face").id("face-0");
      const happyGroup = cueScope("vc-face").id("face-1");
      expect(compiled.html).toContain(`<div id="${normalGroup}" class="kakeai-facegroup">`);
      expect(compiled.html).toContain(`<div id="${happyGroup}" class="kakeai-facegroup" style="opacity:0;">`);
      expect(compiled.html).toContain(
        `tl.set(document.getElementById("${happyGroup}"),{opacity:1},4.5);`,
      );
      expect(compiled.html).toContain(
        `tl.set(document.getElementById("${normalGroup}"),{opacity:0},4.5);`,
      );
      expect(compiled.html).toContain(
        `tl.set(document.getElementById("${normalGroup}"),{opacity:1},7);`,
      );
      expect(compiled.html).toContain(
        `tl.set(document.getElementById("${happyGroup}"),{opacity:0},7);`,
      );
    });

    it("bounces the wrapper together with the face layers", () => {
      const compiled = compileDocument({ document: faceDocument(), assetResolver: resolver, faceSetResolver });
      const wrapper = cueScope("vc-face").id("wrap");
      expect(compiled.html).toContain(`document.getElementById("${wrapper}")`);
      expect(compiled.html).toContain("y:-20");
    });

    it("renders base only when the appearance has no face set", () => {
      const document = faceDocument();
      document.characters[0]!.appearances[0]!.faceSetId = null;
      const compiled = compileDocument({ document, assetResolver: resolver, faceSetResolver });
      expect(compiled.html).not.toContain('class="kakeai-facegroup"');
      expect(compiled.html).toContain(`src="/preview/asset-rin"`);
      expect(compiled.assetIds).toEqual(
        expect.arrayContaining(["asset-rin", "asset-bg", "asset-bgm"]),
      );
      expect(compiled.assetIds).not.toContain("asset-brow");
    });

    it("fails before output when the face set cannot be resolved", () => {
      const document = faceDocument();
      try {
        compileDocument({ document, assetResolver: resolver });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(CompositionCompileError);
        expect((error as CompositionCompileError).issues[0]?.code).toBe("unknown_face_set");
      }
    });

    it("fails before output when the face set has no normal preset", () => {
      const broken: SnapshotFaceSet = {
        ...faceSet,
        expressions: faceSet.expressions.filter((preset) => preset.id !== "normal"),
      };
      const document = faceDocument();
      try {
        compileDocument({
          document,
          assetResolver: resolver,
          faceSetResolver: () => broken,
        });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(CompositionCompileError);
        expect((error as CompositionCompileError).issues[0]?.code).toBe("missing_normal_expression");
      }
    });

    it("falls back to normal for an unknown expression", () => {
      const document = faceDocument();
      document.scenes[1]!.lines[0]!.expressionId = "angry";
      const compiled = compileDocument({ document, assetResolver: resolver, faceSetResolver });
      const normalGroup = cueScope("vc-face").id("face-0");
      const happyGroup = cueScope("vc-face").id("face-1");
      expect(compiled.html).toContain(
        `tl.set(document.getElementById("${normalGroup}"),{opacity:1},4);`,
      );
      expect(compiled.html).toContain(
        `tl.set(document.getElementById("${happyGroup}"),{opacity:0},4);`,
      );
    });

    it("compiles deterministically", () => {
      const first = compileDocument({ document: faceDocument(), assetResolver: resolver, faceSetResolver });
      const second = compileDocument({ document: faceDocument(), assetResolver: resolver, faceSetResolver });
      expect(second.html).toBe(first.html);
    });

    describe("blink and mouth", () => {
      const variantFaceSet: SnapshotFaceSet = {
        id: "faceset-blink",
        name: "瞬き",
        layers: [
          { id: "brow", part: "brow", assetId: "asset-brow", blinkLayerId: null, speakingLayerId: null },
          { id: "eye", part: "eye", assetId: "asset-eye", blinkLayerId: "eye-closed", speakingLayerId: null },
          { id: "eye-closed", part: "eye", assetId: "asset-eye-closed", blinkLayerId: null, speakingLayerId: null },
          { id: "mouth", part: "mouth", assetId: "asset-mouth", blinkLayerId: null, speakingLayerId: "mouth-open" },
          { id: "mouth-open", part: "mouth", assetId: "asset-mouth-open", blinkLayerId: null, speakingLayerId: null },
        ],
        expressions: [
          { id: "normal", name: "通常", browLayerId: "brow", eyeLayerId: "eye", mouthLayerId: "mouth" },
          { id: "happy", name: "笑い", browLayerId: "brow", eyeLayerId: "eye", mouthLayerId: "mouth" },
        ],
      };

      const variantResolver: FaceSetResolver = (faceSetId) => {
        if (faceSetId !== variantFaceSet.id) {
          throw new Error(`unknown face set: ${faceSetId}`);
        }
        return variantFaceSet;
      };

      function variantDocument() {
        const document = faceDocument();
        document.characters[0]!.appearances[0]!.faceSetId = variantFaceSet.id;
        return document;
      }

      function setEvents(html: string): { elementId: string; visible: boolean; at: number }[] {
        const pattern =
          /tl\.set\(document\.getElementById\("([^"]+)"\),\{opacity:([01])\},([0-9.]+)\);/g;
        const events: { elementId: string; visible: boolean; at: number }[] = [];
        for (const match of html.matchAll(pattern)) {
          events.push({
            elementId: match[1]!,
            visible: match[2] === "1",
            at: Number(match[3]),
          });
        }
        return events;
      }

      it("renders closed-eye and open-mouth variants hidden with tracked assets", () => {
        const compiled = compileDocument({
          document: variantDocument(),
          assetResolver: resolver,
          faceSetResolver: variantResolver,
        });
        const eyeBlink = cueScope("vc-face").id("face-0-eye");
        const mouthSpeaking = cueScope("vc-face").id("face-0-mouth");
        expect(compiled.html).toContain(
          `<img id="${eyeBlink}" class="kakeai-face" src="/preview/asset-eye-closed" style="opacity:0;" alt="">`,
        );
        expect(compiled.html).toContain(
          `<img id="${mouthSpeaking}" class="kakeai-face" src="/preview/asset-mouth-open" style="opacity:0;" alt="">`,
        );
        expect(compiled.assetIds).toContain("asset-eye-closed");
        expect(compiled.assetIds).toContain("asset-mouth-open");
      });

      it("blinks across the whole cue and flaps the mouth only while speaking", () => {
        const compiled = compileDocument({
          document: variantDocument(),
          assetResolver: resolver,
          faceSetResolver: variantResolver,
        });
        const eyeBlinkIds = new Set(
          [0, 1].map((index) => cueScope("vc-face").id(`face-${index}-eye`)),
        );
        const eyeBaseIds = new Set(
          [0, 1].map((index) => cueScope("vc-face").id(`face-${index}-eye-base`)),
        );
        const mouthSpeakingIds = new Set(
          [0, 1].map((index) => cueScope("vc-face").id(`face-${index}-mouth`)),
        );
        const blinks = setEvents(compiled.html).filter((event) =>
          eyeBlinkIds.has(event.elementId),
        );
        const eyeBases = setEvents(compiled.html).filter((event) =>
          eyeBaseIds.has(event.elementId),
        );
        const mouths = setEvents(compiled.html).filter((event) =>
          mouthSpeakingIds.has(event.elementId),
        );
        expect(blinks.length).toBeGreaterThan(0);
        expect(mouths.length).toBeGreaterThan(0);
        for (const event of [...blinks, ...mouths]) {
          expect(event.at).toBeGreaterThanOrEqual(4);
          expect(event.at).toBeLessThanOrEqual(10);
        }
        const blinkOns = blinks.filter((event) => event.visible);
        expect(blinkOns.length).toBeGreaterThan(0);
        for (const on of blinkOns) {
          const off = blinks.find(
            (candidate) =>
              candidate.elementId === on.elementId && !candidate.visible && candidate.at > on.at,
          );
          expect(off).toBeDefined();
          expect(off!.at - on.at).toBeLessThanOrEqual(0.2);
          const baseId = on.elementId.replace(/-eye$/, "-eye-base");
          expect(
            eyeBases.some(
              (candidate) => candidate.elementId === baseId && !candidate.visible && candidate.at === on.at,
            ),
          ).toBe(true);
          expect(
            eyeBases.some(
              (candidate) => candidate.elementId === baseId && candidate.visible && candidate.at === off!.at,
            ),
          ).toBe(true);
        }
        for (const event of mouths.filter((candidate) => candidate.visible)) {
          expect(event.at).toBeGreaterThanOrEqual(4.5);
          expect(event.at).toBeLessThan(9.5);
        }
      });

      it("resets variants when the expression changes", () => {
        const compiled = compileDocument({
          document: variantDocument(),
          assetResolver: resolver,
          faceSetResolver: variantResolver,
        });
        const happyEye = cueScope("vc-face").id("face-1-eye");
        const happyMouth = cueScope("vc-face").id("face-1-mouth");
        expect(compiled.html).toContain(
          `tl.set(document.getElementById("${happyEye}"),{opacity:0},4.5);`,
        );
        expect(compiled.html).toContain(
          `tl.set(document.getElementById("${happyMouth}"),{opacity:0},4.5);`,
        );
      });

      it("emits no variant tweens when no variant is registered", () => {
        const compiled = compileDocument({ document: faceDocument(), assetResolver: resolver, faceSetResolver });
        expect(compiled.html).not.toContain("face-0-eye");
        expect(compiled.html).not.toContain("face-0-mouth");
        const events = setEvents(compiled.html);
        expect(events.every((event) => !event.elementId.includes("-eye") && !event.elementId.includes("-mouth"))).toBe(true);
      });

      it("compiles blink and mouth deterministically", () => {
        const first = compileDocument({
          document: variantDocument(),
          assetResolver: resolver,
          faceSetResolver: variantResolver,
        });
        const second = compileDocument({
          document: variantDocument(),
          assetResolver: resolver,
          faceSetResolver: variantResolver,
        });
        expect(second.html).toBe(first.html);
      });
    });
  });

  describe("caption speaker label", () => {
    it("omits the speaker label by default", () => {
      const compiled = compileDocument({ document: validContentDocument(), assetResolver: resolver });
      expect(compiled.html).toContain('class="kakeai-captiontext"');
      expect(compiled.html).not.toContain('class="kakeai-captionspeaker"');
    });

    it("renders the speaker name as a top-left tab when enabled", () => {
      const document = validContentDocument();
      document.caption = { showSpeakerName: true };
      const compiled = compileDocument({ document, assetResolver: resolver });
      expect(compiled.html).toContain('class="kakeai-captionspeaker"');
      expect(compiled.html).toContain(">ナレーター</span>");
      expect(compiled.html).toContain("font-size:20px");
    });

    it("omits the label for lines without a speaker or with a blank name", () => {
      const document = validContentDocument();
      document.caption = { showSpeakerName: true };
      document.scenes[1]!.lines[0]!.speakerId = null;
      const compiled = compileDocument({ document, assetResolver: resolver });
      expect(compiled.html).not.toContain('class="kakeai-captionspeaker"');

      const blank = validContentDocument();
      blank.caption = { showSpeakerName: true };
      blank.speakers[0]!.name = "   ";
      const compiledBlank = compileDocument({ document: blank, assetResolver: resolver });
      expect(compiledBlank.html).not.toContain('class="kakeai-captionspeaker"');
    });

    it("escapes the speaker name as HTML text", () => {
      const document = validContentDocument();
      document.caption = { showSpeakerName: true };
      document.speakers[0]!.name = "<リン>";
      const compiled = compileDocument({ document, assetResolver: resolver });
      expect(compiled.html).toContain("&lt;リン&gt;</span>");
      expect(compiled.html).not.toContain("<リン></span>");
    });
  });

  describe("caption band layout", () => {
    it("renders the band class and safe area when the theme selects band", () => {
      const theme = getVisualTheme("soft-editorial", 1)!;
      const document = validContentDocument();
      const compiled = compileDocument({
        document,
        assetResolver: resolver,
        resolvedTheme: { ...theme, caption: { layout: "band" } },
      });
      expect(compiled.html).toContain("kakeai-caption-band");
      expect(compiled.html).toContain("--kakeai-caption-safe:224px");
    });
  });
});
