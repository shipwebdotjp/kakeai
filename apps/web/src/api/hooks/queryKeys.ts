/**
 * Cross-module query keys. Keep these in one place so an invalidation written
 * in one domain module cannot silently drift from the key used by another.
 */
export const queryKeys = {
  works: () => ["works"] as const,
  work: (workId: string | undefined) => ["work", workId] as const,
  workJobs: (workId: string | undefined) => ["work-jobs", workId] as const,
  assets: () => ["assets"] as const,
  currentScriptVersion: (editionId: string | undefined) =>
    ["current-script-version", editionId] as const,
  scriptVersions: (editionId: string | undefined) => ["script-versions", editionId] as const,
  adapterVoices: (adapterId: string | undefined, model: string) =>
    ["adapter-voices", adapterId, model] as const,
  thumbnails: (editionId: string | undefined) => ["thumbnails", editionId] as const,
  youtubeVideoSettings: (editionId: string | undefined) => ["youtube-video-settings", editionId] as const,
  youtubeSettingsTemplates: () => ["youtube-settings-templates"] as const,
  youtubeChapters: (scriptVersionId: string | undefined) => ["youtube-chapters", scriptVersionId] as const,
  youtubeSettingsTemplate: (templateId: string | undefined) => ["youtube-settings-template", templateId] as const,
} as const;
