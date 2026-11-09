import {
  type LiveCharacterSheet,
  type LiveExportProgramCharacter,
  type SnapshotFaceSet,
} from "@kakeai/contracts";
import { faceSetKey } from "../services/script-versions/references.ts";
import { LiveExportError } from "./errors";
import { toLiveMediaType } from "./media-types";
import type { PackageWriter } from "./package-writer";
import { prepareFaceSet } from "./prepare-face-sets.ts";
import type { ResolvedAssetFile, ResolvedSpeaker } from "./resolved-assets";
import { voiceForSpeaker, type PreparedVoices } from "./prepare-voices";

export interface PreparedProgramCharacters {
  sheet: LiveCharacterSheet;
}

function fail(message: string, id: string | null = null): never {
  throw new LiveExportError("LIVE_EXPORT_MATERIAL_FAILED", "material", message, id);
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

/**
 * Builds characters.json from the program snapshot. Images, face sets and the
 * speaker voice are already resolved; no Character library row is read here.
 */
export async function prepareProgramCharacters(
  characters: readonly LiveExportProgramCharacter[],
  faceSets: readonly SnapshotFaceSet[],
  assetById: Map<string, ResolvedAssetFile>,
  speakers: readonly ResolvedSpeaker[],
  voices: PreparedVoices,
  writer: PackageWriter,
): Promise<PreparedProgramCharacters> {
  const faceSetByKey = new Map(
    faceSets.map((faceSet) => [faceSetKey(faceSet.id, faceSet.version ?? 1), faceSet]),
  );
  const faceSetOutputs = new Map<string, LiveCharacterSheet["faceSets"][number]>();
  const sheetCharacters: LiveCharacterSheet["characters"] = [];

  for (const character of characters) {
    const speaker = speakers.find((entry) => entry.side === character.side);
    if (speaker === undefined) {
      fail(`side ${character.side} の話者が見つかりません。`, character.id);
    }
    const voice = voiceForSpeaker(speaker, voices);

    const appearances: LiveCharacterSheet["characters"][number]["appearances"] = [];
    for (const appearance of character.appearances) {
      const image = await writeImageAsset(
        writer,
        assetById,
        appearance.imageAssetId,
        "キャラクター外観",
      );
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

    sheetCharacters.push({
      id: character.id,
      side: character.side,
      name: character.name,
      appearances,
      voice,
    });
  }

  return {
    sheet: {
      schemaVersion: 1,
      characters: sheetCharacters,
      faceSets: [...faceSetOutputs.values()],
    },
  };
}
