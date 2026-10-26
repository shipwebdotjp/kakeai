import { LEGACY_FACE_SET_VERSION } from "@kakeai/contracts";
import { useFaceSetRevisions } from "../../api/hooks";
import type { CharacterFormValue } from "../../content/form";

/**
 * Expression candidates for a line must come from the Face Set revisions the
 * work has pinned, not from the latest library revision. A line may be shown
 * over multiple standing appearances of the same character, so only presets
 * present in every pinned revision are selectable.
 */
export function usePinnedFaceSetPresets(
  character: CharacterFormValue | undefined,
  standingAppearanceIds: ReadonlySet<string | null>,
) {
  const standingAppearances =
    character?.appearances.filter((appearance) =>
      standingAppearanceIds.has(appearance.id),
    ) ?? [];
  const pinnedFaceSets = useFaceSetRevisions(
    standingAppearances.flatMap((appearance) =>
      appearance.faceSetId === null ? [] : [appearance.faceSetId],
    ),
  );
  const pinnedRevisions = standingAppearances.map((appearance) =>
    appearance.faceSetId === null
      ? undefined
      : pinnedFaceSets.byKey.get(
          `${appearance.faceSetId}@${appearance.faceSetVersion ?? LEGACY_FACE_SET_VERSION}`,
        ),
  );
  const ready =
    pinnedFaceSets.isReady &&
    standingAppearances.every(
      (appearance, index) =>
        appearance.faceSetId === null || pinnedRevisions[index] !== undefined,
    );
  const allAppearancesHaveFaceSet = standingAppearances.every(
    (appearance) => appearance.faceSetId !== null,
  );
  const presets =
    ready && allAppearancesHaveFaceSet
      ? (pinnedRevisions[0]?.expressions ?? []).filter((preset) =>
          pinnedRevisions.every((revision) =>
            revision?.expressions.some((candidate) => candidate.id === preset.id),
          ),
        )
      : [];
  return { presets, ready, isError: pinnedFaceSets.isError };
}
