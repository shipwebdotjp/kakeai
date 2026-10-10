# シーン間トランジションは入場Sceneが所有し、総尺を変えない

Scene の境界演出（カット／フェードイン・フェードアウト／クロスフェード）は、**入場するScene側**が `scene.transition` として所有する。退場する先行Sceneはデータを持たない。既定はカット（尺0）。

描画は、入場Sceneの最初 `D` ms で入場Sceneの要素を `opacity 0 → 1` とし、その間、先行Sceneのclipを `D` ms 延長して保持することでクロスフェードを成立させる。**Scene尺の合計と総尺は不変**とし、境界内で表現する。フェードアウト／フェードイン（間に背景色を挟む）は、両隣を `D/2` ずつ暗転させる別presetとして同じ機構で表す。

検証は共通タイムライン解決器で行い、`D <= min(先行Scene尺, 入場Scene尺)` を満たさない入力を保存・レンダー投入前に拒否する。

理由は、Sceneを隙間なく直列配置して `cursor += durationMs` で絶対時刻を決める既存のタイムライン機構（`resolveTimeline`）をそのまま使えるため。総尺を変えないので Job の入力スナップショット、字幕区間、音声配置の計算に波及しない。Cueの入退場（[ADR-0031](./0031-cue-transition-and-animation-ownership.md)）とは責務を分け、Scene境界の演出はSceneが、Cue内の入退場はCueが持つ。

## Considered Options

- 遷移区間を独立に確保し総尺を加算する。→ 総尺・字幕・音声・スナップショットの再計算が波及し、既存の直列配置を崩すため不採用。
- 退場Scene側が `exit` を持つ。→ 境界の所有が二重になり、隣接Sceneとの整合検証が複雑になるため不採用。
- 各Sceneの背景Cueの `transition` に委譲する。→ 全Sceneに統一背景Cueを強要し、[ADR-0031](./0031-cue-transition-and-animation-ownership.md) の責務分離に反するため不採用。
- カット／フェードのみ先行しクロスフェードを後回しにする。→ 同じ機構でクロスフェードまで表現でき、後回しにする理由がないため同時に実装する。

## Consequences

- 先行Sceneのclipを `D` ms 延長する処理は描画時導出であり、正本JSONには表れない。導出規則は共通タイムライン解決器に一元化し、テストで固定する。
- `scene.transition` は `enter` を持つ（`preset`・`durationMs`）。`transitionPresetSchema` をカット／フェード／クロスフェードの集合として扱い、Cueの入退場と同じ有限presetの原則（[ADR-0031](./0031-cue-transition-and-animation-ownership.md)）に従う。
- 入場Sceneが先頭の場合、`D` は無視する（先行Sceneが無いため）。
- プレビューとレンダーで同一の解決結果を使い、`@hyperframes/player` の総尺表示とも一致させる。
