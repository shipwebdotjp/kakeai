# Face Set は不変の改訂版を積み、作品は参照版を固定する

> [ADR-0045](./0045-face-set-global-reference.md) の「可変のグローバル参照」を反転する。

Face Set（眉・目・口・前景の Face Layer と Expression Preset）は、ライブラリ上では編集のたびに**新しい不変の改訂版**を追加する。作品の `CharacterAppearance` は `faceSetId` と `faceSetVersion` の組で改訂版を固定し、その Script Version のプレビュー・レンダーは固定版だけを使う。ライブラリの Character は常に最新版を参照する。

## 理由

[ADR-0045](./0045-face-set-global-reference.md) は Face Set を可変のグローバル参照としたため、ライブラリで顔素材を編集すると、保存済み作品の再プレビュー・再レンダー結果が予告なく変わった。台詞の `expressionId` が消えると保存・レンダーが失敗し、作品が壊れたように見える。作品の正本である `ContentDocument` が参照先の版を持たないことが原因である。

改訂版を積み、作品側で版を固定すれば、編集の試行錯誤を妨げずに、保存済み作品の見た目を安定させられる。制作のたびに人が版を管理するのではなく、コピー時に最新版を自動で固定し、最新版へ移す操作だけを明示的に行う。

## 決定

- Prisma に `FaceSetRevision` を追加し、`FaceLayer` / `ExpressionPreset` は改訂版に属させる。`FaceSet` は識別子と表示名だけを持つ。
- `PATCH /face-sets/:faceSetId` は内容が変わったときだけ新しい改訂版を作る。名前だけの変更では版を増やさない。
- `ContentDocument` の Appearance に `faceSetVersion` を加える。旧JSONは `faceSetId` があれば **v1** として読む。マイグレーションで既存 Face Set の内容を v1 に固定するため、既存作品は移行時点の見た目で凍結される。
- ライブラリの Character は `faceSetId` だけで最新版を解決する。作品の Appearance は `(faceSetId, faceSetVersion)` で解決する。
- 1作品内で同じ Face Set の異なる版を参照してよい。コンパイラの `FaceSetResolver` は `(faceSetId, version)` を受け取る。Render Job の入力スナップショットは解決済みの版を固定する。
- 改訂版の保存時は、その Face Set を参照している**ライブラリ**の全 Appearance のベース画像と寸法が一致することを必須にする。不一致の内容は最新版として確定できない（422）。作品側の固定版は変更しないため、既存作品は影響を受けない。
- ライブラリ Character の保存時も、最新版との寸法一致を検証する。ライブラリ内で不整合を作らせない。
- 参照中の Face Set の削除は引き続き拒否する。Asset の削除ガードは全改訂版の Face Layer を対象にする。
- 改訂版の削除 API は持たない。古い改訂版を参照する作品を壊さないため。

## Considered Options

- Face Set を可変のままにする（ADR-0045）。→ 保存済み作品の再レンダーが予告なく変わり、表情 ID の消失で保存も失敗するため不採用。
- Face Set の内容を作品へコピーする。→ 作品ごとに顔素材を二重管理し、共有の利点が失われるため不採用。
- Theme のように draft と published revision に分ける。→ Face Set は編集画面で直接保存する小さな素材であり、draft の工程を増やす価値が薄いため不採用。

## Consequences

- 改訂版を参照する限り、Face Set の編集は既存作品の再レンダー結果を変えない。最新版へ移すのは、リンク済み Character の明示的な「ライブラリから更新」だけである。
- リンクを持たない既存作品と、手動で Face Set を割り当てた外観は、固定した版のまま更新手段を持たない。必要になった時点で新しい ADR を追加する。
- 古い改訂版が参照する Asset は削除できない。不要になった Face Set は、参照が外れた後にセットごと削除する。
- `schemaVersion` は `1` のまま。`faceSetVersion` は加算的なフィールドであり、旧JSONは v1 として解釈する。
