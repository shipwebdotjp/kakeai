# エージェントMP4制作 TODO

[spec.md](./spec.md) を正とする。上から順に進める。P1 の完了で
「人間プリフライト済みの環境で MP4 を出せる」状態を作り、P2 は運用の
取りこぼしを減らす改善、P3 は将来項目として [roadmap.md](./roadmap.md) へ送る。

## P0 現状の再現と固定（コード変更なし）

- [ ] en-US の `work.create` 直後に `script.edit` が
      `VALIDATION_ERROR`（`content.locale`）になることをテストで再現する
- [ ] 声付きキャラクターが無い新規 Works で `tts.createBulk` が
      `excluded` / `TTS_INPUT_INVALID` を返すことをテストで再現する
- [ ] 声付きキャラクターを `character.addFromLibrary` でコピーし、
      `line.setSpeaker` → `tts.createBulk(requestId)` → `tts.attachBulk`
      → `render.start` → `succeeded` の主線をテストで通す
- [ ] `tts.createBulk` / `tts.attachBulk` の `pending` → `finalized` と、
      同じ `requestId` 再送で Job が増えないことを確認する
- [ ] `render.start` の同じ `requestId` 再送で Job が増えないことを確認する
- [ ] 単一ワーカーが素材取り込み・TTS・レンダーを `createdAt` 昇順で
      処理することを確認する

完了条件: 現状の停止点と成功経路が、コード推測ではなくテストで示せる。

## P1 MP4主線のブロッカー修正

- [ ] `createInitialContentDocument` を locale 引数対応にし、
      `work.create` が指定 locale の初期台本を作るようにする
- [ ] en-US の `work.create` → `script.edit` の回帰テストを追加する
- [ ] `skills/kakeai-production/SKILL.md` に MP4主線の前提を追加する
      - `character.list` で対象 locale の声を確認する
      - 無ければ TTS を開始せず人間にキャラクター作成を依頼する
      - 標準は `character.addFromLibrary` によるコピー
      - MP4の合格ラインは「render Job 成功 + MP4 Artifact 存在」で、
        最終確認・サムネ・SRT・YouTube は人間
      - `tts.createBulk` の `requestId` 必須、`attachBulk` までの台本保存禁止、
        同じ `agentId` で確定
      - `preview.frame` は必須にしない
- [ ] `user-guide/docs/agent-access.md` に同じ前提と合格ラインを追加する
- [ ] 声が無い場合の停止手順を、スキルのチェックリストに固定する
- [ ] ja-JP の主線（声付きキャラクター → 一括TTS → 確定 → レンダー）を
      統合テストで固定する
- [ ] `npm run typecheck` と `npm test` を通す

完了条件: 人間プリフライト済みの ja-JP 新規作品で、エージェントが
`work.create` から `render` 成功まで通せる。en-US の初期台本が直っている。
声が無い場合は TTS 前に停止する手順がスキルとガイドに明記されている。

## P2 復旧力の改善（MP4主線の必須条件ではない）

P1 完了時点で MP4 は出せる。P2 は、エージェントが手順を飛ばした場合や
タイムアウトした場合の回復力を上げる。契約変更を伴うため、着手時に
`operationDigest` の変化と後方互換を確認する。

- [ ] `job.list` を `kind`（`render` / `tts` / `asset_ingest`）で絞れるようにする。
      TTS Job を失った場合の回復手段を用意する
- [ ] `script.save` に任意の `baseScriptVersionId`（または同等の
      基準版ガード）を追加し、全体置換の上書きを防ぐ
- [ ] `work.create` の再送で Work が重複しないよう、任意の `requestId` を
      付けるか、`work.list` での確認手順をガイドに固定する
- [ ] `script.save` に `sourceScriptVersionId` を追加し、復元・翻訳の系統を
      エージェントからも記録できるようにする
- [ ] `AGENT_REQUEST_TIMEOUT` 後の回復手順を、操作ごとの表に整理する
- [ ] `npm run typecheck` と `npm test` を通す

完了条件: TTS Job を失っても `job.list` で再発見できる。
全体置換の競合が検出できる。既存の操作契約は破壊しない。

## P3 品質・診断（将来）

以下は MP4 の生成自体には不要。必要になった時点で個別に仕様化する。
詳細は [roadmap.md](./roadmap.md)。

- [ ] `schema.get` にテンプレート入力の JSON Schema または例を追加する
- [ ] 下書きプレビュー / 保存版プレビューのエージェント操作
- [ ] 素材画像の確認（`assets/:id/frame` 相当）
- [ ] `health` / ワーカー状態 / キューの診断
- [ ] Composition 単体のプレビュー
- [ ] MCP の `structuredContent` と `content.text` の二重出力の見直し

## 将来（今回の非ゴール）

- サムネイルの作成・選択・PNG取得
- SRT 字幕のエクスポート
- YouTube 投稿設定・チャプター
- MP4 Artifact のダウンロード
- 版履歴・復元・Work 複製
- Theme / Face Set / Voice Profile の管理
- 縦型（9:16）の完成動画
- リモート/クラウド接続、アプリ自動起動

## 更新ルール

- P1 の完了条件を満たさないまま P2 に進まない。
- 契約を変更する場合は、先に `docs/agent-access/spec.md` と
  `docs/mvp/api-contract.md` を更新し、`operationDigest` の変化を確認する。
- ユーザー向けの振る舞いが変わったら `user-guide/docs/` を同じ変更で更新する。
- 実装後は `npm run typecheck` と `npm test` を通す。
