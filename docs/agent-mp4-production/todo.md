# エージェントMP4制作 TODO

[spec.md](./spec.md) を正とする。上から順に進める。P1 の完了で
「人間プリフライト済みの環境で MP4 を出せる」状態を作り、P2 は運用の
取りこぼしを減らす改善、P3-1 は入力契約の探索性を上げる改善である。
P3-2 のうち保存版・素材の視覚確認は実装済みで、下書き・複数フレームなど
残る項目は将来項目として [roadmap.md](./roadmap.md) へ送る。
P4 は制作履歴・復旧（版履歴・復元・Work 複製・タイムアウト回復）である。
P5 はライブラリ読み取りと声の割り当て（Theme / Face Set / Voice Profile の読み取り、
声だけの話者）である。

## P0 現状の再現と固定（コード変更なし）

- [x] en-US の `work.create` 直後に `script.edit` が
      `VALIDATION_ERROR`（`content.locale`）になることをテストで再現する
      （`work-flow.test.ts` / `defaults.test.ts`）
- [x] 声付きキャラクターが無い新規 Works で `tts.createBulk` が
      `excluded` / `TTS_INPUT_INVALID` を返すことを既存テストで確認する
      （`tts-flow.test.ts` / `tts-socket-integration.test.ts`）
- [x] 声付きキャラクターを `character.addFromLibrary` でコピーし、
      `line.setSpeaker` → `tts.createBulk(requestId)` → `tts.attachBulk`
      → `render.start` → `succeeded` の主線を既存テストで確認する
      （`production-flow.test.ts`）
- [x] `tts.createBulk` / `tts.attachBulk` の `pending` → `finalized` を確認する
      （`tts-attach-bulk-socket-integration.test.ts`）
- [x] `render.start` の同じ `requestId` 再送で Job が増えないことを確認する
      （`idempotency-socket-integration.test.ts`）
- [x] 単一ワーカーが素材取り込み・TTS・レンダーを `createdAt` 昇順で
      処理することをコードで確認する（`worker/index.ts`。専用テストは追加しない）

完了条件: 現状の停止点と成功経路が、テストまたは既存テスト・コード確認で示せる。

## P1 MP4主線のブロッカー修正

- [x] `createInitialContentDocument` を locale 引数対応にし、
      `work.create` が指定 locale の初期台本を作るようにする
- [x] en-US の `work.create` → `script.edit` の回帰テストを追加する
- [x] `skills/kakeai-production/SKILL.md` に MP4主線の前提を追加する
      - `character.list` で対象 locale の声を確認する
      - 無ければ TTS を開始せず人間にキャラクター作成を依頼する
      - 標準は `character.addFromLibrary` によるコピー
      - MP4の合格ラインは「render Job 成功 + MP4 Artifact 存在」で、
        最終確認・サムネ・SRT・YouTube は人間
      - `tts.createBulk` の `requestId` 必須、`attachBulk` までの台本保存禁止、
        同じ `agentId` で確定
      - `preview.frame` は必須にしない
- [x] `user-guide/docs/agent-access.md` に同じ前提と合格ラインを追加する
- [x] 声が無い場合の停止手順を、スキルのチェックリストに固定する
- [x] ja-JP の主線（声付きキャラクター → 一括TTS → 確定 → レンダー）を
      統合テストで固定する（既存 `production-flow.test.ts` で確認）
- [x] `npm run typecheck` と `npm test` を通す（121 files / 1331 tests）

完了条件: 人間プリフライト済みの ja-JP 新規作品で、エージェントが
`work.create` から `render` 成功まで通せる。en-US の初期台本が直っている。
声が無い場合は TTS 前に停止する手順がスキルとガイドに明記されている。

## P2 復旧力の改善（MP4主線の必須条件ではない）

P1 完了時点で MP4 は出せる。P2 は、エージェントが手順を飛ばした場合や
タイムアウトした場合の回復力を上げる。契約変更を伴うため、着手時に
`operationDigest` の変化と後方互換を確認する。

- [x] `job.list` を `kind`（`render` / `tts`）で絞れるようにする。
      `asset_ingest` は Work に紐づかないため対象外とし、`job.get` で確認する。
      TTS Job を失った場合の回復手段を用意する
- [x] `script.save` に任意の `baseScriptVersionId`（基準版ガード）を追加し、
      全体置換の上書きを防ぐ
- [x] `work.create` の重複対策は、`requestId` を追加せず、タイムアウト後に
      `work.list` で確認してから再実行するガイド路線にする
- [x] `script.save` に `sourceScriptVersionId` を追加する（同一 Edition のみ。
      翻訳元の別 Edition は記録できない）
- [x] `AGENT_REQUEST_TIMEOUT` 後の回復手順を、操作ごとの表に整理する
- [x] `npm run typecheck` と `npm test` を通す（121 files / 1331 tests）

完了条件: TTS Job を失っても `job.list` で再発見できる。
全体置換の競合が検出できる。既存の操作契約は破壊しない。

## P3-1 入力契約の探索性（完了）

