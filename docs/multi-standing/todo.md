# 複数立ち絵 実装TODO

[仕様](./spec.md) を正とする。上から順に進める。

## フェーズ

### [x] M1 契約と描画

- [x] `character.standing@2`（`side`、`scale`）を追加し、`@1` は不変のまま残す
- [x] `contentDocumentSchema` の立ち絵参照検証を `@1`/`@2` 両対応にする
- [x] コンパイラに `@2` の描画（`side`→正規化座標、バウンド用ラッパー）を追加する
- [x] 話者→キャラクター対応からScene内の発話区間を求め、該当する `@2` 立ち絵だけをバウンドさせる
- 完了条件: `@2` の立ち絵が左右に描画され、発話中の立ち絵だけが弾み、`@1` は従来どおり描画される。

### [x] M2 編集UI

- [x] フォーム値を `standings: StandingFormValue[]`（`cueId`/`characterId`/`appearanceId`/`side`/`scale`）にする
- [x] `@1` を取り込み時に `side` へ正規化し、保存は `@2` を書き出す。UI範囲外のCueは非破壊で保持する
- [x] 左枠・右枠の2スロットUI（キャラクター・外観・倍率・解除、最大2体、`side` 重複不可）
- [x] キャラクター削除・外観削除時に立ち絵の選択を解除する
- 完了条件: 左右に立ち絵を選んで保存、プレビュー、レンダーできる。

### [x] M3 テストと文書

- [x] `packages/contracts` / `packages/video` / `apps/web` のテストを追加・更新する
- [x] `docs/mvp/content-schema.md`、`docs/mvp/todo.md`、ADR、ユーザーガイドを更新する
- 完了条件: `npm run typecheck` と `npm test` が通り、文書が実装と一致する。
