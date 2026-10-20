# AI管理CompositionはAssetではなく不変CompositionVersionとして保持する

> amended by [ADR-0069](./0069-visual-skin-and-composition-authoring-context.md)

AI が Kakeai 管理下で作る HyperFrames project は、画像・動画・音声の単一原本であるAssetにせず、draft と不変の CompositionVersion を持つ Composition Library に保存する。ScriptVersion は `composition.full-bleed@1` を通じて version ID だけを参照し、Render Job は bundle hash を固定して native nested composition として一時 project へ展開する。これにより [ADR-0001](./0001-canonical-json-over-derived-media.md) の「台本正本はHTMLではない」を維持しつつ、AI が後からモーション source を改訂できる。

この決定は [ADR-0030](./0030-composite-visual-template-isolation.md) の外部HTML sub-composition 不採用を、Kakeai 管理下の不変・信頼済み bundle に限って改める。任意外部HTMLの import、利用者の直接編集、台本 JSON への生HTML保存は引き続き許可しない。

## Considered Options

- AI composition を毎回透過WebMへ bake して通常video Assetとして使う。→ 利用は容易だが、AI が source を改訂して native nested composition として再利用する目的を満たさないため不採用。
- `Asset.kind = composition` を追加する。→ Assetの単一ファイル、Rendition、素材参照、清掃の契約と、HTML/CSS/JSを含むproject bundleの版管理が異なるため不採用。
- 任意の外部HTMLを受け入れる。→ 現行のローカル安全境界とオフライン再現性を崩すため不採用。
