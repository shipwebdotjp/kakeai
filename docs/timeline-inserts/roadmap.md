# セリフ間・Scene音声・インサートScene ロードマップ

[spec.md](./spec.md) と [todo.md](./todo.md) の R1〜R3 は実装済みで、受け入れ条件を満たす。この文書は「今回あえて実装しなかったもの」と「今後の拡張候補」を、着手しやすい順にまとめる。判断が変わったら [spec.md](./spec.md) と本ロードマップを更新し、後戻りコストが大きいものは ADR にする。

## 現状の完了範囲

- R1: `NarrationSegment.gapBeforeMs`（セリフ直前の無音区間）。auto/fixed 両方で予約し、プレビュー・レンダー・セリフジャンプが本体と混同しない。
- R2: Scene範囲 `AudioCue`（`bgm` / `sfx` / `program`）の編集・保存・プレビュー・レンダー。
- R3: `insert` Scene。主動画Cueの動画を映像と埋め込み音声ごと再生し、作品全体BGMを200msフェード付きで抑制。`Asset.hasAudio` を永続化。ADR-0067 / 0068。

## 意図的に見送った項目

以下は [spec.md](./spec.md) の「非目標」および実装上の割り切りで、今回の受け入れ条件には含めていない。

### インサートScene

- 動画のトリム・ループ・速度変更・逆再生（spec: 非目標）。初期版は動画全体をそのまま再生する。
  - 契約・APIは主動画Cueの `input.loop` を拒否済み（`packages/contracts/src/content/document.ts` の insert 検証）。
- 複数動画をつなぐインサート（spec: 非目標）。1 insert = 1 動画。
- インサートScene中のセリフ・字幕・立ち絵（spec: 非目標）。契約で `lines` 空・立ち絵Cue禁止を強制。
- 主動画Cue以外のVisualCue（overlayテキスト等）。契約は「主動画Cue 1件のみ」を要求。
- insert Sceneの既定 `transition` は `cut` 固定。fade/crossfade はUIの通常操作で設定できるが、専用の既定は持たない。
- 主動画の削除・別テンプレートへの変更・video以外への差し替えの禁止を、UIは「動画を差し替え」で回避している。契約上も検証済み。

### 音声・ミックス

- `AudioCue` の任意オフセット、個別フェード、個別ダッキング、波形編集（spec: 非目標）。R2でも明示的に持たない。
- 通常の `media.full-bleed` / `media.card` 動画への埋め込み音声自動適用（spec: 非目標、ADR-0067）。ミュート維持。
- 作品全体BGMの抑制は work範囲 `AudioCue` のみが対象。Scene範囲 `AudioCue` は埋め込み音声と重ねたまま（利用者がCueごとに調整）。
- 埋め込み音声用の音声Renditionの明示導出はしない（ADR-0068）。レンダーエンジンが動画から抽出する。

### データ・運用

- 取り込み済み（既存）Assetの `hasAudio` は既定 `false`。レンダー結果には影響しないが、UIの「音声ストリームあり/なし」表示が古い素材では不正確になり得る（backfill未実施）。
- Cue Map は insert Scene を「linesなしの空ブロック行」として最小表示。動画レンジの帯やサムネイルは出さない。

## 推奨する拡張順序

依存関係と効果の大きさから、次の順で進めるのがよい。

### P1. 既存Assetの `hasAudio` backfill（小さく効果的）

- 目的: 既存ライブラリの「動画に音声があるか」表示を正しくする。
- 範囲: APIの起動時／オンデマンドの再probe。`Asset` 行の `hasAudio` をffprobe結果で更新する。
- 実装の当たり: `apps/api/src/media/probe.ts`（`audioCodec` は取得済み）、`apps/api/src/worker/asset-ingest.ts`、`apps/api/src/services/assets.ts`。
- 注意: `system_profiler` ではなくffprobe。大量素材では起動時一括を避け、素材詳細表示時の遅延probeでもよい。

### P2. インサートSceneの動画トリム／ループ（spec 非目標の最有力）

- 目的: 「動画の一部だけ見せたい」「短い動画を尺に合わせて繰り返す」。
- 範囲: 主動画Cueに `trimStartMs` / `trimEndMs` と既存 `loop` を許可し、Scene尺 = 実効表示尺の規則を再定義。`RenderContext.embeddedAudio` の音声も同じトリムに追従させる必要がある。
- 実装の当たり:
  - 契約: `packages/contracts/src/content/scene.ts` の insert 検証、`templates/index.ts` の `media.full-bleed` 入力。
  - 動画: `packages/video/src/templates/media-full-bleed.ts` の `data-media-start`、`packages/video/src/templates/shared.ts` の `renderLoopVideoSegments`、`compiler.ts` の insert 音声。
  - API: `assertInsertScenes` の尺一致規則をトリム後の実効尺へ。
- 注意: 映像はエンジンがフレーム抽出、音声は別途抽出のため、トリム範囲を両方に一致させる。ADR-0068の「音声は動画から抽出」を維持する。

### P3. AudioCueのオフセット／フェード

- 目的: BGM・効果音の頭出し、Scene境界での自然な出入り。
- 範囲: `AudioCue` に任意の `startOffsetMs` / `fadeInMs` / `fadeOutMs`。
- 実装の当たり: `packages/video/src/compiler.ts` の `audioElement` / `buildLoopAudios` は `data-media-start` / `data-fade-in` / `data-fade-out` を既に出力できる。契約とUI（`SceneAudioFields`）を足す。
- 注意: insert のBGM抑制（work範囲の区間分割）と組み合わせる際、フェードが二重にならないよう合成規則をADR化する。

### P4. ダッキング（映像音声優先の自動音量制御）

- 目的: insert以外でも、ナレーションや動画音声に対してBGMを自動で下げる。
- 範囲: AudioCue の role を使ったミックス方針。spec の「roleは将来のミックス方針の分類」を具体化する。
- 実装の当たり: `packages/video/src/compiler.ts` の音量自動化lane（`data-automation`）または work AudioCue の区間分割の一般化。
- 注意: プレビューとレンダーで同じ規則を使う（spec 共通原則）。

### P5. 複数動画インサート／インサート中のオーバーレイ

- 目的: 複数カットの挿入、動画上の見出しテキスト。需要が出たら。
- 範囲: insert Sceneの `visualCues` 複数許可、複数主動画の連結、または動画プレイリスト型のCue。
- 注意: 現行契約は「主動画Cue 1件・lines空・立ち絵禁止」を強制しているため、拡張は破壊的になり得る。新 `kind`（例: `insert-sequence`）を足し、既存 `insert` の意味を変えない方針が安全。ADRを追加する。

## 前提の再検討ポイント

- 埋め込み音声をエンジン抽出のままにするか、音声Renditionを明示導出するか（ADR-0068）。再現性・失敗診断を厳しくするなら再検討。
- `hasAudio` をAssetの永続フィールドのままにするか、レンダー入力スナップショットにも持たせるか。
- 作品全体BGM抑制の粒度（work範囲のみ）。Scene AudioCueやナレーションも対象にするならロジックの一般化が必要。
