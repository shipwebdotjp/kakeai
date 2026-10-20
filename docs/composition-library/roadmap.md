# Composition Library ロードマップ

この文書は [spec.md](./spec.md) の v1 に含めない拡張を依存順に記録する。各段階は、先行段階の不変 CompositionVersion、bundle hash、Render Job snapshot の契約を壊さずに追加する。

## R1: 型付き slot

Composition manifest に text、color、number、enum、Kakeai Asset を型付き slot として宣言し、VisualCue ごとの値を渡せるようにする。HTML 文字列や任意 URL を slot に渡さず、Asset は compiler が preview / render 用 URL またはローカルパスへ解決する。

## R2: 複数 instance（完了）

同じ CompositionVersion を一つの render project へ複数置けるようにする。v1 の「一 version 一参照」制約を外した。HyperFrames の native nested composition が、重複ホストへ instance ごとの runtime composition ID（`<id>__hf<index>`）を割り当て、CSS・DOM 参照・timeline 登録・SVG id を instance ごとにスコープするため、AI authoring contract に instance ID placeholder を追加する必要はなかった。

## R3: 配置と Composite Visual Template

CompositionVersion を full-screen background 以外にも置けるようにする。端末フレーム、サイトモックアップ、カードなどの `NestedVisual` に対応し、canvas 比率、crop、mask、親子 timeline の表示区間を明示した契約にする。カード・端末枠への埋め込みは、background range 解禁とは別の埋め込み契約として後続で設計する（[ADR-0061](../adr/0061-template-version-as-reinterpretation-boundary.md)）。

- 初回対象は `scene.device-frame` の laptop／phone screen のみ（`NestedVisual` の `kind: "composition"`）。`site-mockup`、`media.card`、任意 mask・透視変形は対象外。
- Canvas Profile（`landscape` = 1920×1080 / `portrait` = 1080×1920）を v1 のプロファイルセットとして実装し、`portrait` を phone screen（9:16）に収める。任意比率・mask・透視変形は後続。
- `fit`（`contain` / `cover`）、任意 `zoom`、任意 `position` を slot の content box へ適用する。frame ごとの px 定数は持たず、Composition slot を `container-type: size` にして `cqw`/`cqh` と `tan(atan2())` で倍率を求める。
- 後続の site mockup、TV、独自ベゼルは、同じ `NestedComposition` を受ける screen slot をそれぞれの trusted template に追加して実現する。

## R4: 音声と派生 cache

Composition 内の短い SFX、BGM、音量、ducking を既存 AudioCue と統合する。必要になった場合は、version hash と出力条件でキー付けた透過 WebM などの派生 cache を追加し、native nested render が使えない composition の fallback とする。cache は正本ではない。

## R5: 外部 project と手動編集

外部 HyperFrames project の import、利用者による編集、任意 source の実行を検討する。この段階で初めて、import manifest、権利・来歴、隔離された実行環境、ネットワークとローカル API の分離、リソース上限を設計する。v1 の信頼済み AI source の限定例外を、任意 source へ拡張しない。
