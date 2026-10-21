# セリフ操作・シーン分割・Cueのセリフ選択 実装フェーズ

- [x] `docs/line-editing/spec.md` と `todo.md` を追加する。
- [x] `docs/editor/spec.md` にセリフ順序・分割・Cue範囲の編集規則を追記する。
- [x] 行の移動・削除・分割・複製を実装する。
  - [x] 編集意味論は [editor-core](../editor-core/spec.md) の操作コアへ移設し、UIは操作コアを呼ぶ。
  - [x] 表示ラベル（`lineSummary`・`lineOptionLabel`）と候補制約（`lineRangeEndCandidates`・`nextEndLineId`）、`countLineCueReferences` は表示用の分析として残す。
- [x] セリフ削除時に、参照中のLine範囲Cueを確認のうえ端点を寄せ、潰れるCueを削除する。
- [x] `LinesEditor` に連番表示と `…` 操作メニューを追加する。
- [x] 分割操作を `SceneEditor` のコールバックへ委譲する。
- [x] `CueList` にセリフ表示ラベルと開始・終了の候補制約を追加する。
- [x] `apps/web/src/content/lineEditing.test.ts` で契約・振る舞いを検証する。
- [x] ユーザーガイドにセリフ操作メニュー・分割・Cue区間の選び方を追記する。
- [x] `npm run typecheck`・`npm test`・OCRレビューを実施する。
