# ContentDocument 破壊変更履歴

この文書は、`ScriptVersion.contentJson` の正本JSON契約（[content-schema.md](content-schema.md)）に対する破壊的変更の一覧を正とする。破壊的変更とは、既存の保存済みJSONが新しい契約をそのまま満たさなくなる変更を指す。破壊的変更を行うときは `schemaVersion` を上げ、この文書と移行コード、ADR を同じ変更で更新する。

`Job.inputSnapshotJson` の `snapshotSchemaVersion` は別系統の版管理であり、この文書の対象外とする。

## 一覧

| `schemaVersion` | 変更概要 | 関連ADR | 読出し時の移行 |
| --- | --- | --- | --- |
| 1 | 正式リリース前の基準契約（[ADR-0061](../adr/0061-template-version-as-reinterpretation-boundary.md)）。テンプレートは全機能を `@1` に再基準化し、旧版 decoder・v4〜v8 読出し移行を削除 | [0061](../adr/0061-template-version-as-reinterpretation-boundary.md) | `schemaVersion != 1` は拒否し、移行コードは持たない |

## 運用規則

- 保存済みJSONやそのハッシュを読み出し時に書き換えてはならない。次回の保存で新しい `ScriptVersion` を作る。
- `contentJson` はキー順を安定させたJSON文字列として保存する。JCS正規化や `contentHash` は持たない。
- 移行コードを先回りして持たない。版を上げる時点で `packages/contracts` に移行関数を追加する。
