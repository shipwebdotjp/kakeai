# 素材タグ 実装TODO

[仕様](./spec.md) を正とする。上から順に進める。

## フェーズ

### [x] T1 契約とDB

- [x] `assetTagsSchema`・`updateAssetRequestSchema` と `Asset.tags` を `packages/contracts` に追加
- [x] Prisma `Asset.tagsJson` と migration、Prismaクライアント再生成
- 完了条件: 型検査が通り、タグ契約の境界テストが通る。

### [x] T2 API

- [x] `toAsset` に `tags` を追加（`tagsJson` をZodで復元、破損時は空配列）
- [x] `updateAssetTags` サービスと `PATCH /assets/:assetId`
- 完了条件: タグの往復と存在しない素材の404が成立する。

### [x] T3 Web UI

- [x] `useUpdateAssetTags` フック
- [x] 素材ライブラリ画面でのタグ編集（チップの追加・削除）とタグ絞り込み
- [x] 素材ピッカーでのタグ絞り込み（ファイル名検索と併用）
- 完了条件: 付与→絞り込み→ピッカー反映が成立する。

### [x] T4 文書・レビュー

- [x] spec/api-contract/ADR/CONTEXT/ユーザーガイドを更新
- [x] `npm run typecheck`、`npm test`、OCRレビュー
- 完了条件: 型検査・テスト・レビューが通る。
