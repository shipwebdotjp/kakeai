# 編集画面とテキストモデル再設計 実装TODO

仕様は [spec.md](./spec.md) を正とする。Phase 1（編集表現の拡張）の一部として、上から順に進める。E1・E2 は同一の `schemaVersion: 4` の破壊的変更にまとめる。開発段階のため移行コードは持たない（[ADR-0034](../adr/0034-destructive-changes-before-1-0.md)）。

## E1 テキストモデル統一

- [x] `text.title@1`・`text.body@1` を統合テキストテンプレート `text.block@1` に置き換える（`text`・`role`・`anchor`・`verticalAlign`・`font`・`fontSize`・`color`・`decoration`。`role` は `title`/`subtitle`/`heading`/`body`/`closing` のみで字幕は含めない）
- [x] `font` は**非同梱のシステムフォント**の有限enum（`sans`/`serif`/`mono`）とし、レンダー側で固定スタック名へマップする。`decoration` は真偽のみ。任意CSS/keyframe/easingを持ち込まない
- [x] Sceneから `slots` を撤去し、`kind`・`accentColor`・`timing`・`lines`・`visualCues` は維持する（[ADR-0035](../adr/0035-remove-scene-slots-unify-text-cues.md)）。テキストCueは既存の `overlay` 層を使い、コンパイラの固定「Scene本文」層（`kakeai-slotframe`）を廃止する
- [x] `schemaVersion` を `3` → `4` に上げ、v3の読出し・移行コードを持たない。**開発環境に残る v3 の保存版は削除する**
- [x] 新規作品の初期Sceneに、`role` 別の既定統合テキストCueを生成する
- [x] テキストの最大行数・最小フォントサイズの目安を `role` 別のテンプレート契約に移し、超過は `meta.warnings`（JSON Pointer は `scenes[i].visualCues[j].input.*`）で返す
- [x] 同期箇所: `packages/contracts`（`content/scene.ts`・`content/defaults.ts`・`content/warnings.ts`・`content/document.ts`・`templates/*`）、`packages/video`（`compiler.ts`・`templates/text-block.ts`）、`apps/web`（`content/form.ts`・`components/SceneEditor.tsx`・`components/CueList.tsx`）
- [x] ドキュメント同期: [../mvp/content-schema.md](../mvp/content-schema.md)（slots節・テンプレート表・schemaVersion）、[../mvp/spec.md](../mvp/spec.md)、ユーザーガイド
- 完了条件: スロットなしでタイトル・サブタイトル・見出し・本文・結びを統合テキストCueで編集・保存・プレビュー・レンダーでき、配置・フォント・サイズ・色・装飾がプレビューとMP4で一致する。

## E2 シーン間トランジション

- [x] 入場Scene側の `scene.transition.enter`（`preset`・`durationMs`）として追加する。先行Sceneはデータを持たない（[ADR-0036](../adr/0036-scene-transition-owned-by-entering-scene.md)）
- [x] カット／フェードイン・フェードアウト／クロスフェードを同じ機構で表し、既定はカット（尺0）。先頭Sceneの `enter` は無視する
- [x] 入場Sceneの最初 `D` ms で `opacity 0 → 1`、その間だけ先行Sceneのclipを `D` ms 延長保持する。**Scene尺の合計と総尺は不変**
- [x] 共通タイムライン解決器へ解決を寄せ、描画時導出の規則をテストで固定し、プレビューとレンダーで同一にする
- [x] `D <= min(先行Scene尺, 入場Scene尺)` を検証し、はみ出す入力を保存・レンダー前に `RENDER_INPUT_INVALID` として拒否する
- [x] 同期箇所: `packages/contracts`（`content/scene.ts`・`content/layers.ts`）、`packages/video`（`timeline.ts`・`compiler.ts`）、`apps/web`（`components/SceneEditor.tsx`）
- 完了条件: シーン間トランジションを設定して保存・プレビュー・レンダーでき、はみ出しが拒否され、総尺が変わらない。

## E3 編集レイアウト3ペイン化

- [x] `WorkEditPage` を左（静的ナビゲーション）／中央（編集）／右（プレビュー＋レンダー常時表示）の3ペインに再構成する
- [x] 左ペインに Scene・見出し・Cue・セリフの階層ツリーを作り、クリックで中央へジャンプ・右プレビューへシークする
- [x] 右ペインにPlayerとレンダー操作を常時表示し、左・中央の操作で状態を保ったまま更新する
- [x] 単一カラム構成を廃止し、ペイン幅を調整可能にする
- 完了条件: 3ペインで編集・保存・プレビュー・レンダーが成立し、左ジャンプで中央とプレビューが該当位置へ移動する。

## E4 プレビュー再生コントロール

- [x] Sceneジャンプリンク（Scene名一覧→先頭へシーク）を追加する
- [x] コマ送り／コマ戻し（1フレーム）を追加する
- [x] 次／前のセリフ、次／前のSceneを追加する
- [x] ±x秒（プリセット切替可）を追加する
- [x] 再生／一時停止・時刻表示を追加する
- [x] previewレスポンスへ非永続の解決タイムライン（Scene区間・line区間・総尺）を追加し、Webのシーク基準にする（[../mvp/api-contract.md](../mvp/api-contract.md) のプレビュー節と [ADR-0023](../adr/0023-preview-composition-contract.md) を同期）
- [x] フレーム送りは出力fps（30）で1/30秒単位とする
- 完了条件: 保存済み台本でコマ送り・セリフ／Scene移動・±x秒が動き、正本が変わらず、previewレスポンスのタイムラインと総尺が一致する。

## E5 立ち絵の前Sceneコピー

- [ ] Scene編集に「前のSceneから立ち絵をコピー」ボタンを追加する
- [ ] 直前Sceneの `character.standing` 入力（`characterId`・`appearanceId`・`side`・倍率）を新Cue IDで複製する（既定は置き換え、追加も選択可）
- [ ] 前Scene不在・立ち絵Cue不在でボタンを無効化し、参照先が消えている場合は複製せず理由を表示する
- 完了条件: 1操作で前Sceneの立ち絵を複製でき、不存在時は複製されない。
