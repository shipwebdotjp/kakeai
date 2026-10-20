# 瞬き・口パクは固定シードの疑似乱数で駆動し character.standing@3 に追加する

`character.standing@3` の描画に、瞬きと簡易口パクの時間変化を追加する。目レイヤーの `blinkLayerId` があれば立ち絵の表示区間全体で瞬き、口レイヤーの `speakingLayerId` があれば発話区間（発話中バウンドと同じ区間）だけで口パクする。いずれも音素解析や台詞内容との対応は行わない。

動作時刻は `cue.id` と `characterId` から導いた固定シードの疑似乱数（`mulberry32`）で決定する。シード源に Face Set 内容を含めないため、閉眼・開口レイヤーの差し替えでは瞬き・口パクの間隔が変わらない。瞬き・口パクの間隔・長さなどの動作パラメータは内部定数とし、正本JSONに保存しない。

理由は、セリフ非対応のアイドル動作として自然さを足しつつ、[ADR-0003](./0003-render-determinism-frozen-html.md)・[ADR-0011](./0011-render-snapshot-recompile.md) の決定性を保つため。同じ台本・同じ Face Set のプレビューと再レンダーは動きまで同一になる。Face Set の編集で動きが変わり得る点は [ADR-0045](./0045-face-set-global-reference.md) の許容範囲内であり、1回の Render Job 内ではスナップショットに固定した Face Set を使う。

## Considered Options

- 口パクを立ち絵の表示区間全体で行う。→ 発話と無関係に口が動き続けて不自然なため不採用。
- 発話音声の音素解析や台詞内容と同期する。→ 解析基盤がなく、v1 の素材形式（開口1枚）では表現できないため不採用。
- `character.standing@4` を新設して `@3` を凍結する。→ variant 未登録の既存データは見た目が不変であり、正式リリース前（[ADR-0034](./0034-destructive-changes-before-1-0.md)）でもあるため、機械的な版追加は見送る。
- 動作パラメータを正本JSONに保存する。→ 台本と無関係な描画規約であり、bounce と同様に描画側の規約とするため不採用。

## Consequences

- `packages/video` に決定的乱数（`random.ts`）を追加する。`ExpressionTarget` に variant 要素 ID を持たせ、コンパイラは発話区間と重ねた active preset に対して `tl.set` を発行する。
- variant 未登録のレイヤーは静止し、既存 `@3` の見た目は変わらない。
- 口パクは発話区間にだけ発生するため、無音の立ち絵は瞬きのみになる。
