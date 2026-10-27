# キャラクターライブラリ仕様

## 目的と境界

この文書は、作品をまたいで再利用するキャラクター（人物・アバター）の管理と、台本への取り込みの正とする。台本の正本JSON契約は [../mvp/content-schema.md](../mvp/content-schema.md)、HTTP契約は [../mvp/api-contract.md](../mvp/api-contract.md) を正とする。

- キャラクターはアプリ全体で共有する**ライブラリ**として登録する。作品をまたいで同じキャラクターを使える。
- 台本へは「ライブラリから追加」で**コピー**する。台本内のキャラクター実体は従来どおり ContentDocument に保持し、`schemaVersion: 1` の基準契約に従う（[ADR 0026](../adr/0026-character-library-copy-semantics.md)）。
- コピーは `libraryCharacterId` と外観ごとの `libraryAppearanceId` を記録する。これは来歴情報であり、レンダーには使わない。
- ライブラリ側の変更は既存台本のコピーへ自動では波及しない。作品ごとに調整したい場合は、その作品のコピーを編集するか、外観を分けてライブラリに登録する。
- 明示的に最新内容を取り込みたい場合は、作品編集画面の「ライブラリから更新」を使う（[ADR 0103](../adr/0103-character-library-explicit-update.md)）。名前・言語別名・声・外観と、外観が参照する Face Set の最新改訂版を差分確認のうえ取り込み、作品内の Character・話者・立ち絵の ID は維持する。ライブラリで削除された外観は作品内に残して未リンク化し、新規外観は新しいローカル ID で追加する。この操作より前にコピーされた `libraryCharacterId` を持たない作品は対象外とする。
- 外観（`CharacterAppearance`）は任意の表示名 `label`（例「夏服」「冬服」）を持つ。表情・ポーズのタグに加えて、バリエーションを名前で選べるようにする。
- 外観は任意で1つの Face Set を `faceSetId` で参照できる。Face Set は台本へコピーせず、アプリ共通のグローバルライブラリの実体を参照する（[../face-expression/spec.md](../face-expression/spec.md)、[ADR-0102](../adr/0102-face-set-revisions-and-pinned-works.md)）。ライブラリの外観は常に最新の改訂版を使い、台本へ「ライブラリから追加」でコピーするときは、その時点の改訂版を `faceSetVersion` に固定する。以後 Face Set を編集しても、コピー済みの作品は固定した版を使い続ける。最新版へ移すのは「ライブラリから更新」だけである。
- Face Set を参照する外観を保存するときは、最新の改訂版の顔レイヤーとベース画像の寸法が一致することを検証する。一致しない外観は保存を拒否する。

## ライブラリのデータ

`Character` は表示名、ロケール別の名前、locale別の声の対応、外観の配列を持つ。外観は画像 Asset と表情・ポーズ・表示名を持つ。

```json
{
  "id": "char_abc123",
  "name": "四国めたん",
  "names": [
    { "locale": "ja-JP", "name": "四国めたん" },
    { "locale": "en-US", "name": "Shikoku Metan" }
  ],
  "voices": [
    { "locale": "ja-JP", "voiceProfileId": "vp_1" }
  ],
  "appearances": [
    { "id": "appearance_summer", "assetId": "asset_img_1", "expression": "smile", "pose": "front", "label": "夏服", "faceSetId": null }
  ],
  "createdAt": "2026-10-09T00:00:00.000Z",
  "updatedAt": "2026-10-09T00:00:00.000Z"
}
```

- `name` は既定名であり、`names` が無い locale ではこの名前を使う。`names` はロケール別の別名であり、同一キャラクター内の `locale` 重複は拒否する。空名は拒否する。解決規則は `voices` と同じく対象 locale との完全一致であり、部分一致は行わない。詳細は [ADR 0091](../adr/0091-character-locale-names.md) を参照する。
- locale別の声プロファイルを紐付けられる。同じキャラクターは言語をまたいで同じ見た目を使い、声だけ言語別にする。同一キャラクター内の `locale` 重複は拒否する。詳細は [../multilingual-voice/spec.md](../multilingual-voice/spec.md) を正とする。
- 外観の画像は ready な画像 Asset だけを使う。保存時に存在・種類・状態を検証する。
- 削除は常に可能（台本はコピーを持つだけなので参照ガードは不要）。ただし声プロファイルを参照している間は、その声プロファイル側の削除を拒否する。外観が `faceSetId` で参照している間は、その Face Set 側の削除を拒否する。

