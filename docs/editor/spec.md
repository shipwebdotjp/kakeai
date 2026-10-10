# 編集画面とテキストモデル再設計 仕様

## 目的と境界

この文書は、ロードマップ Phase 1（編集表現の拡張）の一部として、編集画面の構成とテキスト表現のモデルを再設計する。対象は次の5つ。

1. Sceneスロットの廃止とテキストのVisualCue統一（統合テキストテンプレート）。
2. 編集画面の3ペイン化とジャンプメニュー。
3. プレビューの再生コントロールとScene・セリフ間ナビゲーション。
4. シーン間トランジション（カット／フェード／クロスフェード）。
5. 立ち絵設定の前Sceneからのワンクリック複製。

決定は [ADR-0034](../adr/0034-destructive-changes-before-1-0.md)（開発段階の破壊的変更）、[ADR-0035](../adr/0035-remove-scene-slots-unify-text-cues.md)（スロット廃止・Cue統一）、[ADR-0036](../adr/0036-scene-transition-owned-by-entering-scene.md)（シーン間トランジション）、[ADR-0037](../adr/0037-unified-text-template-input-contract.md)（統合テキストテンプレートの入力契約）を参照する。台本契約は [../mvp/content-schema.md](../mvp/content-schema.md)、複合ビジュアル基盤は [../composite-visuals/spec.md](../composite-visuals/spec.md) を正とする。

非ゴール：字幕タイミングの自由編集、任意CSS/keyframeの入力、複数ユーザー・共同編集。これらは従来どおり対象外。

## テキストモデル

### スロット廃止とCue統一

`intro`/`point`/`outro` Scene は `slots` を持たない。タイトル・サブタイトル・見出し・本文・結びは、統合テキストテンプレートを既存の `overlay` 層の VisualCue として配置して表現する（既存 `text.title@1`/`text.body@1` も `overlay` を使うため、層のenumは変更しない）。コンパイラの固定「Scene本文」層（`kakeai-slotframe`）は廃止する。`kind` は残し、導入→要点→結びの並び順と新規作品の既定生成に使う。

Scene の `accentColor`、`timing`、`lines`、`visualCues` は維持する。字幕は従来どおり `lines.captionText` をコンパイラ固定層で描画し、テキストCueとは独立に保つ。

### 統合テキストテンプレート

`text.*@1` を `text.block@1` の1種に統合する（`text.title@1`・`text.body@1` を置き換える）。入力は次に閉じる。

```jsonc
{
  "template": { "id": "text.block", "version": 1 },
  "input": {
    "text": "見出しと本文\n本文",         // 必須。複数行。改行を保持
    "role": "heading",                   // title | subtitle | heading | body | closing
    "anchor": "center",                  // 左右: left | center | right
    "verticalAlign": "middle",           // 上下: top | middle | bottom
    "font": "sans",                      // 非同梱システムフォント: sans | serif | mono
    "fontSize": 40,                      // 1080p基準の px（整数）
    "color": "#FFFFFF",                  // #RRGGBB（大文字正規化）
    "decoration": { "bold": false, "italic": false, "outline": true, "shadow": true }
  }
}
```

- `role` は意味付け（翻訳・既定生成・role別の既定スタイルと警告上限の導出）に使う。字幕は `lines.captionText` のままとし、`role` には含めない。
- `font` は**非同梱のシステムフォント**の有限enum（`sans`/`serif`/`mono`）とし、レンダー側で固定のフォントスタック名へマップする。Webフォントの同梱と任意のフォント名・CSSは持ち込まない。
- `fontSize` は1080p基準の px とする。9:16など別解像度は将来の版で扱う。
- `decoration` は真偽のみ。任意CSS・keyframe・easingは受け付けない（[ADR-0031](../adr/0031-cue-transition-and-animation-ownership.md) の方針）。
- 入力のZodスキーマは版ごとに固定する（[ADR-0034](../adr/0034-destructive-changes-before-1-0.md) により開発段階では書き換え可）。
- 最大行数・最小フォントサイズの目安は、`role` ごとに本テンプレートの契約として持つ。超過は保存を拒否せず `meta.warnings` で返す（[ADR-0014](../adr/0014-text-overflow-warning-not-rejection.md)）。警告のJSON Pointerは `scenes[i].visualCues[j].input.*` を指す。

### 既定生成

新規作品は、導入1・要点3・結び1のSceneに対し、`role` に応じた既定の統合テキストCueを空テキスト（`text: ""`）で生成する。利用者がCue一覧で入力する。新規に追加した要点Sceneにも同様に既定Cueを生成する。

## 編集レイアウト（3ペイン）

編集画面（`WorkEditPage`）を次の3ペインに再構成する。

