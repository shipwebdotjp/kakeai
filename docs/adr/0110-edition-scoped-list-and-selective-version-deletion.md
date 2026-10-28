# 版とEditionを保持し続けず、明示選択で削除できるようにする

## 決定

`ScriptVersion` の不変性は維持するが、Workが存続する間も、現在版以外の過去版を利用者が明示的に選択して一括削除できるようにする。`LanguageEdition` も、作品に少なくとも1つ残る限り削除できる。作品全体の削除（`DELETE /works/:workId`）は別操作として残す。

- 過去版削除は `POST /language-editions/:editionId/script-versions/bulk-delete` にEdition IDとScriptVersion ID群を渡し、全件検証してから単一トランザクションで処理する。現在版を含む場合と実行中Jobがある場合は拒否する。
- Edition削除は `DELETE /language-editions/:editionId` とし、最後のEditionと実行中Jobを拒否する。削除対象の版・Job・Artifact・ファイル実体・サムネイルを削除し、共有Assetは残す。
- 削除した版を `sourceScriptVersionId` で参照する版は、同一Workかどうかによらず参照を null にする。版番号は振り直さない。
- `Work.originalLocale` はEdition削除後も作品の来歴として保持する。
- 作品一覧を作品行とEdition行に分け、複製・履歴・復元・削除は常にEdition IDを明示する。複製APIとAgent `work.clone` は必須の `sourceEditionId` を受け取る。

## 理由

旧方針（[spec.md](../mvp/spec.md) の「Workが存続する間は全ScriptVersionを保持し、個別の版削除・履歴圧縮は提供しない」）は、個人利用の反復制作で版が増え続け、一覧・履歴・バックアップが重くなる問題を解決できなかった。版の不変性は「保存済みの版をその場で書き換えない」ことにあり、不要な版を利用者の明示操作で削除することとは両立する。削除を明示的な操作に限り、現在版・実行中Job・最後のEditionをガードすることで、編集中の内容と実行中の処理を失わない。

複製・履歴・削除の対象をWork全体からEditionへ絞るのは、多言語作品で「どの言語を複製・削除するか」が曖昧だと、意図しない言語版や履歴を失うためである。URLにEdition IDを含めることで、再読込後も対象言語が保たれる。

## 代替案

- すべての版を永久保持する。→ 版が増え続け、利用者が不要な版を整理できないため不採用。
- Edition削除で作品全体も削除する。→ 他言語版を残したい需要と衝突するため不採用。作品全体削除は既存の別操作に残す。
- 過去版の削除を1件ずつにする。→ 履歴の整理は複数選択で行うことが多く、API呼び出しと部分失敗が増えるため不採用。全件検証後に一括処理する。
- `Work.originalLocale` を残ったEditionに合わせて書き換える。→ 原本localeは作品の来歴であり、編集対象の現在構成とは別であるため不採用。
- 版番号を削除後に振り直す。→ 既存のJob・履歴・外部参照が指す版番号の意味が変わるため不採用。

## 影響

- `docs/mvp/spec.md` の版保持方針、`docs/mvp/api-contract.md`、`docs/work-history/spec.md`、`docs/multilingual-editions/spec.md`、ユーザーガイドを更新する。
- DBスキーマの変更は不要。既存の参照制約を満たすよう、トランザクション内で `currentScriptVersionId`・`sourceScriptVersionId`・`primaryThumbnailId`・`generatedByJobId` を整理してから削除する。
- 過去版・Editionの削除は元に戻せない。UIでは確認を求め、実行中のJobがある場合は拒否する。
- 参照が解除されたArtifactの実体ファイルは、既存のWork削除と同じベストエフォートで回収する。

## 関連

- [ADR-0002](./0002-script-version-immutability-canonicalization.md): ScriptVersionの不変性は維持する。
- [ADR-0081](./0081-language-edition-added-to-existing-work.md): 多言語版は既存WorkへのEdition追加で作る。
- [work-history/spec.md](../work-history/spec.md): 複製・復元・削除の詳細。
