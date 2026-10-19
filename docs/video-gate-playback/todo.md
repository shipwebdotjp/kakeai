# セリフゲート動画再生 実装TODO

[仕様](./spec.md)を正とする。D1 → P1 → P2 → P3 → P4の順に進め、各段階でドラフトプレビューとMP4レンダーの同一性を確認する。

## [x] D1 方針・用語・契約境界

- [x] `docs/video-gate-playback/spec.md`、本TODO、`roadmap.md`を追加する。
- [x] `CONTEXT.md` にVideo Gate Playback、Video Gate、Video Gate Audioを追加する。
- [x] セリフゲート再生を専用VisualTemplateではなく、直接／入れ子のvideo Asset参照が共有する能力に置く決定をADRへ記録する。
- [x] Insert Sceneの自動埋め込み音声と、明示的なゲート動画音声を区別するよう既存仕様を相互参照する。

## [ ] P1 正本契約とPlayback Plan

- [ ] `packages/contracts` に `VideoPlayback`、`VideoGate`、Gate区間のAudio設定を追加する。直接メディア入力と `NestedVisual.kind = "media"` が同じスキーマを使う。
- [ ] `media.full-bleed@1`／`media.card@1` の連続再生用 `loop`・trimと、`videoPlayback` の排他・加算的互換性をスキーマで検証する。
- [ ] Document検証で、Asset種別・ready状態・確定尺、Gateのline/source順、Cue可視窓、source終端、fade尺、Insert Scene禁止を検証する。
- [ ] `@kakeai/video` に、解決済みライン時刻から連続再生・保持・音声区間を導出する `VideoPlaybackPlan` を追加する。プレビューとレンダーはこのPlanだけを使う。
- [ ] ScriptVersion保存、ドラフトプレビュー、Render Job投入で同じ検証とPlan解決を使う。
- [ ] contracts/video/apiの境界テストを追加する。少なくとも既存Cue互換、先頭Gate、早着・遅着、source終端、範囲外line、source順逆転、trim/loop併用を確認する。
- [ ] `npm run typecheck`、`npm test`、OCRレビュー、コミットを行う。

完了条件: ゲート設定の有無で既存動画Cueの意味を変えず、無効なGate入力を保存・プレビュー・レンダー投入の全境界で拒否できる。

## [ ] P2 映像レンダリングと静止フレーム

- [ ] `VideoPlaybackPlan` の連続区間を、絶対タイミングとsource開始位置を持つvideoセグメントへコンパイルする。
- [ ] 保持区間をCFRレンダー入力由来の決定的な静止フレームとして出力し、正本へフレーム番号・ローカルパスを保存しない。
- [ ] 直接メディアとNested Mediaの共通rendererを通して、全画面、カード、device-frame、site-mockupで同じPlanを適用する。
- [ ] videoがCue途中で隠れる、Cue transition、Scene transition、source終端保持、複数動画Cueの重なりを確認する。
- [ ] ドラフトプレビュー、保存済みプレビュー、Render JobのMP4で同じフレーム列になることをテストする。
- [ ] `npm run typecheck`、`npm test`、OCRレビュー、コミットを行う。

完了条件: 動画が次Gateへ早く到達したときだけ静止し、次のNarration Segment開始で再開する。台詞が早いときは停止もシークも起きない。

## [ ] P3 Gate区間の埋め込み音声

- [ ] Video Gate Audioを映像と同じsource区間からミックスし、ゲート保持中は必ず無音にする。
- [ ] Gateごとの有効／無効、gainDb、fadeInMs、fadeOutMsを、videoの実際の再生区間へ適用する。
- [ ] 音声ストリームなし、複数video Cueの音声重なり、Narration Audio Takeとの重なり、作品全体BGMとの重なりを診断・テストする。v1では自動ダッキングしない。
- [ ] Insert Sceneの `embeddedAudio`／BGM抑制がVideo Gate Playbackから影響を受けないことを回帰テストする。
- [ ] `npm run typecheck`、`npm test`、OCRレビュー、コミットを行う。

完了条件: ゲート区間ごとの音声設定と映像のsource位置がプレビューとMP4で一致し、静止中にvideo音声が残らない。

## [ ] P4 共通編集UI・診断・ガイド

- [ ] 素材選択結果のAsset種別を使い、動画だけに共通のVideo Playback編集部品を表示する。画像・Compositionでは非表示かつ非保存とする。
- [ ] `media` と `nestedMedia` の両方へ同じ部品を接続し、全画面、カード、device-frame、site-mockupで同じ操作を提供する。
- [ ] Gateの追加・削除・順序変更、Narration Segment選択、source時刻、Gate Audioの編集を追加し、Cue可視窓外の候補を選べないようにする。
- [ ] 動画→画像・Composition切替、ゲート解除、素材差し替えで無効な `videoPlayback` を残さない。
- [ ] Cue Mapとドラフトプレビューに、Gate・保持・音声区間の診断とジャンプ先を表示する。
- [ ] `user-guide/docs/` に通常動画、セリフゲート再生、音声、Insert Sceneとの違い、初期版の制約を追加する。
- [ ] UI・フォーム復元・プレビューの振る舞いテストを追加する。UI文言そのものは検証しない。
- [ ] `npm run typecheck`、`npm test`、OCRレビュー、コミットを行う。

完了条件: video Assetを選んだ任意の編集可能なメディア配置で、利用者がゲートと音声を編集し、保存・プレビュー・MP4出力まで確認できる。
