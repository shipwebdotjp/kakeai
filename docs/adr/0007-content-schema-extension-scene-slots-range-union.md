# Sceneを型付きスロット付きunionとし、VisualCue.rangeをunion化する

> amended by [ADR-0029](./0029-content-document-v3-visual-cue.md): 描画順はVisualCueの `layer`/`order` で定め、`Scene本文`・`caption` はコンパイラ固定層とする。Cueは `transition` を必須で持つ。

ContentDocument の拡張方針として、(a) Scene は `kind` で判別する union とし、型付きスロット（`intro`: title/subtitle、`point`: heading/body、`outro`: closing）と必須の `accentColor` を持つ、(b) `VisualCue.range` は `{ kind: "scene" }` / `{ kind: "lines", startLineId, endLineId }` / `{ kind: "offset", startMs, endMs }` の判別 union とする。破壊的変更は `schemaVersion` を上げて新しい `ScriptVersion` として移行する。

理由は、導入・結びのようにラインを持たないシーンにも背景やタイトルを表示でき、見出し・本文をデータとして扱えるようにするため。`range` を union にしておけば、レンジの種類とスロットを後方互換で追加できる。

## Considered Options

- `range` を line 参照のみとし、ライン無しシーンにダミー行を要求する。→ 字幕・TTS・尺計算の意味が濁るため不採用。
- すべてを汎用 text テンプレートと VisualCue で表現し、Scene にスロットを持たせない。→ 「導入タイトル」等の意味がデータから消え、翻訳・TTS で扱いにくいため不採用。
- `accentColor` を背景用VisualCueの入力に置く。→ 背景素材の有無で編集可能なScene設定が失われ、フォームの保存・再読込が一貫しないため不採用。

## Consequences

テキスト系 VisualTemplate を追加する。`accentColor` はSceneの表示設定として保存し、コンパイラが安全な表示値としてSceneベーステンプレートへ渡す。line / NarrationSegment ID は ContentDocument 全体で一意でなければならない。
