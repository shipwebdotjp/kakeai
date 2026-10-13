# 作業計画: 作品複製と台本版の復元

- [ ] 仕様書およびAPI契約の更新
- [ ] `packages/contracts` に `cloneWorkRequestSchema` を追加
- [ ] バックエンド API: `POST /works/:workId/clone` およびサービス層 `cloneWork` の実装
- [ ] Web API hooks (`useCloneWork`, `useScriptVersions`, `useScriptVersion` 等) の追加
- [ ] Web UI: 作品一覧の「操作」メニュー（複製 modal, 履歴・復元 modal, 削除）の実装
- [ ] テストの追加と実行
  - contracts テスト
  - API / service テスト (cloneWork, constraint, restore)
  - `npm run typecheck` & `npm test`
- [ ] `ocr review` の実施と指摘事項の修正
