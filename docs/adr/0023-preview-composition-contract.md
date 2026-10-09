# プレビュー合成の公開契約（assetResolverの拡張と自己完結HTML）

[ADR-0004](./0004-asset-resolver-contract.md) の `assetResolver: (assetId) => string` を
`assetResolver: (assetId) => { url, kind }`（`kind` は `image` / `video`）へ拡張する。
コンパイラは `<img>` と `<video>` のどちらを出すか決めるために素材種別を必要とし、
URLの拡張子や別問合せで推測するとプレビューとレンダーでドリフトするため、
解決の呼び出し側が種別も返す。URLかローカルパスかの切替えは従来どおり呼び出し側に閉じ込める。

Composition HTMLはGSAPバンドルをインライン化した自己完結の単一文書とし、
外部CDNへ依存しない。プレビューはこのHTMLを `srcdoc` で `<hyperframes-player>` へ渡し、
Playerのiframeは既定の `allow-scripts` + `allow-same-origin` のまま同一起源でマウントする。
同一originのため素材のメディアセッションCookieが届き、オフライン動作を保てる。

## Considered Options

- URL文字列のまま種別を別APIで問合せる。→ コンパイル毎に問合せが増え、プレビューとレンダーの解決経路がずれるため不採用。
- GSAPをCDNから読み込む。→ オフライン要件に反するため不採用。
- GSAPを別エンドポイントで配信する。→ Compositionが単体で完結せず、P5のレンダー入力も増えるため不採用。

## Consequences

- GSAPは標準の無償ライセンスでバンドルする。HyperFramesのCompositionがGSAPランタイムを要求するため、スタック選択に付随する。
- `@hyperframes/player` は `@hyperframes/core` 経由で `studio-server` / `sharp` を依存に含む。上流のパッケージ構成として受容し、削減は行わない。
- `@hyperframes/player` の版は `apps/web` にexact pinし、`packages/video` の報告値と一致させる。
