# Jobの出力は汎用Artifactとし、1 Jobが複数持てる

Job の出力は MP4 専用の `Render` ではなく汎用の `Artifact` として保存し、1 つの Job が複数の Artifact を持てるようにする。MVP では render Job が MP4 の Artifact を 1 つ生成するが、将来のサムネイル・縦型・字幕・SRT は `role` / `format` の追加で扱う。Artifact は Asset へ自動昇格せず、別作品の素材として再利用する要求が出た時点で明示的に Asset 化する。

理由は、複数出力が来るたびに Job と成果物の関係を作り直すのを避けるため。MVP の実装量は増えるが、出力の追加がテーブル追加なしで済む。

## Considered Options

- `Render` のまま `outputKind` 列を足す。→ 複数出力で Job との多重度を作り直す必要があるため不採用。
- MVP は 1 Job 1 MP4 固定。→ 後で破壊的変更になるため不採用。

## Consequences

API の `/renders` は `/artifacts` に統一する。`Asset`（再利用可能な素材）と `Artifact`（Job の出力）は別概念として扱い、来歴を混同しない。
