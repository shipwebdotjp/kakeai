# セリフゲートの保持フレームを source rendition 由来の派生PNGとして正規化する

セリフゲート動画再生で「保持」する区間は、先頭・途中・末尾を問わず、同じ解決規則で作る静止画像クリップ（`<img>`）として描画する。静止フレームは `render-content` が返す rendition の実フレームから、基準 source 時刻以下で最後の PTS を選んで抽出し、常に PNG として正規化する。抽出結果は `renditionSha256 + 解決PTS + extractorVersion` をキーにキャッシュし、正本 JSON・DTO・Job snapshot には保存しない。

## Considered Options

- 末尾の保持だけ HyperFrames 標準の最終フレーム保持（`data-duration` の延長）に任せる。→ `sourceEndMs < 素材尺` のとき、延長した `data-duration` が `sourceEndMs` を越えて動画が進んでしまい、指定した終端を守れないため不採用。
- 静止フレームを出力30fpsのCFRグリッドへ丸める。→ 元renditionの実フレームと一致せず、プレビューとレンダーで別フレームを指しうるため不採用。基準時刻以下で最後のPTSを選ぶ。
- 静止フレームをJPEGで保存する。→ 透過を保持できず、カードや端末枠の重なりで背景が欠けるため不採用。PNGを使う。
- 保持フレームのパスやフレーム番号を正本JSONへ保存する。→ 素材差し替えや再抽出で無効化し、正本と派生物が混ざるため不採用。Planと解決規則から都度導出する。

## Consequences

- `VideoPlaybackPlan`（絶対タイムライン時刻を持つ `play` / `hold` / `audio` 区間）を唯一の正本派生物とし、プレビュー・レンダー・Cue Mapは同じ解決済みPlanを受け取る。各所で再導出しない。
- プレビューは API が Plan 内の全 Hold を先に抽出・キャッシュしてから HTML を返す。未生成フレームを動画停止で代替したり、プレビュー途中で差し替えたりしない。
- `GET /assets/:assetId/frame?ms=` はメディアCookie認可を適用し、ready な video の確定尺内だけ許可して、正規化済みPNGを配信する。内部で `ms` を正規化キー（PTS・キャッシュ）へ変換する。
- Render Job は snapshot で固定済みの Asset/Rendition から同じPNGを `projectDir` へ事前生成し、同じ Plan でコンパイルする。snapshot には既に Rendition の SHA が含まれるため snapshot schema の版上げは不要。
- 前Sceneを延長する crossfade は映像 Plan の描画終端だけに加える。延長区間中も、最後に有効な `play` または `hold` を Plan どおり継続する。`addClipDurationMs()` はゲート動画の内部 `play` / `hold` / `audio` 区間を延長せず、親Cueクリップだけを延長する。
- [ADR-0072](0072-video-gate-playback-as-common-media-capability.md) の「保持」の扱いを、末尾も含めて派生PNGへ統一する形へamendする。
