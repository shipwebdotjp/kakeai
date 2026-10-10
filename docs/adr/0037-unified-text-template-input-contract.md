# 統合テキストテンプレート `text.block@1` の入力契約

Sceneのテキスト（タイトル・サブタイトル・見出し・本文・結び）を1種のテキスト系VisualTemplate `text.block@1` で表現する（[ADR-0035](./0035-remove-scene-slots-unify-text-cues.md)）。入力は次に閉じる。

- `text`（必須・複数行）: 表示本文。改行を保持する。
- `role`（必須）: `title`/`subtitle`/`heading`/`body`/`closing`。意味付け（既定生成・翻訳・role別の既定スタイルと警告上限の導出）に使う。
- `anchor`（`left`/`center`/`right`）と `verticalAlign`（`top`/`middle`/`bottom`）: 配置。
- `font`: **非同梱のシステムフォント**の有限enum（`sans`/`serif`/`mono`）。レンダー側で固定のフォントスタック名へマップする。
- `fontSize`: 1080p基準の px（整数）。
- `color`: 大文字正規化した `#RRGGBB`。
- `decoration`: `bold`/`italic`/`outline`/`shadow` の真偽。

任意のフォント名・CSS・keyframe・easingは受け入れない（[ADR-0031](./0031-cue-transition-and-animation-ownership.md)）。入力Zodスキーマは版ごとに固定し、開発段階では書き換え可（[ADR-0034](./0034-destructive-changes-before-1-0.md)）。

理由は、roleを残すことで [ADR-0007](./0007-content-schema-extension-scene-slots-range-union.md) が懸念した「導入タイトル等の意味がデータから消える」問題を吸収しつつ、見た目と位置を全テキストで統一的に制御できるため。フォントを非同梱にするのは、レンダー入力を固定して再現性を保つ方針（[ADR-0003](./0003-render-determinism-frozen-html.md)）と整合し、Webフォントの同梱・Chromeでのロード待ちを避けるため。まずシステムフォントの有限集合で足りる。

## Considered Options

- role別に別テンプレートを切る。→ レジストリと版管理が増え、`inputFields` による汎用エディタ（[ADR-0032](./0032-template-input-fields-and-animation-presets.md)）の利点が薄れるため不採用。
- Webフォントを同梱し `font` を任意化する。→ レンダー環境でのロード待ちと決定性・ライセンス管理のコストが増えるため不採用。
- roleを持たず全スタイルを手動指定にする。→ 既定生成・翻訳・警告上限の基準が消えるため不採用。

## Consequences

- 既存 `text.title@1`・`text.body@1` を置き換える。開発段階のため描画コードは書き換えてよい（[ADR-0034](./0034-destructive-changes-before-1-0.md)）。
- 最大行数・最小フォントサイズの目安を `role` 別に本テンプレートの契約として持ち、超過は保存を拒否せず `meta.warnings` で返す（[ADR-0014](./0014-text-overflow-warning-not-rejection.md)）。警告のJSON Pointerは `scenes[i].visualCues[j].input.*` を指す。
- `fontSize` は1080p基準の px とし、9:16など別解像度対応は将来の版・別ADRで扱う。
