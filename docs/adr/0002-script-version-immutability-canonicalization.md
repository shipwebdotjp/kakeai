# ScriptVersionは不変とし、正規化はJCS、スキーマ移行は新版で行う

Status: amended by ADR-0019

`ScriptVersion` は不変とし、保存済み `contentJson` を書き換えない。`contentJson` は JCS（RFC 8785）で正規化したうえで SHA-256 を計算し `contentHash` とする。`contentSchemaVersion` の移行は既存版の書き換えではなく、新しい `ScriptVersion` を作ることで行う。

理由は、読み出し時にスキーマ変換すると保存済み `contentHash` と `Job.inputHash` が食い違い、レンダーの入力照合と再現性が壊れるため。正規化の定義を固定しないと、キー順・Unicode 正規化・数値表記の差でハッシュが意味を失う。

## Considered Options

- 読み出し時にマイグレーションし、ハッシュを再計算する。→ 不変性と照合が破綻するため不採用。
- `contentHash` を内容同一判定だけに限定し、照合は `inputHash` 専用にする。→ 補助的には正しいが、正規化問題は残るため主対策とはしない。

## Consequences

スキーマ移行のたびに版が増える。読み出し側は古い `schemaVersion` を解釈できる必要がある。`contentHash` は Asset のバイト列を含まないため、レンダーの完全な入力照合には `inputHash` を使う。
