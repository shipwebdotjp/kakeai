/** Looks up a stage element and fails loudly when the HTML drifts. */
export function element<T extends HTMLElement>(id: string): T {
  const target = document.getElementById(id);
  if (target === null) {
    throw new Error(`ステージ要素が見つかりません: #${id}`);
  }
  return target as T;
}

/** Package-relative media path to the same-origin `/package/*` URL. */
export function packageUrl(path: string): string {
  return `/package/${path.split("/").map(encodeURIComponent).join("/")}`;
}