複雑な VisualTemplate（表・グラフ・フロー・効果・入れ子）の入力を、試行錯誤ではなく
公開された入力契約から組み立てられるようにする。`schema.get` の応答は増やさず、
必要な1件だけを `template.get` で取得する（全スキーマを同梱すると約20KBが約58KBになり、
MCP の二重出力でコストが増えるため）。

- [x] `VisualTemplateDefinition` に `exampleInput` を必須で追加し、全14テンプレートに
      保存時検証を通る例を置く
- [x] `template.get`（`{ id, version }`）を追加し、`inputSchema`
      （`toAgentJsonSchema` で導出）と `example` を返す
- [x] 未知の `id` / `version` は `RESOURCE_NOT_FOUND` とする
- [x] `schemaDigest` に `templateInputContracts` を含め、入力スキーマ・例の変更を
      検知できるようにする
- [x] ソケット統合テストで取得と `RESOURCE_NOT_FOUND` を固定する
- [x] スキルとユーザーガイドに、複雑な入力は `template.get` から組み立てる手順を追加する
- [x] `npm run typecheck` と `npm test` を通す

完了条件: `schema.get` → `template.get` → `script.edit` で、表・グラフ・フローの
入力を1回で組み立てられる。例は保存時検証を通り、`schema.get` の応答サイズは
ほぼ変わらない。

## P3-2 品質・診断（一部実装）

以下は MP4 の生成自体には不要。必要になった時点で個別に仕様化する。
視覚確認の契約・実測は [../visual-confirmation/spec.md](../visual-confirmation/spec.md) と
[../visual-confirmation/spike.md](../visual-confirmation/spike.md) を正とする。

- [x] 保存版プレビュー（`preview.scriptFrame`）
- [x] 素材画像の確認（`preview.assetFrame`）
- [ ] 下書きプレビュー（未保存 ContentDocument）
- [ ] 複数時刻の一括取得・コンタクトシート
- [ ] `health` / ワーカー状態 / キューの診断
- [ ] Composition 単体のプレビュー
- [ ] MCP の `structuredContent` と `content.text` の二重出力の見直し

## P4 制作履歴・復旧（完了）

[roadmap.md](./roadmap.md) の「制作履歴・復旧」を実装する。MP4主線は変えず、
反復制作・やり直し・タイムアウト回復をエージェントだけで完結させる。

- [x] `script.listVersions` を追加する。`languageEditionId` を受け、
      新しい順の版要約と `currentScriptVersionId` を返す
- [x] `ScriptVersionSummary` に `sourceScriptVersionId` を追加する
- [x] `script.restore` を追加する。復元元の ID だけを受け、サーバー側で内容を読む。
      `requestId` 必須の版単位冪等、任意の `baseScriptVersionId` ガード、
      復元元が current なら `VALIDATION_ERROR`
- [x] `work.clone` を追加する。元 Work の primary Edition の current 版から
      子 Work を作り、`parentWorkId` と `sourceScriptVersionId` を記録する。
      Agent 経由は `author: "agent"` / `authorAgentId` を記録する
- [x] `work.create` / `work.clone` のタイムアウト回復をガイド路線で固定する。
      `WorkSummary` に `createdAt` / `parentWorkId` を追加し、`work.list` で
      作成済みかを確認する手順をスキルとユーザーガイドに書く
- [x] Agent Access 仕様・HTTP API 契約・MP4制作仕様・roadmap・findings を更新する
- [x] 契約・サービス・ソケット統合テストを追加する
- [x] `npm run typecheck` と `npm test` を通す

完了条件: エージェントが版履歴を取得し、ContentDocument を再送せずに過去版を
復元できる。Work 複製が系統を記録し、Work 作成・複製のタイムアウト後に
`work.list` で二重作成を避けられる。

## P5 ライブラリ読み取りと声の割り当て（完了）

新規作品で声付きキャラクターが無くても、対象 locale の既存 Voice Profile を
声だけの話者へ割り当てて TTS できるようにする。ライブラリの管理は人専用のまま、
読み取りと既存 Profile の割り当てだけを開く。

- [x] `theme.list` / `theme.get` を追加する。アーカイブされていない利用者 Theme の
      最新公開 Revision と組み込み Theme だけを返し、Draft・アーカイブ済み・
      最新でない Revision・Font 診断は返さない
- [x] `faceSet.list` / `faceSet.get` を追加し、既存 `FaceSet` DTO を返す
- [x] `voiceProfile.list` / `voiceProfile.get` を追加し、既存 `VoiceProfile` DTO を返す
- [x] 一覧はページングせず、未知の ID は `RESOURCE_NOT_FOUND` とする
- [x] `speaker.add` / `speaker.setVoiceProfile` を操作コアへ追加し、`speaker`
      カテゴリを新設する。`line.add` / `line.setSpeaker` の `speakerId` を
      ID または `{ key }` で参照できるようにする
- [x] Profile の実在と `ContentDocument.locale` の完全一致、Character 付き話者の
      Character Voice 一致を検証する。参照欠落は `EDIT_TARGET_NOT_FOUND`、
      locale・Character Voice の不一致は `EDIT_PRECONDITION_FAILED`
