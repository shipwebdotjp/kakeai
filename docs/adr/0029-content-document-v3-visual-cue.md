# ContentDocument v3: VisualCueのlayer・order・transition必須化

> amended by [ADR-0034](./0034-destructive-changes-before-1-0.md): 正式リリース前は `schemaVersion` の破壊的変更を許容し、移行関数を持たない。`1.0.0` 以降は本ADRの移行規律へ戻る。ADR-0035で `schemaVersion` は `4` になる。

`VisualCue` に `layer`（`background`/`card`/`standing`/`overlay`）、`order`（同一Scene・同一layer内で一意な非負整数）、`transition`（`enter`/`exit` のpresetと尺）を必須として追加し、ContentDocument の `schemaVersion` を `3` にする。`range` は解決後、半開区間 `[start, end)` として扱う。

保存済み `ScriptVersion` が存在しないことを着手前に確認したうえで、v1/v2 の読出し・移行コードと、置換済みの `explanation-5-scenes` レガシーテンプレートを削除する。旧版を残さない。

理由は、背景・カード・立ち絵・追加ビジュアルを同一のCueモデルで扱い、描画順を配列順ではなく `layer` と `order` で明示するため。transition をCue外枠の第一級データにすることで、テンプレート固有の動きと入退場を分離できる。`range` を半開区間とし、`enter + exit <= 範囲` を保存時・レンダー投入時に共通解決器で検証して、範囲外へアニメーションをはみ出させない。

## Considered Options

- `layer`/`order` を省略可能にし、template IDと配列位置から導出する。→ 過去の映像の意味を将来のコードに依存させるため不採用。
- v2を延命し加算的変更に留める。→ 保存データが無く、二重の表現が残るため不採用。
- `transition` をテンプレート内部アニメーションへ委譲する。→ 入退場とテンプレート固有の動きの責務が混ざるため不採用。

## Consequences

- [ADR-0013](./0013-content-schema-version-starts-at-1.md) を改訂（`schemaVersion` は `3` から始まる。保存データが無いため移行コードを持たない）。
- [ADR-0007](./0007-content-schema-extension-scene-slots-range-union.md) を改訂（描画順は `layer`/`order`、`Scene本文`/`caption` はコンパイラ固定層）。
- `packages/contracts` の `CONTENT_SCHEMA_VERSION` は `3`。初期Document・DTO・API契約・MVP文書を v3 へ同期する。
