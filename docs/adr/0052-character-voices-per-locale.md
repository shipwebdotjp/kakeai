# キャラクターの声を locale 別に持ち、台本へ複製して自己完結させる

`Character` は言語中立のまま見た目（`appearances`）を共通にし、声だけを locale 別に持つ。声の対応は `{ locale, voiceProfileId }[]` の `voices` とし、アプリ共通のキャラクターライブラリと ContentDocument の `characters[]` の両方に持たせる。ContentDocument 側へ複製することで、ScriptVersion 単体で（locale→声）が決まる自己完結した版にし、将来の言語版の自動生成がラベル頼りにならないようにする。

`VoiceProfile` に `locale`（BCP 47）を持たせ、選択した声の申告 locale（アダプターの一覧の `locale` またはアダプター記述子の既定）から導出・検証する。TTS が使う実効バインディングは従来どおり `Speaker.voiceProfileId` とし、ライブラリから台本へ取り込むときに当該 Edition の locale に一致する声を束ねる。

## Considered Options

- 言語ごとに別 Character を登録し、名前で対応を表す（命名規約）。→ ラベル頼りで自動選択できず、将来の自動生成と噛み合わないため不採用。
- 対応を Edition 側のキャスティング表に持つ。→ Character が既に持つ「既定の声」と二重化し、見た目共通の条件では過剰なため不採用。
- 対応をライブラリだけに持ち、台本へ複製しない。→ 台本単体で声を決められず、外部ツールがライブラリ参照を必須にするため不採用。

## Consequences

- ContentDocument は `schemaVersion: 8` へ上げ、v7→v8 の読出し移行（対応話者の声を document の `locale` と組にして `voices` の1件とする）を追加する。履歴は [../mvp/content-schema-history.md](../mvp/content-schema-history.md) に記録する。
- 保存時は character 内の `locale` 重複を拒否し、`voiceProfileId` の実在を検証する。`characterId` を持つ話者の声は document の locale に対応する `voices` の値と一致させる。
- `Character.voiceProfileId`（単数）は廃止し、ライブラリ DB は `CharacterVoice` テーブルへ移す。