- [x] `line.setSpeaker` の `expressionId` 自動消去と、`line.add` の明示的な
      `expressionId` 拒否を実装する
- [x] `document.setVisualTheme` を最新 Revision だけに制限し、`script.save` の
      Theme 変更検証と `script.restore` の参照保持を固定する
- [x] `ScriptContext` に `voiceProfiles` / `themes` の任意参照を追加する
- [x] 操作カタログ・カテゴリ enum・契約ダイジェストへ反映し、MCP / CLI が
      カタログから自動公開することを保つ。`AGENT_PROTOCOL_VERSION` は上げない
- [x] 契約・操作コア・ソケット統合テストで、声だけの話者の作成、`{ key }` 参照、
      locale 不一致、Character Voice 不一致、`expressionId` の挙動、Theme の
      最新 Revision 制限、`speaker.add` の replay が `created` を返さないことを固定する
- [x] スキルとユーザーガイドに `voiceProfile.list` → `speaker.add` → `line.add` の
      標準手順、既存話者への `speaker.setVoiceProfile`、立ち絵が必要な場合の
      `character.addFromLibrary`、Face Set / Theme の読み取り手順を追加する
- [x] Agent Access 仕様・MP4制作仕様・roadmap・findings・TTS 仕様・多言語声仕様・
      操作コア仕様を更新する
- [x] `npm run typecheck` と `npm test` を通す

完了条件: 新規作品で `voiceProfile.list` → `speaker.add` → `line.add`
（`speakerId: { key }`）→ 一括TTS → 確定 → レンダーまで通る。声付きキャラクターの
経路も維持され、Theme・Face Set・Voice Profile の管理は人専用のままである
（P5 時点。Voice Profile の作成・更新は P6 で公開した）。

## P6 Voice Profile の作成・更新公開（完了）

新規作品で対象 locale の Voice Profile が無い場合に、エージェントが
`voiceProfile.listVoices` で声候補を探して `voiceProfile.create` で作成し、
`speaker.add` で割り当てられるようにする。削除は人専用のまま残す。
詳細は [Agent Access の B11](../agent-access/todo.md) と
[ADR 0088](../adr/0088-agent-voice-profile-writes.md) を正とする。

- [x] MP4主線の声の確認（手順 4）と前提表を、`listVoices` → `create` の手順へ更新する
- [x] スキルとユーザーガイドの「Profile が無ければ人間に依頼する」を新手順へ置き換える
- [x] spec の P5 完了記録と roadmap のライブラリ管理表を B11 に合わせて更新する
- [x] `npm run typecheck` と `npm test` を通す

完了条件: 新規作品で `voiceProfile.listVoices` → `voiceProfile.create` →
`speaker.add` → `line.add` → 一括TTS → 確定 → レンダーまでエージェントだけで通る。

## P7 Character への声付け公開（完了）

既存 Character に対象 locale の声が無い場合に、エージェントが
`character.setVoices` で声を付けてから `character.addFromLibrary` でコピー
できるようにする。Character 自体の新規作成・外観変更・削除は人専用のまま残す。
詳細は [Agent Access の B12](../agent-access/todo.md) と
[ADR 0089](../adr/0089-agent-character-set-voices.md) を正とする。

- [x] MP4主線の声の確認（手順 4）と R2 を、`character.setVoices` の手順へ更新する
- [x] スキルとユーザーガイドの「声付きキャラクターの作成を依頼する」を「既存 Character への声付けはエージェントが行い、新規作成だけを依頼する」へ置き換える
- [x] spec の P6 完了記録と roadmap のライブラリ管理表を B12 に合わせて更新する
- [x] `npm run typecheck` と `npm test` を通す

完了条件: 声の無い既存 Character へ `character.setVoices` で声を付け、
`character.addFromLibrary` → TTS → 確定 → レンダーまでエージェントだけで通る。

## 将来（今回の非ゴール）

- サムネイルの作成・選択・PNG取得
- SRT 字幕のエクスポート
- YouTube 投稿設定・チャプター
- MP4 Artifact のダウンロード
- 版の削除・履歴圧縮、全 Edition の複製、Edition をまたぐ復元
- Theme / Face Set / Voice Profile の作成・更新・削除（管理）
- 縦型（9:16）の完成動画
- リモート/クラウド接続、アプリ自動起動

## 更新ルール

- P1 の完了条件を満たさないまま P2 に進まない。
- 契約を変更する場合は、先に `docs/agent-access/spec.md` と
  `docs/mvp/api-contract.md` を更新し、`operationDigest` の変化を確認する。
  Agent専用の追加は `docs/agent-access/spec.md`、HTTP共通の意味変更は
  `docs/mvp/api-contract.md` / `docs/mvp/spec.md` を正とする。
- ユーザー向けの振る舞いが変わったら `user-guide/docs/` を同じ変更で更新する。
- 実装後は `npm run typecheck` と `npm test` を通す。
