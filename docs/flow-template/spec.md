# フローテンプレート（`flow.diagram@1`）仕様

## 目的と境界

この文書は、ノードと辺で工程・流れを表す `flow.diagram@1` の正とする。台本の契約は [../mvp/content-schema.md](../mvp/content-schema.md)、Cue効果は [../cue-effects/spec.md](../cue-effects/spec.md)、決定は [ADR-0064](../adr/0064-flow-diagram-graph-contract.md) と [ADR-0056](../adr/0056-table-structured-json.md) を参照する。

- 正本は自前の小さな構造化JSON（ノード列・辺列・スタイル名・効果）とする。HTMLやSVGは正本にしない。
- 縦横は `style.orientation` で切り替える単一テンプレートとする。テンプレートを分けない。
- ノードは配列順、辺はノードの index で参照する。ノードに安定IDは持たせない（並び替えは配列操作）。
- 効果は [../cue-effects/spec.md](../cue-effects/spec.md) の共通単位に従い、行区間・Cue窓を契機にノードを強調する。任意のkeyframe・CSS・スクリプトは持ち込まない。
- 辺は常時表示とする（登場アニメを持たない）。

## 入力契約

`flow.diagram@1` の `visualCue.input` は次を満たす。

```jsonc
{
  "title": "処理の流れ",                       // 任意。図の見出し
  "diagram": {
    "nodes": [
      { "label": "受付", "caption": "窓口" },  // caption は任意
      { "label": "審査" },
      { "label": "完了" }
    ],
    "edges": [
      { "from": 0, "to": 1, "label": "書類" }, // label は任意
      { "from": 1, "to": 2 }
    ]
  },
  "style": {
    "orientation": "horizontal",                // horizontal | vertical（既定 horizontal）
    "preset": "clean"                           // clean | boxed（既定 clean）
  },
  "effects": [
    {
      "target": { "kind": "node", "index": 1 }, // node | nodes
      "trigger": { "kind": "lines", "startLineId": "line-1", "endLineId": "line-1" },
      "effect": { "kind": "emphasize", "style": "spotlight", "tone": "primary", "onset": { "preset": "sweep", "durationMs": 600 } }
    }
  ]
}
```

- `nodes` は1〜8、`edges` は0〜16。`edges[].from`/`to` は `nodes` の範囲内で、`from !== to`（自己ループ不可）。
- `effects[].target.index` は `nodes` の範囲内。
- `effects` は `table.simple` と同じ `{ target, trigger, effect }`。`effect` は `appear` / `emphasize`（`background` / `frame` / `spotlight`、任意の `onset`）。
- セリフの実時間は音声尺から解決する。Triggerは行IDを参照し、ミリ秒を直書きしない。

## テンプレート定義

| 項目 | 値 |
| --- | --- |
| `id@version` | `flow.diagram@1` |
| `layers` | `overlay` |
| `transitionPolicy` | 既定（入退場はCue側） |
| `animationPolicy` | 既定（内部アニメは `effects` が `AnimationPlan`／`stateIntervals` を返す） |
| `collectAssetRefs` | 素材を使わないため空 |
| `collectLineRefs` | `effects[].trigger` の行参照を収集する |

`inputFields` は次を持ち、編集画面はこれを解釈してフォームを生成する。

| key | kind | 内容 |
| --- | --- | --- |
| `title` | optionalText | 図の見出し |
| `diagram` | flow | ノードと辺の一括編集（`maxNodes` / `maxEdges`） |
| `style.orientation` | select | horizontal / vertical |
| `style.preset` | select | clean / boxed |
| `effects` | effects | 行トリガー付きの登場・強調（`variant: "flow"`） |

新規Cueには、2ノード＋1辺の雛形と、全ノードをフェードで登場させる既定効果を入れる。

## レンダリング

- ノードを主軸に等間隔配置する（`horizontal` は左→右、`vertical` は上→下）。直交軸は中央寄せ。プロットは固定px内で、ノード数に応じてノード寸法を上限・下限内で調整する。
- 辺はスコープ付きSVGで描く。矢印は `marker-end`、非隣接の辺は垂直オフセットのベジェで中間ノードを避ける。辺ラベルは中点に置く。
- 要素ID（ノード・マーカー）はCue scope 配下に閉じ、複数配置・入れ子で衝突しない。
- `appear` は対象ノードを `AnimationPlan` として登場させ、`nodes` グループでは `startMs = index × staggerMs` でずらす。
- `emphasize` は対象ノードにリングまたは背景を当て、`spotlight` では他ノードを `filter` で減光する。`onset` は対象ノード内の一時オーバーレイに当てる（発火と持続は別要素・別プロパティ）。
- 決定性: 同じ入力・同じシーク位置で同じ結果になる。プレビューとMP4が一致する。

## 非ゴール

- 辺の登場アニメ（常時表示）。
- 交差を最小化する自動レイアウト。ノードは配列順に等間隔で置く。
- ノードの形状・アイコン・画像の豊富化。`label` と任意 `caption` に限る。
- ノードの追加・削除に伴う安定IDの維持（配列順で参照する）。

## 受け入れ条件

- ノードと辺を持つフロー図を保存し、プレビューでシークし、MP4をレンダーできる。
- `style.orientation` で縦横を切り替えられ、どちらもプレビューとMP4が一致する。
- 行トリガーの `appear` / `emphasize` / `spotlight` / `onset` が、プレビューのシークとMP4で一致し、区間末で解除される。
- 同一テンプレートの複数配置・入れ子で、要素ID・`AnimationPlan`・`stateIntervals` が衝突しない。
- 範囲外ノード・自己ループ・ノード0件・範囲外の効果targetを保存時に拒否する。
