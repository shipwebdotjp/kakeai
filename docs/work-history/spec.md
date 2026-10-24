# 作品複製と台本版の復元仕様

## 目的

作品一覧の各作品に「操作」メニューを追加し、現在版からの複製と、版履歴からの非破壊な復元を提供する。複製は子Workとして新規作成し、復元は同じWorkに新しいScriptVersionを追加する。

## 概要

1. 作品複製 (`POST /works/:workId/clone`)
   - リクエストは厳密な `{ title }` を受ける。
   - 元Workの `currentScriptVersionId` が示す現在版を基に、同じlocaleのLanguageEditionと初期 `ScriptVersion v1` を単一トランザクションで作成する。
   - 新Workの `parentWorkId` に元WorkのIDを設定する。
   - `contentJson` と `contentSchemaVersion` は元の現在版からそのままコピーし、台本内のID、素材・音声・BGM・Cue・Composition参照も保持する。
   - Assetファイル、Job、Artifact、レンダー履歴は複製しない。
   - DBマイグレーションは不要（Prismaスキーマの `Work.parentWorkId` および `ScriptVersion.sourceScriptVersionId` を利用する）。
   - 親Workは子Workが存在する間は削除できない既存制約を維持する。

2. 版復元 (既存APIの組み合わせ)
   - 専用APIは追加しない。
   - 既存の版一覧 (`GET /language-editions/:editionId/script-versions`)、特定版取得 (`GET /script-versions/:scriptVersionId`)、台本保存 (`POST /language-editions/:editionId/script-versions`) を組み合わせる。
   - 選んだ過去版の内容 (`content`) を `sourceScriptVersionId` に過去版IDを指定して送信・保存する。
   - `sourceScriptVersionId` は同じ Edition の版に限り、別 Edition の版を指定した保存は `VALIDATION_ERROR` とする。
   - 復元は既存版を上書きせず、新しい最大版番号を持つ現在版を作成する。
   - 現在版は復元対象として表示のみとし、操作を出さない。

3. UI（作品一覧と操作メニュー）
   - 作品一覧の各行に「操作」メニューを配置し、`複製`、`履歴・復元`、`削除` を含める。
   - `複製`: Modalで作品名を編集可能にし、既定値を `「元作品タイトル」のコピー` とする。成功後は複製された作品の編集画面 (`/works/:newWorkId`) へ遷移する。
   - `履歴・復元`: 保存日時と版番号を降順で表示するModalを表示する。現在版は「現在版」と表示し復元ボタンは出さない。過去版の「復元」では「既存版を上書きせず新しい版を作る」ことを明示して確認し、成功後はModalを閉じずに一覧と表示中の最新版情報を更新する。
   - 実行中は重複操作を無効化し、エラー時は既存のエラー表示を行う。

4. Web API hooks
   - `useCloneWork`, `useScriptVersions`, `useScriptVersion`, `useRestoreScriptVersion` (または `useSaveScriptVersion` の拡張) を追加。
   - 複製・復元完了後に `works`, `work`, `current-script-version`, `script-versions` のキャッシュを適切に更新・無効化する。
