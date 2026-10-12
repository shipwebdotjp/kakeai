import type { CompositionManifest } from "@kakeai/contracts";

export interface CompositionVersionResolved {
  id: string;
  runtimeCompositionId: string;
  entrypoint: string;
  bundleHash: string;
  storageKey: string;
  manifest: CompositionManifest;
  previewUrl?: string;
}

export type CompositionVersionResolver = (versionId: string) => CompositionVersionResolved;
