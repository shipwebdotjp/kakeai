# チャットテンプレート 実装TODO

正は [spec.md](spec.md)。実装の判断はこのフォルダの文書に従う。

## Phase 1 — 基盤とテンプレート

- [x] `.kakeai-cuebody` を `container-type: size` にし、任意の Cue が `cq` 単位を使えるようにする
- [x] `packages/contracts` に `chat.thread@1` の入力スキーマ（`chatThreadInputSchema`・`chatMessageSchema`・`chatMessagesSchema`）を追加
- [x] `messages` TemplateFieldSpec を追加し、`collectAssetRefs` でアイコン素材を収集
- [x] `packages/video` に `renderChatThread` を追加し、neutral Visual Skin に登録
- [x] チャット用CSSを追加（コンテナ相対・固定pxなし・内蔵flex）
- [x] `computeContentWarnings` にチャット本文の目安超過警告を追加

## Phase 2 — 編集UI

- [x] `MessagesField` を追加（名前・本文・左右・時刻・アイコン）
- [x] `form.ts` の読み取り・書き込み・既定値に `messages` を追加
- [x] `CueList` のフィールド分岐に `messages` を追加

## Phase 3 — 枠とステータスバー

- [x] `frame: phone | laptop | none` を実装（コンテナ相対で共通レイアウト）
- [x] `phone` のステータスバー（時刻・ダイナミックアイランド・Wi‑Fi・バッテリー、静的）を実装
- [x] `statusBar` / `statusTime` 入力を追加

## Phase 4 — テストと文書

- [x] contracts の登録・入力検証・素材参照のテスト
- [x] video のレンダリング（枠・ステータスバー・アイコン scope・エスケープ）のテスト
- [x] 機能ドキュメント（`spec.md`・`todo.md`・`roadmap.md`）と ADR-0070
- [x] `CONTEXT.md` の用語追加、`docs/mvp/content-schema.md` のテンプレート表更新
- [x] ユーザーガイドの追記

## Phase 5 — メッセージ単位のセリフ同期

- [x] `chatEffectsSchema`（`target: message | messages`、`trigger`、`effect`）と入力検証（対象番号の範囲）
- [x] `collectLineRefs` で `effects[].trigger` の行参照を収集
- [x] 描画: 行／吹き出しの要素ID割り当て、`appear`／`emphasize`／`spotlight`／`onset` の計画
- [x] `EffectsField` に `chat` variant とメッセージ本文のドロップダウンを追加
- [x] `form.ts` の `effects` schema／既定値に `chat` を追加
- [x] テスト（契約・描画・行削除でメッセージが残る回帰）
- [x] `spec.md` の入力契約・非ゴール・受け入れ条件を更新

## Phase 6 — デスクトップ枠

- [x] `chatFrameSchema` と選択肢に `desktop` を加算（既存 `frame` の描画は不変）
- [x] `desktop` パネル（21:9・薄いベゼル・小さめの角丸）のCSSを追加
- [x] 契約・描画テストに `desktop` を追加
- [x] `spec.md`・ユーザーガイドを更新

## Phase 7 — 端末クロームの共通化

- [x] ステータスバーとキーボードベースを `device-chrome` に切り出し、`chat.thread@1` と `scene.device-frame@1` で共有
- [x] `scene.device-frame@1` に `statusBar?`（phone）・`keyboard?`（laptop）を追加（既定オン・ADR-0071）
- [x] `chat.thread@1` に `keyboard?`（laptop）を追加（既定オン）
- [x] ステータスバー/キーボードのCSSをコンテナ相対（`--kakeai-status-u`）へ統一
- [x] 契約・描画テスト、`spec.md`・`composite-visuals/spec.md`・`content-schema.md`・ユーザーガイドを更新

## Phase 8 — 字幕セーフエリアと入力ドック

- [x] コンパイラがテーマの字幕トークンから `--kakeai-caption-safe` を導出し、`#kakeai-root` に出力する（既定 216px・2行）
- [x] `.kakeai-caption` の下端72pxを `--kakeai-caption-offset` に置き換える
- [x] `phone`・`desktop` のチャットを字幕セーフエリアの上に収める
- [x] `phone` に静的な入力ドック（空の入力欄・送信アイコン）を追加し、メッセージ列をその上で止める
- [x] 字幕セーフエリアの導出と、ドックの有無・非フォーム要素をテストする
- [x] `spec.md`・`roadmap.md`・`CONTEXT.md`・`content-schema.md`・ユーザーガイドと ADR-0093 を更新

## 未着手（roadmap 参照）

- [ ] Cue Map の代表画像へのアイコン反映
