# 背景・カードの動画ループ（media loop） 仕様

## 目的と境界

この文書は、背景 `media.full-bleed@1` とカード `media.card@1` に置いた**動画素材**を、Cueの可視窓いっぱいにループ再生する `loop` の正とする。焦点位置・拡大率は [../focal-point/spec.md](../focal-point/spec.md) と [../media-zoom/spec.md](../media-zoom/spec.md) を正とし、本仕様はその入力にループ指定を併設する。台本の正本JSON契約は [../mvp/content-schema.md](../mvp/content-schema.md) を正とする。

- 対象は `media.full-bleed@1` と `media.card@1` の動画Cueだけとする。`scene.device-frame`・`scene.site-mockup` などの `nestedMedia`、画像素材、`composition.full-bleed` は対象外。
- ループは**明示指定**（`loop: true`）のときだけ効く。既定は無効。
- 動画素材が可視窓より短いときだけ意味を持つ。素材が窓以上に長い場合は従来どおり窓尺でトリムし、ループしない。
- Video Gate Playbackとは併用しない。Gateはsource時刻を一方向に進める上限であり、loopとの意味を混ぜない（[../video-gate-playback/spec.md](../video-gate-playback/spec.md)）。
- 契約は任意フィールドの追加であり、再解釈を伴わないため同じ `@1` で行う（[ADR-0061](../adr/0061-template-version-as-reinterpretation-boundary.md)）。

## データ

`loop` は対象テンプレートの任意真偽値で、省略時は `false`（ループなし）と解釈する。

```json
{
  "assetId": "asset-background-1",
  "fit": "cover",
  "loop": true
}
```

- `loop` は `assetId` が動画のときだけ意味を持つ。画像に指定しても描画は変わらない。

## レンダリング

動画ループは、素材を可視窓いっぱいに**連続配置**して表現する。HyperFramesはレンダー時にFFmpegでフレームを事前抽出するため、ネイティブの `<video loop>` 属性には依存しない。

- 素材長 `S`、可視窓長 `W`、窓開始 `T` とする。`loop: true` かつ `S < W` のとき、複製数を `ceil(W / S)` とし、`i` 番目（0始まり）の動画を `data-start = T + i×S`、`data-duration = min(S, W − i×S)` で出力する。
- 各要素は `data-media-start="0"` を持ち、素材を先頭から再生する。`id` は `${scope}-media-${i}` とし一意にする。
- 複製数が上限（1000）を超える場合は `loop_span_too_long` でコンパイルエラーにする。素材長が不明（`null`）または `0` 以下、あるいは `S >= W` のときは複製せず、従来どおり単一の動画を窓尺で出力する。
- カードは `.kakeai-cardmedia-clip` の枠内に複製動画を並べる。背景は `#kakeai-root` のクリップに従う。
- 従来のメディアtiming付与（Cue内の `<video>` へ絶対 `data-start`/`data-duration` を明示する）は、既にtimingを持つ動画には適用しない。複製動画は自身の絶対timingを持つ。
- ループの切れ目（素材末尾から先頭へ戻る点）はカットとする。クロスフェードなどのシーム対策は行わない。

## 編集UI

- `TemplateFieldSpec` の `boolean`（キー `loop`、ラベル「動画をループ再生」）で、対象テンプレートのフォームにトグルを出す。未指定は「既定」、オンで `true`、オフで `false` を保存する。
- `@1` の背景・カードCueも編集画面は `@2` として読み込み、ループを編集できる。素材が画像のCueでもトグルは保持する（描画には影響しない）。
- 編集後の見え方は、保存前のドラフトプレビューで確認できる。

## 非目標

- `nestedMedia`（`scene.device-frame`・`scene.site-mockup`）内の動画ループ。
- ループの継ぎ目を滑らかにするトランジション。
- 再生速度の変更や逆再生。
