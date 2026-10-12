# Composition Library ロードマップ

この文書は [spec.md](./spec.md) の v1 に含めない拡張を依存順に記録する。各段階は、先行段階の不変 CompositionVersion、bundle hash、Render Job snapshot の契約を壊さずに追加する。

## R1: 型付き slot

Composition manifest に text、color、number、enum、Kakeai Asset を型付き slot として宣言し、VisualCue ごとの値を渡せるようにする。HTML 文字列や任意 URL を slot に渡さず、Asset は compiler が preview / render 用 URL またはローカルパスへ解決する。

## R2: 複数 instance

同じ CompositionVersion を一つの render project へ複数置けるようにする。AI authoring contract に instance ID placeholder を追加し、DOM ID、CSS、timeline ID、script 内参照を instance ごとに安全に分離する。v1 の「一 version 一参照」制約をこの段階で外す。

## R3: 配置と Composite Visual Template

CompositionVersion を full-screen background 以外にも置けるようにする。端末フレーム、サイトモックアップ、カードなどの `NestedVisual` に対応し、canvas 比率、crop、mask、親子 timeline の表示区間を明示した契約にする。

## R4: 音声と派生 cache

Composition 内の短い SFX、BGM、音量、ducking を既存 AudioCue と統合する。必要になった場合は、version hash と出力条件でキー付けた透過 WebM などの派生 cache を追加し、native nested render が使えない composition の fallback とする。cache は正本ではない。

## R5: 外部 project と手動編集

外部 HyperFrames project の import、利用者による編集、任意 source の実行を検討する。この段階で初めて、import manifest、権利・来歴、隔離された実行環境、ネットワークとローカル API の分離、リソース上限を設計する。v1 の信頼済み AI source の限定例外を、任意 source へ拡張しない。
