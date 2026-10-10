# CueのtransitionPolicyとアニメーション責務分離

Cueの入退場（`transition`）はCue外枠だけに適用し、テンプレート定義の `transitionPolicy`（許可preset・既定値・最大尺）と照合する。既定値はCue作成時に明示値として書き込み、レンダー時に暗黙導出しない。

テンプレート固有の動きは、入力スキーマ内の有限presetと数値だけで表す。汎用keyframe、任意CSS値、任意easing、スクリプト文字列は追加しない。

責務分離:

| 対象 | 責務 |
| --- | --- |
| VisualCue | 表示範囲、レイヤー、同層順、入場・退場 |
| Composite Visual Template | 内部レイアウトと、入力スキーマで許可した内部アニメーション |
| NestedVisual | 親テンプレート内に描画される子。独自のrange・layer・transitionを持たない |

理由は、入退場とテンプレート固有の動きを別レイヤーの関心事に保ち、任意コードを正本へ持ち込まずに表現を増やせるようにするため。`enter + exit <= Cue範囲` を共通タイムライン解決器で検証し、範囲外へはみ出させない。

## Considered Options

- テンプレートが独自の入退場を持つ。→ Cue範囲との整合検証が難しくなるため不採用。
- 任意CSSアニメーションを入力に許す。→ 検証不能で正本が壊れるため不採用。

## Consequences

- テンプレート定義に `transitionPolicy` を必須化する。
- `scene.device-frame@1` は初期は内部アニメーションを持たず、後続版で有限presetを追加できる。
