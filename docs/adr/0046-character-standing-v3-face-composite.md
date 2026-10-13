# character.standing@3 を追加し、顔レイヤーを立ち絵と同一変換で合成する

`character.standing` に新バージョン `@3` を追加する。入力は `@2` と同じ `{ characterId, appearanceId, side, scale }` とし、描画だけを拡張する。`@3` は、外観が参照する Face Set のベース＋眉＋目＋口＋前景を**単一の wrapper 要素**内で合成し、台詞区間ごとに Expression Preset を切り替える。

`@1`（自由座標）と `@2`（左右配置＋発話中バウンド）は意味も描画も不変のまま残し、引き続き検証・描画する（[ADR-0009](./0009-template-version-immutability.md)）。編集UIは保存時に `@3` を書き出す。外観が Face Set を参照しない場合でも `@3` は有効で、その場合はベース画像だけを描く（`@2` と同じ見た目）。

## 合成と変換の共有

- ベース画像と全 Face Layer を同一 wrapper に置く。`@2` の位置写像（外端アンカー、半幅 `0.125×scale`）とドロップシャドウを wrapper に適用し、子レイヤーは `width:100%` で重ねる。
- 発話中バウンド（[ADR-0027](./0027-standing-side-and-speak-bounce.md)・[ADR-0028](./0028-standing-edge-anchored-layout.md)）は wrapper に適用し、全レイヤーが一緒に動く。
- 台詞区間ごとの表情切替は、話者→キャラクターの発話区間計算と同じ解決器で間隔を求める。区間の先頭で対象 preset の眉・目・口を表示し、区間外は `normal` を表示する。

## Considered Options

- `@2` の描画を直接変更する（[ADR-0034](./0034-destructive-changes-before-1-0.md) により開発段階では許容）。→ 版分岐は減るが、保存済み `@2` の見た目が変わり得るため不採用。
- 表情切替を `visualCues` の `range: lines` Cue として表現する。→ `(scene, layer, order)` 一意制約と、同一Scene内の複数表情区間で破綻しやすいため不採用。台詞ごとの表情は台詞の属性として持つ（[ADR-0047](./0047-per-line-expression-id.md)）。
- ベース画像を毎フレーム差し替える。→ 素材数とレンダー負荷が増えるため不採用。

## Consequences

- `@3` の描画は `packages/video` のコンパイラとテンプレートに追加する。`@1`/`@2` の描画コードは削除しない。
- `@3` は解決済み Face Set を必要とする。コンパイラは `faceSetResolver` を通じて受け取る（[ADR-0045](./0045-face-set-global-reference.md)）。
- Face Set を参照しない外観、および既存 `@2` のCueは、表情切替の対象外であり見た目を変えない。
