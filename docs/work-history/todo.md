# 作業計画: 作品複製と台本版の復元・削除

- [x] 仕様書およびAPI契約の更新
- [x] `packages/contracts` に `cloneWorkRequestSchema` の `sourceEditionId` と一括削除リクエストを追加
- [x] バックエンド API: `POST /works/:workId/clone` の `sourceEditionId` 対応
- [x] バックエンド API: `DELETE /language-editions/:editionId`
- [x] バックエンド API: `POST /language-editions/:editionId/script-versions/bulk-delete`
- [x] Web API hooks (`useCloneWork`, `useDeleteLanguageEdition`, `useDeleteScriptVersions`)
- [x] Web UI: 作品行とEdition行、Edition単位の複製・履歴・復元・削除
- [x] 編集URLへEdition IDを含める
- [x] テストの追加と実行
  - contracts テスト
  - API / service テスト (clone, edition delete, bulk version delete)
  - `npm run typecheck` & `npm test`
- [ ] `ocr review` の実施と指摘事項の修正
