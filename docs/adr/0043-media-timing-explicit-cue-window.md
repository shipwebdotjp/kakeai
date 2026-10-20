# Cue内のmediaとComposition hostへ絶対timingを明示する

Cueの可視窓（`absStartMs`/`span`）を、外側の timed `.clip`（wrapper）だけでなく、Cue内の `<video>` と composition host（`data-composition-src` を持つ `div`）にも同じ絶対 `data-start`/`data-duration` として付与する。crossfadeによる尺延長は、clip断片内の全 `data-duration` に適用する。

- HyperFrames 0.8.143 は plain な timed wrapper のオフセットをネストした media / composition host に伝播しない（`@hyperframes/core` の startResolver で実測: wrapper が `data-start="4"` でも hostStart=0）。
- その結果、wrapper だけが timing を持つと `<video>` は auto-start として「0s起点＋素材長」に固定され、素材長（例: 10s）を過ぎた後半シーンの動画が静止、またはレンダーで欠落した。composition host も同じく0s起点になり、シーンの可視窓に入った時点でタイムラインが既に進んでいた。
- media/composition host に絶対 `data-start`/`data-duration` を明示すると、両者の窓が一致するため frame extractor と可視判定が一致し、正しく解決する（実測で `start=14.089, end=22.201`）。

## Considered Options

- HyperFrames の契約どおり media/composition を唯一の timed 要素にし、wrapper は非timedで可視制御（GSAP opacity）へ再設計する。→ lint 準拠になるが、scene crossfade（前シーン内容を重なり時間だけ見せるため wrapper duration を延長）と、media.card の見出し/キャプションを wrapper の可視窓で隠す挙動の作り替えが必要で、既存遷移への回帰リスクが大きいため今回は不採用。
- wrapper のみ timing を維持する（現状）。→ 後半シーンの media/composition が表示されない。

## Consequences

- `packages/video/src/compiler.ts` に `applyCueTiming` を追加し、`emitCue` で Cue 内の media と composition host へ窓を明示する。`addClipDurationMs` は clip 断片内の全 `data-duration` を延長する。
- `renderCompositionFullBleed` は `manifest.width`/`height` から host に `data-width`/`data-height` も明示する。
- HyperFrames の lint `video_nested_in_timed_element` は timed 祖先下の `<video data-start>` を error にするが、本件は wrapper と media の窓が同一で実害がない。Kakeai は生成した Composition HTML に lint を掛けないため許容する。
- **将来課題**: HyperFrames が plain wrapper から media へのオフセット継承を実装した場合、または生成HTMLへの lint 準拠が必須になった場合は、media/composition を唯一の timed 要素とし、wrapper の可視制御を再設計する。その際は本ADRを `amended by` で更新する。
- `packages/video/src/compiler.test.ts` で、後半 Cue の video / composition host に正しい絶対 timing が付くことと、crossfade 時に media 側の `data-duration` も延長されることを検証する。
