# フロー図の正本は index 参照の小さなグラフJSONとし、縦横は style.orientation で切り替える

`flow.diagram@1` の正本は、自前の小さなグラフJSON（`nodes` の配列と、ノード index を参照する `edges`）とする。縦横は別テンプレートに分けず、`style.orientation: horizontal | vertical` で切り替える。辺は常時表示とし、登場アニメを持たせない。詳細は [../flow-template/spec.md](../flow-template/spec.md)。

## Considered Options

- ノードに安定IDを持たせ、辺がIDで参照する。→ 動画のCue内で閉じた小さな図では並び替え・削除時のID再採番が複雑になるため不採用。配列順で参照すれば足りる。
- `flow.horizontal@1` と `flow.vertical@1` の2テンプレートに分ける。→ 入力スキーマ・レンダラ・エディタがほぼ同一で重複するため不採用。`chart.bar@1` と同じく `style.orientation` で切替える。
- 辺の登場をノードに連動させる。→ 辺の表示を両端ノードの登場時刻に依存させる必要があり、シーク安全な状態管理が複雑になるため、初版では常時表示とする。
- 自動レイアウト（交差最小化・段組み）を持つ。→ 決定的な有限の計算に閉じられず正本と派生の境界が曖昧になるため不採用。配列順の等間隔配置に固定する。

## Consequences

- `nodes` は1〜8、`edges` は0〜16、`from`/`to` は `nodes` の範囲内で `from !== to` を保存時に検証する。
- 効果は [ADR-0062](./0062-line-triggered-effect-unit.md) の共通単位に従い、targetは `node`（index）または `nodes`（全ノード）とする。強調は `emphasize`、登場は `appear`、`spotlight`・`onset` は既存の仕組みを流用する。
- 辺はスコープ付きSVGで描き、要素IDはCue scope 配下に閉じる。非隣接の辺はベジェで中間ノードを避ける。
- ノードの並び替え・削除は配列操作であり、行編集時の参照remapは効果トリガーの行IDのみを対象とする（[ADR-0062](./0062-line-triggered-effect-unit.md)・[ADR-0063](./0063-animation-onset-and-sustained-state.md)）。
