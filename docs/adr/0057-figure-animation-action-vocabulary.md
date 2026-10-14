# 図形アクションを AnimationPlan の語彙とし、遷移presetと分離する

図形の内部アニメーション（棒が伸びる、折れ線を描く、円弧を掃く）を、トランジションのpreset（`fade`・`slide-*`・`scale-in`）と同じenumに混ぜず、`AnimationPlan` の要素を「図形アクション」として定義する。

`RenderedCue.animation` の各要素は `{ targetId, action, axis?, ease?, startMs, durationMs }` とする。`action` は `AnimationPreset`（`none`/`fade`/`slide-*`/`scale-in`/`pulse`）に図形固有の語彙を加えた union とし、今回は `grow` を追加する。`axis` は伸長方向（縦棒 `y`・横棒 `x`）、`ease` は有限enum `normal | overshoot` とし、コンパイラが `power1.out` / `back.out(1.6)` に写像する。任意のeasing文字列やCSS値は持ち込まない。

理由は、`grow`・`draw`・`sweep` は `tl.from` のCSS varsだけでは表せず（`transform-origin` や `stroke-dashoffset`、回転が必要）、トランジションのpresetとは写像先が異なるため。遷移の `transitionPresetSchema` は狭いenumのまま据え置き、図形アクションを選べないようにする。

## Considered Options

- `AnimationPreset` に `grow-up` / `grow-left` などのpresetだけを足す。→ 伸長方向ごとにpresetが増え、将来の `draw` / `sweep` で再度拡張が要るため不採用。
- `AnimationItem` に任意のeasing文字列を持たせる。→ 決定論と有限語彙の方針に反するため不採用。

## Consequences

- `table.simple`・`scene.device-frame`・`scene.site-mockup` は `preset` を `action` へ機械的に移行する。描画は変わらない。
- `chart.bar` は `grow` + `axis` + `overshoot` で棒の伸長を表す。`chart.line`（`draw`）・`chart.pie`（`sweep`）を追加するときは、`action` に語彙を足すだけでスキーマは据え置ける見込み。
- `table.simple@1` の `TemplateFieldSpec` は本変更で `grid` へ共通化した（[ADR-0056](./0056-table-structured-json.md) を一部修正）。
