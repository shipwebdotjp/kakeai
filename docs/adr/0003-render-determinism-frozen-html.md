# レンダーは固定したComposition HTMLと全依存を実行し、再コンパイルしない

Status: superseded by ADR-0011

Render Job は作成時に Composition HTML と、レンダー結果を左右する全依存（参照 Asset のハッシュとメタデータ、テンプレート版、HyperFrames と Producer、FFmpeg、Chrome、使用フォントのハッシュ、出力設定）を `inputSnapshotJson` に固定する。ワーカーは保存済み HTML をそのまま実行し、`contentJson` からの再コンパイルは禁止する。プレビューのみライブコンパイルする。

理由は、テンプレートやツールを更新したときに、過去に投入・完了した Job の出力が変わらないことを保証するため。再コンパイルを許すと `inputSnapshotJson` の意味が薄れ、再現性が失われる。

## Considered Options

- ワーカーが `contentJson` から再コンパイルする。→ 再現性が壊れるため不採用。
- 固定 HTML を優先し、無ければ再コンパイル。→ 二重経路が常態化してドリフトするため不採用。

## Consequences

`packages/video` のテンプレート版は削除しない運用を前提とする。ワーカーは HTML 実行に必要なランタイム（Chrome・FFmpeg・フォント）を固定版で用意する。

## その後

MVPではバイト単位の出力再現性を要件とせず、ワーカーが実行時に再コンパイルする方針へ変更した。この決定は [ADR-0011](./0011-render-snapshot-recompile.md) が置き換える。
