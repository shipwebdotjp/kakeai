# セリフ操作・シーン分割・Cueのセリフ選択 実装フェーズ

- [x] `docs/line-editing/spec.md` と `todo.md` を追加する。
- [x] `docs/editor/spec.md` にセリフ順序・分割・Cue範囲の編集規則を追記する。
- [x] `apps/web/src/content/form.ts` に副作用のない変換関数を追加する。
  - [x] `moveLineInScene`（並べ替え＋Cue範囲の正規化）
  - [x] `normalizeLineRangeCues`（逆転したLine範囲の入れ替え）
  - [x] `splitPointScene`（分割点でSceneを2つへ）
  - [x] `duplicateLineFormValue`（Audio Takeを含めない複製）
  - [x] 表示ラベル（`lineSummary`・`lineOptionLabel`）と候補制約（`lineRangeEndCandidates`・`nextEndLineId`）
  - [x] `removeLineInScene`（削除時の端点繰り上げ、単一Line範囲のCue削除）と `countLineCueReferences`
- [x] セリフ削除時に、参照中のLine範囲Cueを確認のうえ端点を寄せ、潰れるCueを削除する。
- [x] `LinesEditor` に連番表示と `…` 操作メニューを追加する。
- [x] 分割操作を `SceneEditor` のコールバックへ委譲する。
- [x] `CueList` にセリフ表示ラベルと開始・終了の候補制約を追加する。
- [x] `apps/web/src/content/lineEditing.test.ts` で契約・振る舞いを検証する。
- [x] ユーザーガイドにセリフ操作メニュー・分割・Cue区間の選び方を追記する。
- [x] `npm run typecheck`・`npm test`・OCRレビューを実施する。
