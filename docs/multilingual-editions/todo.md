# 多言語Edition TODO

- [ ] A. 文書・ADR: [spec.md](./spec.md)・[roadmap.md](./roadmap.md) 作成、ADR-0081（既存 Work への Edition 追加、Work 複製不採用）、ADR-0082（Edition 間同期を追跡しない）
- [ ] B. R1 contracts: Edition 作成リクエストスキーマ（`locale`・`sourceEditionId`）。`script.save` の locale 一致検証は R2（G）で行う
- [ ] C. R1 api: `POST /works/:workId/language-editions`（シードコピー＋置き換え規則、locale 重複 409）。マイグレーション不要（既存テーブルで構わない）
- [ ] D. R1 web: `WorkEditPage` の `languageEditions[0]` 固定を解消した Edition 切替、Edition 追加 UI
- [ ] E. R1 video: `compiler.ts` と `table-format.ts` の `Intl.NumberFormat("ja-JP")`・JPY 固定を document locale から導出
- [ ] F. R1 完了: `npm run db:generate --workspace @kakeai/api`、`npx vitest run --testTimeout=20000`。既存 ja 作品の回帰（edition 作成・編集・レンダー）を確認
- [ ] G. R2 agent-access: `edition.create` 操作、`script.save` に `EDITION_LOCALE_MISMATCH` 検証。[../agent-access/spec.md](../agent-access/spec.md) の操作一覧・エラー表を更新
- [ ] H. R2 skills: `skills/kakeai-production/` に翻訳版の手順
- [ ] I. R2 完了: MCP/CLI での `edition.create` → 翻訳 `script.save` → current 進行 → TTS → レンダーの通し確認
- [ ] J. 完了後: [../mvp/roadmap.md](../mvp/roadmap.md) Phase 4 の該当箇所と、その完了状況を更新する
