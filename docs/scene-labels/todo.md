# Scene Label 実装フェーズ

- [x] `docs/scene-labels/spec.md` と `todo.md` を追加する。
- [x] `CONTEXT.md` のScene定義に Scene Label を加える。
- [x] contracts: `Scene.label` を追加する（`schemaVersion: 1` の基準契約に含まれる）。
- [x] contracts: 初期生成を導入 / 要点 1 / 結び の3 Sceneにする。要点2・3の既定IDと色を削除する。
- [x] contracts: v4→v5 の読み出し移行（従来表示名の補完）を追加する。
- [x] web: `SceneFormValue`・`toFormValues`・`buildContentDocument` に `label` を通す。
- [x] web: 追加・複製・分割で位置に応じた初期ラベルを付ける（複製元のラベルはコピーしない）。
- [x] web: Scene見出しのラベル入力欄、左ナビ、プレビューのSceneジャンプを `label` 表示へ変更する。
- [x] web: 台本インポートの章タイトルを `heading` Cueでなく `label` に設定する。
- [x] 既存の正本を同期する（content-schema / mvp spec / editor spec / script-import spec / ユーザーガイド）。
- [x] テスト（labelの必須・空白拒否・重複許可、初期3 Scene、往復、追加/複製/分割、章タイトル→label、heading Cue未設定、v4→v5移行）を更新する。
- [x] `npm run typecheck`・`npm test`・OCRレビューを実施する。
