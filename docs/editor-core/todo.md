# 台本編集操作コア 実装TODO

[台本編集操作コア仕様](./spec.md) を正とする。上から順に進める。Agent Access は E1〜E5 の完了を前提にする（[../agent-access/todo.md](../agent-access/todo.md)）。

## フェーズ

### [x] E1 契約とパッケージ

- [x] `packages/script-edits` を作り、`ScriptContext`・`ScriptOperation`・`ScriptOperationResult`・エラーコードを定義する
- [x] 各操作の Zod スキーマと型を `packages/contracts` に置き、`op` の判別 union にする
- [x] ID 生成器と `key` 参照の解決をテスト可能な形にする
- 完了条件: 型検査が通り、未対応操作と未解決 `key` が安定したコードで失敗する。

### [x] E2 Scene 操作

- [x] `scene.add`（point / insert）、`scene.remove`、`scene.move`、`scene.setLabel`、`scene.setAccent`
- [x] `scene.setTiming` と `scene.setTransition`（尺の等式・遷移上限）
- [x] `scene.splitAtLine`（Cue の分割・複製、効果トリガーの剪定、解決済みミリ秒）
- 完了条件: UI の既存 Scene 操作と同じ結果を返し、導入・結びの順序と insert の主動画が保存検証を通る。

### [x] E3 行操作

- [x] `line.add`、`line.remove`、`line.move`、`line.setText`、`line.setSpeaker`、`line.setExpression`、`line.setGap`
- [x] `line.assignTake`、`line.selectTake`、`line.removeTake`
- [x] `line.split`（ID の維持、Audio Take の破棄、Cue 範囲とトリガーの付け替え）
- 完了条件: 行の削除・移動・分割の後も、すべての `range: lines`、効果トリガー、`videoPlayback.gates` が実在行を指す。

### [x] E4 Cue・音声・文書操作

- [x] `cue.add`、`cue.remove`、`cue.setRange`、`cue.setInput`、`cue.setPlacement`、`cue.setTransition`
- [x] `standing.set` / `standing.remove`（左右 1 体ずつの内部 Cue 生成）
- [x] `audio.add`、`audio.set`、`audio.remove`
- [x] `document.setVisualTheme`
- [x] 未知の VisualTemplate と UI が解釈しない Cue を保持する
- 完了条件: 代表的なテンプレート（text / media / composition / device-frame / data 系）で、追加・範囲変更・入力更新が保存検証を通る。

### [x] E5 保存検証との統合

- [x] 操作コアの出力を既存の保存検証へ通すサービス経路を作る（HTTP には新しい編集エンドポイントを公開しない）
- [x] 全操作の代表例で「操作結果が保存検証を通る」テストを追加する
- [x] 警告（テキスト量・offset 範囲）が保存時と同じ形で返ることを確認する
- 完了条件: 操作コア経由で作った文書が、既存の全体保存と同じ検証を通る。

### [ ] E6 UI の構造操作移行

- [x] `apps/web` から `@kakeai/video/timeline` を参照し、プレビュー応答に依存せず分割点を解決する
- [x] Scene の追加・削除・移動・分割、行の追加・削除・移動を操作コア経由にする
- [x] Cue の削除を操作コア経由にする（未確定Cueはフォームから削除）
- [ ] Cue の追加・範囲変更を操作コア経由にする
- [x] 入力途中の不正値（未確定Cue）が構造操作を妨げないようにする
- [x] 移行中は旧フォーム経路との一致テストを置き、移行後に削除する
- 完了条件: 編集画面の構造操作が操作コアだけを通り、結果が既存 UI と同じ見た目・同じ保存結果になる。

### [ ] E7 UI のフィールド編集移行

- [x] `captionText`・`speechText`・`speakerId`・`expressionId`・`gapBeforeMs` を型付き操作へ移す
- [ ] Cue 入力と立ち絵・音声設定を操作へ移す
- [ ] `form.ts` から文書変更のロジックを除き、入力アダプタと表示に縮小する
- 完了条件: UI が文書を直接変更せず、操作コア経由でのみ編集する。重複した編集意味論が残っていない。

### [ ] E8 文書と後始末

- [x] `docs/editor/spec.md` と `CONTEXT.md` を操作コアに合わせて更新する
- [x] `docs/mvp/api-contract.md` の台本保存に、編集意味論が操作コア側にあることを追記する
- [ ] `npm run typecheck` と `npm test` を通す
- [ ] OCR レビュー（最大3回）と妥当な指摘の修正