## 台本への取り込み

- 「ライブラリから追加」は、ライブラリのキャラクターを**新しいローカルIDでコピー**する。外観もコピーし、`voices` と `names` を引き継ぐ。話者の声には、当該 Edition の locale に一致する `voices` の声プロファイルを束ねる。一致する声がなければ声未設定とする。`Character.name` と自動生成する `Speaker.name` には、当該 Edition の locale に一致する `names` の名前を使い、一致がなければ既定の `name` を使う。
- ライブラリ側の変更は既存台本のコピーへ波及しない。後から別名を追加しても、取り込み済みの台本には反映されない。既存の版は作品内の名前編集、`script.save`、または「ライブラリから更新」で直す。
- 外部エージェントも同じコピー規則を操作コアの `character.addFromLibrary` で使う。Agent Access はライブラリの読み取り（`character.list` / `character.get`）、このコピー、声の付け替え（`character.setVoices`）、作成・部分更新（`character.create` / `character.update`）、および外観の 1 件追加・1 件部分更新（`character.addAppearance` / `character.updateAppearance`）を公開する（[../agent-access/spec.md](../agent-access/spec.md)、[ADR 0099](../adr/0099-agent-character-library-writes.md)、[ADR 0105](../adr/0108-agent-character-appearance-diff-operations.md)）。削除と Face Set・Theme の管理は公開しない。
- エージェント向けの外観は作成時 `{ assetId, expression, pose, label?, faceSetId? }` で受け、外観 ID はサーバーが生成する。更新時に既存の外観を残す場合は `id` を付けて送り、作品コピーの `libraryAppearanceId` リンクを保つ。`id` を省略した外観は新規として扱う。エージェントが台詞の表情を選ぶときは、作品の `faceSetVersion` を `faceSet.get` に渡して固定版の `expressions[].id` を読む。ライブラリの外観 ID は、コピー元の対応付けにだけ使う内部キーである。HTTP API の作成・更新契約は外観 ID を要求し、エージェントの作成はサーバーが生成する。エージェントの更新は既存の外観に `id` を付けた場合だけその ID を維持する。
- 「声だけの話者を追加」は、外観を持たない台本ローカルのキャラクターを作る。立ち絵とは無関係に声だけ出演するナレーターとして使える。
- 台本内のキャラクターは、名前と声プロファイルを作品ごとに編集できる。外観も作品内で追加・編集・削除できる（コピーなのでライブラリや他作品へは波及しない）。ライブラリは再利用のためのテンプレートとして位置づける。
- 外観の表示名 `label` は、立ち絵などの選択肢で `label`（表情 / ポーズ）として表示する（`label` が無ければ表情 / ポーズのみ）。
- 台本のセリフは**キャラクター**を選ぶ。話者（Speaker）はデータ上は残るが、UIからは直接編集せず、キャラクター選択に応じて自動で対応付ける。

## 話者との関係

- `Speaker` は音声上の主体であり、ContentDocument の構造として引き続き存在する。キャラクターと1対1で自動生成し、当該 Edition の locale に一致するキャラクターの声プロファイルを話者へ反映する。
- 既存のキャラクターを持たない話者（ナレーター）と、それを参照するセリフは非破壊で保持する。TTS は保存済みの声プロファイルで引き続き生成できる。
- 同じ locale に複数の声を持たせることはできない。別の声が必要な場合は `voiceId` の上書き、またはキャラクターを複製して対応する。

## TTS との関係

- セリフの読み上げテキストはリクエストで直接渡せる（[../tts/spec.md](../tts/spec.md)）。未保存の編集内容でも生成でき、生成後に明示保存すると1つの版にまとまる。
