# ライブラリ Character の更新は明示的な取り込みとし、作品内の ID を維持する

> [ADR-0026](./0026-character-library-copy-semantics.md) のコピー意味論に「明示的な更新」を追加する。

ライブラリの Character を作品へコピーしたとき、元の Character / Appearance の ID を `libraryCharacterId` / `libraryAppearanceId` として作品の `ContentDocument` に記録する。ライブラリ側の変更は従来どおり自動では波及しない。作品編集画面の「ライブラリから更新」を人が実行したときだけ、ライブラリの最新の名前・言語別名・声・外観と、外観が参照する Face Set の最新改訂版を取り込む。

## 決定

- 取り込みは作品内の Character・Speaker・Appearance のローカル ID を維持する。立ち絵 Cue は Appearance ID を参照しているため、ID を変えない。
- ライブラリ Appearance との対応は `libraryAppearanceId` で行う。ライブラリで削除された Appearance は作品内に残し、`libraryAppearanceId` を外して未リンク化する。新しく追加された Appearance は新しいローカル ID で追加する。
- 作品内で手動追加した Appearance（`libraryAppearanceId` が null）は更新対象にしない。
- この更新は Web UI の明示操作に限り、エージェント操作としては公開しない。名前・言語別名・声・外観の差分を確認画面に表示し、1 Character 単位でまとめて適用する。声の変更は今後の TTS にだけ効き、生成済みの Take は変えない。
- 更新で固定先の Face Set 改訂版が変わり、台詞の `expressionId` が新しい版に存在しない場合は `null`（normal）に戻す。影響する台詞を確認画面に全件表示する。通常の保存・レンダーでは暗黙の代替をせず、従来どおり 422 で拒否する。
- `libraryCharacterId` を持たない既存作品（この決定より前にコピーされた作品）は更新対象外とする。自動推定で紐づけない。
- エージェントは作品の `appearances[].faceSetId` / `faceSetVersion` を読み、`faceSet.get` に版を指定して表情 ID を選ぶ。最新版の ID を固定版の作品へ書き込まない。

## Considered Options

- ライブラリ変更を全作品へ自動反映する。→ 作品ごとの調整を失い、保存済み作品が予告なく変わるため不採用。
- 更新時に Character を削除して再コピーする。→ ローカル ID が変わり、話者・立ち絵・台詞の参照を付け替える必要があるため不採用。
- 外観をライブラリ ID のままグローバル参照にする。→ 作品固有の外観編集と台本の自己完結性を失うため不採用。
- 既存作品を名前や画像の一致で自動的にリンクする。→ 同名・同画像の別キャラクターを取り違える危険があるため不採用。

## Consequences

- 作品 JSON に `libraryCharacterId` / `libraryAppearanceId` / `faceSetVersion` が加わる。`schemaVersion` は `1` のまま（加算的拡張）。
- リンクは作品の来歴情報であり、レンダーには使わない。リンクが切れても作品の表示は変わらない。
- ライブラリ Character を削除しても作品は残る。更新ボタンはリンク切れとして無効になる。
- 旧作品は最新版へ移せない。必要になった時点で、明示的な紐づけ操作を新しい ADR で追加する。
