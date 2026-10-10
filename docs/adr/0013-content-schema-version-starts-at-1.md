# 正本スキーマ版は1から始め、移行コードを先回りして持たない

> amended by [ADR-0029](./0029-content-document-v3-visual-cue.md): 保存済み `ScriptVersion` が無いことを確認したうえで、`schemaVersion` は `3` から始める。v1/v2 の読出し・移行コードは持たない。
>
> amended by [ADR-0034](./0034-destructive-changes-before-1-0.md): 正式リリース前は `schemaVersion` の破壊的変更を許容し、移行関数を持たない。`1.0.0` 以降は本ADRの移行規律へ戻る。

`ContentDocument` の `schemaVersion` は出荷時のMVPで `1` から始める。設計中に検討した旧版（v1/v2相当）の保存済みデータは存在しないため、旧版の読出し解釈や移行関数を先回りして実装しない。破壊的変更を行う時点で初めて版を上げ、そのとき移行関数を追加する。

## Considered Options

- 設計履歴に合わせて `3` から始め、v1/v2の読出し・移行を実装する。→ 実在しないデータのコードを保守することになるため不採用。
