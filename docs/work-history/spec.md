# 作品複製と台本版の復元・削除仕様

## 目的

作品一覧を作品行とEdition行に分け、複製・履歴・復元・削除の対象言語を常に明示する。複製は選択したEditionの現在版から新しい子Workを作り、復元は同じEditionに新しいScriptVersionを追加する。現在版以外の過去版と、最後を除くEditionは明示的に削除できる。

## 概要

1. 作品一覧
   - 作品行には作品タイトル、作品全体の最終更新日時、Edition一覧の開閉操作、作品全体の削除を置く。
   - 展開したEdition行には locale、現在版番号、Editionの最終更新日時を表示する。
   - Edition行の編集・複製・履歴・削除は、そのEditionのIDを対象にする。編集URLは `/works/:workId/editions/:editionId` とし、再読込後も同じ言語版を開く。
   - 作品全体の削除 (`DELETE /works/:workId`) とEdition削除 (`DELETE /language-editions/:editionId`) は別の操作として提示する。

2. 言語版の複製 (`POST /works/:workId/clone`)
   - リクエストは厳密な `{ title, sourceEditionId }` を受ける。`sourceEditionId` は必須。
   - `sourceEditionId` が対象Workに属することを検証する。存在しない、または他WorkのEditionは404 `RESOURCE_NOT_FOUND`。
   - 指定Editionの `currentScriptVersionId` が示す現在版だけを基に、同じlocaleのLanguageEditionと初期 `ScriptVersion v1` を単一トランザクションで作成する。
   - 新Workの `originalLocale` は複製元Editionのlocaleとし、新Workにはその言語版だけを作成する。
   - `contentJson` と `contentSchemaVersion` は元の現在版からそのままコピーし、台本内のID、素材・音声・BGM・Cue・Composition参照も保持する。
   - APIとAgent `work.clone` の入力は常に `sourceEditionId` を明示する。旧クライアントとの互換性は持たない。
   - Assetファイル、Job、Artifact、レンダー履歴、サムネイルは複製しない。
   - 親Workは子Workが存在する間は削除できない既存制約を維持する。

3. 版復元 (既存APIの組み合わせ)
   - 専用APIは追加しない。
   - 既存の版一覧 (`GET /language-editions/:editionId/script-versions`)、特定版取得 (`GET /script-versions/:scriptVersionId`)、台本保存 (`POST /language-editions/:editionId/script-versions`) を組み合わせる。
   - 選んだ過去版の内容 (`content`) を `sourceScriptVersionId` に過去版IDを指定して送信・保存する。
   - `sourceScriptVersionId` は同じ Edition の版に限り、別 Edition の版を指定した保存は `VALIDATION_ERROR` とする。
   - 復元は既存版を上書きせず、新しい最大版番号を持つ現在版を作成する。
   - 現在版は復元対象として選択できるが、削除対象にはできない。

4. 過去版の一括削除 (`POST /language-editions/:editionId/script-versions/bulk-delete`)
   - リクエストは `{ scriptVersionIds }`。ID配列は1件以上100件以下で重複不可。
   - 全IDが対象Editionに属し存在することを検証してから一括処理する。存在しない版・別Editionの版を含む場合は422 `VALIDATION_ERROR`。
   - 現在版を含む場合は409 `CURRENT_SCRIPT_VERSION_DELETE`。
   - 対象版に実行中 (`running`) のJobがある場合は409 `SCRIPT_VERSION_JOB_RUNNING`。
   - 検証または削除に失敗した場合は全件を削除しない。
   - 対象版を `sourceScriptVersionId` で参照する版は、同一Workかどうかによらず参照を null にしてから削除する。
   - キュー済み・完了・失敗・キャンセルの関連Job、Artifact、ファイル実体を削除する。共有Assetは削除せず、`generatedByJobId` の参照だけを外す。
   - 版番号は振り直さない。成功時は204 No Content。

5. Edition削除 (`DELETE /language-editions/:editionId`)
   - EditionのScriptVersion、関連Job、Artifact、ファイル実体、サムネイルを削除する。キュー済みJobも削除対象に含める。
   - 対象Editionに実行中 (`running`) のJobがある場合は409 `LANGUAGE_EDITION_JOB_RUNNING`。
   - 作品の最後のEditionは409 `LAST_LANGUAGE_EDITION` とし、Workには少なくとも1つのEditionを残す。
   - 存在しないEditionは404 `RESOURCE_NOT_FOUND`。
   - `Work.originalLocale` は原本localeのEditionを削除しても変更しない（作品の来歴）。
   - 共有Assetは削除しない。成功時は204 No Content。

6. UI
   - 履歴・復元は作品全体ではなくEdition行から開く。現在の履歴モーダルを使い、新しいURLルートは作らない。
   - モーダルには現在版以外の各版の選択チェックボックスを置き、「選択した版を削除」で一括削除を呼ぶ。現在版は選択不可。
   - 複製Modalは選択Editionのlocaleと現在版番号を示し、成功後は新しい作品の同じlocaleのEdition編集画面へ遷移する。
   - 実行中は重複操作を無効化し、エラー時は既存のエラー表示を行う。

## Web API hooks

- `useCloneWork` は `sourceEditionId` を送る。
- `useDeleteLanguageEdition` と `useDeleteScriptVersions` を追加する。
- 複製・復元・削除の完了後に `works`, `work`, `current-script-version`, `script-versions` のキャッシュを適切に更新・無効化する。
