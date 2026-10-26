# キャラクター名のロケール別エイリアスをライブラリと台本の両方に持つ

`Character` の表示名は言語中立の既定名 `name` のまま残し、ロケール別の別名を `names: { locale, name }[]` として持つ。`voices` と同じく同一キャラクター内の `locale` 重複は拒否し、完全一致で解決する。一致がなければ既定名を使う。

ライブラリ（`Character` / `CharacterName` テーブル、`/characters` CRUD、Agent の `character.list` / `character.get`）と台本（`ContentDocument.characters[]`）の両方に持たせ、台本へ複製することで ScriptVersion 単体で（locale→表示名）が決まる自己完結した版にする。

取り込みと/or言語版作成では、対象 locale の別名を `Character.name` と対応 `Speaker.name` へ解決する。ライブラリ側の変更は既存台本のコピーへ波及しない。既存の言語版・作品への自動反映はしない。後から別名を足しても、取り込み済みの台本は手動（Web UI）または `script.save` で直す。

## Considered Options

- 言語ごとに別 Character を登録し、名前で対応を表す（命名規約）。→ ラベル頼りで自動選択できず、将来の自動生成と噛み合わないため不採用。
- 対応を Edition 側のキャスティング表に持つ。→ Character が既に持つ「既定の声」と同じく二重化し、見た目共通の条件では過剰なため不採用。
- ライブラリだけに持ち、台本へ複製しない。→ 台本単体で名前を決められず、外部ツールがライブラリ参照を必須にするため不採用。
- 来歴 ID（`libraryCharacterId`）や名前一致で既存台本へ自動反映する。→ 対応付けの誤爆と既存版の意図しない変更を招くため不採用。決定的な対応付け UI が要るなら別機能として検討する。

## Consequences

- `ContentDocument` は `schemaVersion: 1` のまま。`names` は `.default([])` の加算的拡張とし、既存の保存済み JSON はそのまま読める。破壊変更履歴への追記は不要。
- 保存時は character 内の `locale` 重複を拒否し、空名を拒否する。`characterNamesSchema` は `SUPPORTED_LOCALES` 上限を超えない。
- `character.addFromLibrary`（操作コアと Web UI の複製）は別名をコピーし、文書 locale で名前を解決する。`edition.create` のシードも同じ解決で `Character.name` と対応 `Speaker.name` を置き換える。
- Agent には読み取りだけを公開する。`character.setNames` は作らず、ライブラリのキュレーションは人専用のまま残す（ADR 0089 の方針と一致）。
