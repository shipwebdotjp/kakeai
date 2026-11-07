import {
  type ContentDocument,
  type LiveCharacterSheet,
  type LiveFaceSet,
  type LiveFaceSetLayer,
  type LiveShowProfile,
  type LiveSide,
  type SnapshotFaceSet,
} from "@kakeai/contracts";
import { faceSetKey } from "../services/script-versions/references.ts";
import { LiveExportError } from "./errors";
import { toLiveMediaType } from "./media-types";
import type { PackageWriter } from "./package-writer";
import type {
  ResolvedAssetFile,
  ResolvedLiveProfile,
} from "./profile-resolution";
import { voiceForSpeaker, type PreparedVoices } from "./prepare-voices";

export interface PreparedCharacters {
  sheet: LiveCharacterSheet;
  voiceByCharacterId: Map<string, import("@kakeai/contracts").LiveSpeakerVoice>;
}

function fail(message: string, id: string | null = null): never {
  throw new LiveExportError("LIVE_EXPORT_MATERIAL_FAILED", "material", message, id);
}

function characterName(
  character: ContentDocument["characters"][number],
  locale: string,
): string {
  return character.names.find((entry) => entry.locale === locale)?.name ?? character.name;
}

async function writeImageAsset(
  writer: PackageWriter,
  assetById: Map<string, ResolvedAssetFile>,
  assetId: string,
  usage: string,
): Promise<string> {
  const asset = assetById.get(assetId);
  if (asset === undefined) {
    fail(`${usage} の画像が見つかりません: ${assetId}`, assetId);
  }
  if (asset.kind !== "image") {
    fail(`${usage} は画像ではありません: ${assetId}`, assetId);
  }
  return writer.writeAsset(asset.path, {
    mediaType: toLiveMediaType(asset.mediaType, assetId),
    kind: "asset",
    durationMs: null,
    width: asset.widthPx,
    height: asset.heightPx,
    hasAudio: false,
  });
}

async function prepareFaceSet(
  faceSet: SnapshotFaceSet,
  assetById: Map<string, ResolvedAssetFile>,
  writer: PackageWriter,
): Promise<LiveFaceSet> {
  const layerById = new Map(faceSet.layers.map((layer) => [layer.id, layer]));
  const layers: LiveFaceSetLayer[] = [];
  for (const layer of faceSet.layers) {
    const file = await writeImageAsset(writer, assetById, layer.assetId, "顔レイヤー");
    const blink = layer.blinkLayerId === null ? undefined : layerById.get(layer.blinkLayerId);
    if (layer.blinkLayerId !== null && blink === undefined) {
      fail(`瞬きレイヤーが見つかりません: ${layer.blinkLayerId}`, layer.id);
    }
    const speaking =
      layer.speakingLayerId === null ? undefined : layerById.get(layer.speakingLayerId);
    if (layer.speakingLayerId !== null && speaking === undefined) {
      fail(`口パクレイヤーが見つかりません: ${layer.speakingLayerId}`, layer.id);
    }
    const blinkFile =
      blink === undefined
        ? undefined
        : await writeImageAsset(writer, assetById, blink.assetId, "瞬きレイヤー");
    const speakingFile =
      speaking === undefined
        ? undefined
        : await writeImageAsset(writer, assetById, speaking.assetId, "口パクレイヤー");
    layers.push({
      id: layer.id,
      part: layer.part,
      file,
      ...(blinkFile === undefined ? {} : { blinkFile }),
      ...(speakingFile === undefined ? {} : { speakingFile }),
    });
  }
  return {
    id: faceSet.id,
    version: faceSet.version ?? 1,
    layers,
    expressions: faceSet.expressions.map((expression) => ({ ...expression })),
  };
}

/**
 * Builds characters.json from the frozen ScriptVersion, the pinned Face Set
 * revisions and the package-relative Asset paths written by PackageWriter.
 */
export async function prepareCharacters(
  content: ContentDocument,
  profile: LiveShowProfile,
  faceSets: SnapshotFaceSet[],
  assetById: Map<string, ResolvedAssetFile>,
  resolved: ResolvedLiveProfile,
  voices: PreparedVoices,
  writer: PackageWriter,
): Promise<PreparedCharacters> {
  const faceSetByKey = new Map(
    faceSets.map((faceSet) => [faceSetKey(faceSet.id, faceSet.version ?? 1), faceSet]),
  );
  const faceSetOutputs = new Map<string, LiveFaceSet>();
  const characters: LiveCharacterSheet["characters"] = [];
  const voiceByCharacterId = new Map<string, import("@kakeai/contracts").LiveSpeakerVoice>();
  const sides: LiveSide[] = ["left", "right"];

  for (const side of sides) {
    const characterId = profile.show.characters[side];
    if (characterId === null) {
      continue;
    }
    const character = content.characters.find((entry) => entry.id === characterId);
    if (character === undefined) {
      fail(`キャラクターが見つかりません: ${characterId}`, characterId);
    }
    const speaker = resolved.speakers.find((entry) => entry.side === side);
    if (speaker === undefined) {
      fail(`side ${side} の話者が見つかりません。`, characterId);
    }
    const voice = voiceForSpeaker(speaker, voices);
    voiceByCharacterId.set(character.id, {
      ...voice,
      settings: { ...voice.settings },
    });

    const appearances: LiveCharacterSheet["characters"][number]["appearances"] = [];
    for (const appearance of character.appearances) {
      const image = await writeImageAsset(writer, assetById, appearance.assetId, "キャラクター外観");
      if (appearance.faceSetId !== null) {
        const version = appearance.faceSetVersion ?? 1;
        const key = faceSetKey(appearance.faceSetId, version);
        const faceSet = faceSetByKey.get(key);
        if (faceSet === undefined) {
          fail(`表情セットが見つかりません: ${key}`, appearance.faceSetId);
        }
        if (!faceSetOutputs.has(key)) {
          faceSetOutputs.set(key, await prepareFaceSet(faceSet, assetById, writer));
        }
      }
      appearances.push({
        id: appearance.id,
        expression: appearance.expression,
        image,
        faceSetId: appearance.faceSetId,
        faceSetVersion: appearance.faceSetVersion,
        ...(appearance.standing === undefined ? {} : { standing: appearance.standing }),
      });
    }

    characters.push({
      id: character.id,
      side,
      name: characterName(character, profile.show.locale),
      appearances,
      voice,
    });
  }

  return {
    sheet: {
      schemaVersion: 1,
      characters,
      faceSets: [...faceSetOutputs.values()],
    },
    voiceByCharacterId,
  };
}
