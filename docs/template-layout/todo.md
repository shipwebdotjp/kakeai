# テンプレート・レイアウト改善 実装TODO

[仕様](./spec.md) と [ロードマップ](./roadmap.md) を正とする。対象は `flow.diagram@1`、`table.simple@1`、`chart.bar@1`、`scene.device-frame@1` に限る。

## フェーズ

### [ ] L1 契約と警告

- [ ] `packages/contracts` に flow のラベル幅見積りと、基準・最小文字サイズの共有定数を追加する。
- [ ] `computeContentWarnings` に `flow_label_reduced` と `flow_label_overflow` を追加し、横型・縦型のノード幅を考慮する。
- [ ] `table.simple@1` と `chart.bar@1` の `style.width` を `wide | medium | narrow` として任意追加する。
- [ ] `scene.device-frame@1` の `scale`（`0.6..1`）と `placement`（`left | center | right`）を任意追加する。
- [ ] 各テンプレートの `inputFields` を更新し、既存のフォーム用 `number` / `select` フィールドだけで編集できることを確認する。
- 完了条件: 正常値・境界値・不正値のスキーマテスト、flow警告の契約テストが通る。

### [ ] L2 レンダラー

- [ ] flow のノードラベルに、共有の見積りに基づく文字サイズと折返し規則を適用する。最小サイズでも一行に収まらないときに文字を切り捨てない。
- [ ] 表フレームと棒グラフのフレーム／プロットへ幅プリセットを適用する。`wide` と未指定は既存の最大幅を保つ。
- [ ] デバイスフレームの一式を縮小し、縮小後の外形を `left` / `center` / `right` へ正しくアンカーするラッパーとCSSを追加する。
- [ ] Cueの内部アニメーション、入れ子の画面、キーボード、ステータスバーが新しいレイアウト指定と共存することを確認する。
- 完了条件: 代表入力のコンパイルHTMLと、プレビュー／MP4の描画が一致する。

### [ ] L3 編集UIと保存往復

- [ ] 既存の generic Cueフォームで、表・グラフの幅、デバイスの倍率・配置を編集できるようにする。
- [ ] 未指定値をUI上の既定値として表示し、既存Cueを変更せず保存すると未知でない任意値を不必要に書き込まない。
- [ ] デバイスの100%・中央へのリセットで、`scale` / `placement` を省略する。
- [ ] 新規Cueの初期値、既存Cueの復元、ドラフトプレビュー、保存後の再読込をテストする。
- 完了条件: 作成・編集・保存・再読込で契約どおりのJSONが維持される。

### [ ] L4 検証と周辺文書

- [ ] `packages/contracts`、`apps/web`、`packages/video` の振る舞い・境界テストを追加する。
- [ ] 横型・縦型で、flowの長い日本語ラベル、3段階の表・グラフ幅、左右の立ち絵とデバイス配置を視覚確認する。
- [ ] [../flow-template/spec.md](../flow-template/spec.md)、[../table-template/spec.md](../table-template/spec.md)、[../chart-template/spec.md](../chart-template/spec.md)、[../composite-visuals/spec.md](../composite-visuals/spec.md)、MVPの台本契約文書、ユーザーガイドを実装内容へ更新する。
- [ ] `npm run typecheck` と `npm test` を通し、OCRレビューを最大3回実施して、正当な指摘を修正する。
- [ ] 変更をコミットする。
- 完了条件: 仕様と実装・利用者向け説明が一致し、型検査とテストが成功する。

## 実装時の確認事項

- `scale` は立ち絵の `scale` やメディア内の `zoom` と意味が異なる。デバイス一式の見た目の倍率として、`scene.device-frame` に閉じ込める。
- 幅プリセットは表・グラフの文字を縮小する機構ではない。窮屈なデータは、既存の内容警告とプレビューで扱う。
- 背面／カードのデバイスと立ち絵の重なりは描画順どおりであり、今回自動解決しない。