- **左ペイン（静的ナビゲーション）**：Scene・見出し・Cue・セリフの階層ツリー。項目をクリックすると中央ペインの該当位置へジャンプし、右ペインのプレビューを該当区間へシークする。編集内容に応じて構造だけを再生成し、静的メニューとして保つ。
- **中央ペイン（編集）**：Scene編集・セリフ・Cue一覧・テキストテンプレート入力。従来のフォーム編集をここに集約する。
- **右ペイン（プレビューとレンダー・常時表示）**：保存済み台本のHyperFrames Playerと、レンダー開始・履歴を常時表示する。左・中央の操作で状態を保ったまま更新する。

各ペインはレスポンシブに幅を調整できる。既存の単一カラム構成は廃止する。

## プレビュー再生コントロール

右ペインのPlayerに、次を追加する。すべて保存済み台本（プレビュー派生データ）に対する表示操作であり、正本を変更しない。

- Scene ジャンプリンク（Scene名の一覧。クリックで該当Scene先頭へシーク）。
- コマ送り／コマ戻し（1フレーム単位）。
- 次／前のセリフ（`NarrationSegment` 単位）。
- 次／前の Scene。
- ±x秒（既定 x は可変。例: 1s/5s のプリセット）。
- 再生／一時停止、時刻表示。

解決済みのScene尺・字幕区間（`timing` の算出結果）をシーク位置の基準にする。算出ロジックをUIに二重実装しないよう、**previewレスポンスへ非永続の解決タイムライン（Scene区間・line区間・総尺）を追加**し、Webはそれを基準にシークする。これは [ADR-0023](../adr/0023-preview-composition-contract.md) のプレビュー契約の拡張であり、`docs/mvp/api-contract.md` のプレビュー節と同期する。フレーム送りは出力fps（30）を用いる。

## シーン間トランジション

Scene の境界に、カット／フェードイン・フェードアウト／クロスフェードを設定できるようにする。Cueの入退場（[ADR-0031](../adr/0031-cue-transition-and-animation-ownership.md)）とは責務を分け、シーン全体の境界演出として持つ。[ADR-0036](../adr/0036-scene-transition-owned-by-entering-scene.md) に従い次で確定する。

- **所有**：入場するScene側が `scene.transition.enter`（`preset`・`durationMs`）を持つ。先行Sceneはデータを持たない。
- **総尺不変**：Scene尺の合計と総尺は変えない。入場Sceneの最初 `D` ms で入場要素を `opacity 0 → 1` とし、その間、先行Sceneのclipを `D` ms 延長して保持してクロスフェードを成立させる。フェードアウト／フェードイン（間に背景色を挟む）も同じ機構で表す。
- **既定**：カット（尺0）。先頭Sceneの `enter` は無視する。
- **検証**：共通タイムライン解決器で `D <= min(先行Scene尺, 入場Scene尺)` を検証し、はみ出す入力を保存・レンダー投入前に拒否する（`RENDER_INPUT_INVALID`）。
- **実装**：先行Sceneのclip延長は描画時導出であり正本JSONに表れない。導出規則を解決器に一元化し、プレビューとレンダーで同一にする。

本仕様確定に合わせて `schemaVersion` を `4` に上げる（[ADR-0035](../adr/0035-remove-scene-slots-unify-text-cues.md) と同一の破壊的変更にまとめる）。開発環境に残る v3 の保存版は削除し、移行関数は持たない（[ADR-0034](../adr/0034-destructive-changes-before-1-0.md)）。

## 立ち絵の前Sceneコピー

Scene編集に「前のSceneから立ち絵をコピー」ボタンを置く。直前Sceneの立ち絵Cue（`character.standing`）の入力（`characterId`・`appearanceId`・`side`・倍率）を現在Sceneへ複製する。

- 複製時は新しいCue IDを発行し、既存の立ち絵Cueを置き換えるか追加するかをUIで選ばせる（既定は置き換え）。
- 複製内容は素材の再選択を要求しない。`characterId`/`appearanceId` が現存しない場合は複製せず、理由を表示する。
- 前Sceneが存在しない、または立ち絵Cueを持たない場合はボタンを無効化する。

## 受け入れ条件

- Sceneスロットが廃止され、タイトル・サブタイトル・見出し・本文・結びを統合テキストCueで編集・保存・プレビュー・レンダーできる。
- 統合テキストの配置（左右／上下）・フォント・サイズ・色・装飾が保存され、プレビューとMP4で一致する。
- 編集画面が3ペインで動作し、左のジャンプで中央とプレビューが該当位置へ移動する。
- プレビューのコマ送り・セリフ／Scene移動・±x秒が保存済み台本で動く。正本は変わらない。previewレスポンスの解決タイムラインを基準にする。
- シーン間トランジション（カット／フェード／クロスフェード）が保存され、プレビューとMP4で一致し、隣接尺をはみ出さず、総尺が変わらない。
- 前Sceneからの立ち絵コピーが1操作ででき、不存在の立ち絵は複製されない。

## 非ゴール

- 字幕タイミングの自由編集、任意CSS/keyframe/easingの入力。
- スロット互換の読み出し・移行（開発段階のため作り直し前提）。
- 共同編集・複数ユーザー・承認ワークフロー。
