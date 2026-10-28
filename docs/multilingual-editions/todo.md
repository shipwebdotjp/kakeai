# 多言語Edition TODO

- [x] A. 文書・ADR: [spec.md](./spec.md)・[roadmap.md](./roadmap.md) 作成、ADR-0081（既存 Work への Edition 追加、Work 複製不採用）、ADR-0082（Edition 間同期を追跡しない）
- [x] B. R1 contracts: Edition 作成リクエストスキーマ（`locale`・`sourceEditionId`）。`script.save` の locale 一致は既存 `VALIDATION_ERROR` のため追加なし（[spec.md](./spec.md) に明記）
- [x] C. R1 api: `POST /works/:workId/language-editions`（シードコピー＋置き換え規則、409 `LANGUAGE_EDITION_EXISTS`）。マイグレーション不要（既存テーブルで構わない）
- [x] D. R1 web: `WorkEditPage` の `languageEditions[0]` 固定を解消した Edition 切替、Edition 追加 UI（`useCreateLanguageEdition`）
- [x] E. R1 video: `compiler.ts` と `table-format.ts`（+ `table-simple`・`stat`・`chart-bar`）の `Intl.NumberFormat("ja-JP")`・JPY 固定を document locale から導出（ja→JPY、それ以外→USD）
- [x] F. R1 完了: `npm run typecheck`、`npx vitest run --testTimeout=20000` を通す。既存 ja 作品の回帰（edition 作成・編集・レンダー）を確認
- [x] G. R2 agent-access: `edition.create` 操作の追加（MCP/CLI はカタログから自動反映）。[../agent-access/spec.md](../agent-access/spec.md) の操作一覧を更新。`script.save` の locale 不一致は既存 `VALIDATION_ERROR` のため新コードなし
- [x] H. R2 skills: `skills/kakeai-production/` に翻訳版の手順（`edition.create` → `script.get` 翻訳 → `script.save`）
- [x] I. R2 完了: `edition.create` のサービス境界テスト（シード置き換え・重複 409・他 Work シード拒否）、契約テスト、MCP/CLI カタログ反映の確認。TTS・レンダーの実機通しは利用環境での確認に委ねる（コード経路は既存のまま）
- [x] J. 完了後: [../mvp/roadmap.md](../mvp/roadmap.md) Phase 4 の該当箇所と、その完了状況を更新する
- [x] K. Edition単位の削除: `DELETE /language-editions/:editionId`、最後のEdition拒否、実行中Job拒否、作品全体削除との分離（[../work-history/spec.md](../work-history/spec.md)）
