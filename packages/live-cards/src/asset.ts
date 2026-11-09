import type { LiveCardAssetResolver } from "./types";

export class LiveCardAssetError extends Error {
  override readonly name = "LiveCardAssetError";

  constructor(
    readonly assetId: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Normalises the sync/async resolver. A synchronous string is returned as-is
 * so editor previews can set `src` immediately; promises keep their async
 * failure path. Missing resolvers, throws and empty URLs become rejection
 * failures so the caller hides the card instead of leaving it half-rendered.
 */
export function resolveAssetUrl(
  resolver: LiveCardAssetResolver | undefined,
  assetId: string,
): string | Promise<string> {
  if (resolver === undefined) {
    return Promise.reject(
      new LiveCardAssetError(assetId, `画像アセットのリゾルバがありません: ${assetId}`),
    );
  }
  try {
    const result = resolver(assetId);
    if (typeof result === "string") {
      return result.length === 0
        ? Promise.reject(
            new LiveCardAssetError(assetId, `画像アセットのURLが空です: ${assetId}`),
          )
        : result;
    }
    return Promise.resolve(result).then((url) => {
      if (typeof url !== "string" || url.length === 0) {
        throw new LiveCardAssetError(assetId, `画像アセットのURLが空です: ${assetId}`);
      }
      return url;
    });
  } catch (error) {
    return Promise.reject(error);
  }
}
