# 章立て台本の一括インポート 実装フェーズ

- [x] `docs/script-import/spec.md` と `todo.md` を新設し、書式・エラー・反映規則・非ゴールを正本として記載する。
- [x] `apps/web/src/content/scriptImport.ts` に、副作用を持たない解析・反映ロジックを置く。
  - [x] 生テキストから章・セリフ・検出話者名・行番号付き診断を生成する。
  - [x] 話者名ごとの対応表を適用し、`SceneFormValue` と `LineFormValue` を生成する。
  - [x] 既存の `createPointSceneFormValue`・`createEmptyLine`・ID生成を再利用する。
- [x] `apps/web/src/content/scriptImport.test.ts` で解析・反映ロジックを検証する。
- [x] `ScriptImportModal` を追加し、`SceneEditor` の要点シーン操作付近から開く。
- [x] 確定時に `react-hook-form` の `scenes` を一括更新する（未保存フォームのみ）。
- [x] ユーザーガイドの「台本の編集」とTTS説明を更新する。
- [x] `npm run typecheck`・`npm test`・OCRレビューを実施する。
