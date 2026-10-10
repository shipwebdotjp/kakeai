# Sceneスロットを廃止し、テキストをVisualCueへ統一する

`intro`/`point`/`outro` Scene が持つ `slots`（`title`/`subtitle`/`heading`/`body`/`closing`）を廃止する。タイトル・サブタイトル・見出し・本文・結びは、統合した1種のテキスト系 VisualTemplate を VisualCue として配置して表現する。

統合テキストテンプレートは、配置（左右・上下）・フォント・フォントサイズ・色・装飾を入力に持つ。`text.title@1` と `text.body@1` はこのテンプレートへ統合し、複数のテキスト表現を1つの入力契約に閉じる。

Scene は `kind`（`intro`/`point`/`outro`）を並び順と既定生成の意味付けとして残すが、型付きスロットは持たない。新規作品の導入・要点・結びの既定テキストは、廃止したスロットの代わりに既定の VisualCue として生成する。

ContentDocument の `schemaVersion` を `3` から `4` へ上げる。[ADR-0034](./0034-destructive-changes-before-1-0.md) に従い、開発段階のため旧版の読出し・移行コードは持たず、保存済みデータは作り直す前提とする。

理由は、Scene本文とテキストCueが同じテキスト表現を二重に持つと、編集UI・検証・描画が二系統になり、配置や装飾の指定が片方にしか効かないため。すべてのテキストを VisualCue の `range`・`layer`・`order`・`transition` に統一すれば、編集・アニメーション・翻訳の対象が1つになる。配置・フォント・色・装飾を入力契約に持たせることで、Scene ごとの見た目を編集者が制御できる。

## Considered Options

- スロットを残し、統合テキストテンプレートを追加する。→ 同じテキスト表現が二重になり、編集UI・検証・描画が分裂するため不採用。
- スロットの意味（導入タイトル等）をデータに残すためスロットを維持する（[ADR-0007](./0007-content-schema-extension-scene-slots-range-union.md)）。→ テキストの見た目・位置を統一的に制御できず、Scene本文とCueで装飾指定が非対称になるため、本ADRで反転する。
- `kind` も廃止し、完全にフラットなCue列にする。→ 導入・要点・結びの並び順と新規作品の既定生成、翻訳時の役割付けが失われるため、`kind` は残す。

## Consequences

- [ADR-0007](./0007-content-schema-extension-scene-slots-range-union.md) を supersede する（Sceneスロットは持たない）。
- [ADR-0025](./0025-flexible-scene-template.md) を amend する（`explanation-scenes` はスロットでなく既定Cueを生成する）。
- `packages/contracts` の `scene.ts`・`defaults.ts`・`warnings.ts` と、`packages/video` のコンパイラ・テキストテンプレート、`apps/web` の `form.ts`・`SceneEditor.tsx` を v4 へ同期する。
- テキストの最大行数・最小フォントサイズの目安は、フォント設定を持つ統合テキストテンプレートの契約へ移す。
- `accentColor` は Scene の表示設定として残す。
