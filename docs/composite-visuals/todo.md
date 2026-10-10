# 複合ビジュアル 実装TODO

- [x] ContentDocument v3: `VisualCue` に `layer`/`order`/`transition` を必須化し、v1/v2 の読出し・移行コードと `explanation-5-scenes` レガシーを削除
- [x] `NestedVisual` 再帰スキーマ（media/template）と深さ8・ノード64の検証
- [x] テンプレート定義に `layers`/`transitionPolicy`/`display`/`collectAssetRefs` を集約し、`assetBearingTemplateKeys` とID決め打ち順序を廃止
- [x] 共通タイムライン解決器（半開区間 `[start,end)`）と transition 範囲検証を公開し、保存・レンダー投入で共用
- [x] コンパイラを layer/order 描画へ切り替え、scope分離・enter/exit・AnimationPlan合成を実装
- [x] `scene.device-frame@1`（NestedVisualの画像・動画を背景/カードに収める）を追加
- [x] Web UI: Cue一覧・追加・削除・レイヤー・順序・表示区間・transition編集。立ち絵は固定2行
- [x] `docs/composite-visuals/` を正本として追加し、ADR 0029/0030/0031 を記録、ADR 0013/0007 を改訂
- [x] `CONTEXT.md`・MVP文書・`docs/tts/spec.md` を v3へ同期
- 完了条件: device-frame の画像・動画を背景/カードで保存→プレビュー→MP4レンダーできる（達成）
