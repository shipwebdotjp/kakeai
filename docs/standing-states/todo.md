# セリフ境界の立ち絵状態 TODO

仕様は [spec.md](spec.md)、決定は [ADR-0116](../../adr/0116-standing-states-at-line-boundaries.md) と [ADR-0117](../../adr/0117-standing-layout-on-appearance.md) を正とする。

## P1 契約

- [x] `CharacterAppearance.standing`（scale / edge / vertical、既定値付き）を追加する
- [x] `Scene.standingStates`（side / fromLineId / characterId / appearanceId）を追加する
- [x] `character.standing@1` の scale / edge / vertical を任意の上書きにする
- [x] 状態の行・キャラクター・外観・重複・null組合せを `ContentDocument` で検証する
- [x] `standing.state.upsert` / `standing.state.remove` を操作契約に追加する

## P2 操作コア

- [x] 状態の upsert / remove を `packages/script-edits` に実装する
- [x] 行の削除・移動・分割で状態の行参照を維持する
- [x] Scene分割で分割点の有効状態を新しいSceneの開始時状態へ引き継ぐ
- [x] キャラクター・外観のライブラリコピーと更新に `standing` を含める
- [x] ライブラリ更新の表情リセット判定に状態の外観を含める

## P3 レンダー

- [x] 開始時状態と変更点を表示区間へ展開してレンダーする
- [x] 外観の `standing` を倍率・端・高さの既定値として解決する
- [x] Cueの明示値を上書きとして優先する
- [x] 状態変更がカットで、発話中バウンド・表情・口パクが区間内で正しく動く
- [x] 変更点が無いSceneの出力を従来と変えない

## P4 API・Agent

- [x] ライブラリ外観のDB列・DTO・作成/更新に `standing` を追加する
- [x] `character.addAppearance` / `character.updateAppearance` に `standing` を追加する
- [x] `references.ts` の表情検証を「その行で有効な外観」に変える
- [x] Agent Accessの操作一覧・スキーマダイジェスト・ドキュメントを更新する

## P5 Web UI

- [x] 外観編集に倍率・端・高さを追加する
- [x] 立ち絵セクションに「シーン開始時」と「セリフごとの変更」を表示する
- [x] セリフカードに有効な状態を表示する
- [x] セリフの表情候補を、その行で有効な外観のFace Setから作る
- [x] Cueマップの立ち絵帯を変更点で分割する
- [x] Cueマップの変更検知とジャンプを状態に対応させる
- [x] キャラクター・外観・行の削除時に状態を整える

## P6 文書

- [x] `content-schema.md` / `character-library/spec.md` / `face-expression/spec.md` / `multi-standing/spec.md` を更新する
- [x] `editor/spec.md` / `editor-core/spec.md` / `cue-map/spec.md` を更新する
- [x] `agent-access/spec.md` とユーザーガイドを更新する
- [x] `npm run typecheck` と `npm test` を通す
