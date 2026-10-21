# テンプレート版は保存済み有効入力を再解釈しない境界であり、そのときだけ版を上げる

Status: amends ADR-0009, ADR-0018, ADR-0034; amended by ADR-0071, ADR-0080

`template.id@version` の version は機能の連番ではなく、「保存済みの有効入力を再解釈しない境界」である。version を上げるのは、既存の有効データの意味・レイアウト・検証結果を変える場合だけとする。入力スキーマの拡張（任意フィールドの追加など）や描画の内部改善が、保存済みの有効入力の解釈を変えない限り、同じ版を書き換えてよい。

`ContentDocument` の `schemaVersion` も同じ原則に従う。既存の有効 JSON の解釈を変える場合だけ版を上げ、そのとき移行コードを追加する。移行コードを先回りして持たない点は [ADR-0013](./0013-content-schema-version-starts-at-1.md) を引き継ぐ。

## Considered Options

- 機能追加のたびに版を追記する（従来の連番運用）。→ 探索中の機能追加ごとに過去版の描画コードが残り、参照ゼロの版が増える。[ADR-0018](./0018-template-version-gc.md) の削除検査は残せるが、連番自体が「再解釈しない境界」の意味と一致しなくなるため不採用。
- 入力スキーマの互換拡張でも必ず版を上げる。→ 任意フィールド追加のような再解釈を伴わない変更まで版を増やし、UI の既定版選択と参照検査のコストが増えるため不採用。

## Consequences

- 正式リリース前は、現行機能を template `@1` と ContentDocument `schemaVersion: 1` に再基準化し、旧版の decoder と migration を削除する。
- `composition.full-bleed@1` の `scene` / `lines` / `offset` 全 range 許可のような再解釈を伴う拡張は、版を上げず既存 `@1` で行わない。再解釈を伴う場合は新版を切る。
- 参照ゼロの版を削除できる点は [ADR-0018](./0018-template-version-gc.md) を引き継ぐ。
