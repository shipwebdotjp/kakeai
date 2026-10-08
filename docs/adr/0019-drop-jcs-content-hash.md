# ScriptVersionは不変のまま、JCS正規化とcontentHashを省く

Status: amends ADR-0002

`ScriptVersion` は不変のままとし、`contentJson` はキー順を安定させたJSON文字列として保存する。JCS（RFC 8785）正規化と `contentHash`、Jobの `inputHash` は持たない。これらは現状どの判定にも使われておらず、同一内容の検出・変更追跡は版IDと `sourceScriptVersionId` で足りるため。JCSは数値・Unicodeで実装の落とし穴があり、個人利用では益が薄い。

## Considered Options

- 通常JSONのSHA-256だけを残す。→ 使わないハッシュを保守する理由がないため不採用。

## Consequences

`contentSchemaVersion` の列と、スキーマ版を上げて新しい版で移行する方針は維持する。同一バイト列の再現は元々要件にしていない。
