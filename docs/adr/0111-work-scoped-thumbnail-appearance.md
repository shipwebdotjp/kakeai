# サムネイル外観はWorkが所有し、Font Faceはlocale別に持つ

Status: amends [ADR-0084](./0084-thumbnail-appearance-overrides.md), [ADR-0085](./0085-thumbnail-appearance-presets-as-snapshots.md)

サムネイル候補は言語版ごとに管理する一方、作品としての見た目の一貫性を保つため、サムネイル外観の所有先を Language Edition から Work へ移す。Work の外観は候補の次回プレビュー／PNG生成時にライブで適用し、外観の変更を既存候補へ即座に反映する。多言語版で同じ外観を共有するため、Font Face は外観内の locale 別指定にする。

## 決定

- `Work` に `thumbnailAppearanceJson` を追加し、`LanguageEdition.thumbnailAppearanceJson` を削除する。候補（`Thumbnail`）は引き続き Language Edition に属する。
- 解決順は `EditionのVisual Theme → Workの共通外観 → 候補固有の明示上書き → テンプレートの構図・倍率` とする。候補固有の上書きがない項目は、Work 外観の変更に追従する。
- Work 外観は候補の保存済み値へコピーせず、プレビューとPNG生成のたびに読み直す。候補を保存し直さなくても、次の表示から新しい Work 外観が使われる。
- Thumbnail Appearance の見出し・補足文は `fontFaceByLocale: Partial<Record<SupportedLocale, FontFaceSpec>>` を持ち、単一の `fontFace` 上書きを廃止する。該当 locale のエントリがなければ、Theme の `fontFaceByLocale`、次に Theme の共通 `fontFace`、最後に locale 依存のフォールバックスタックを使う。
- locale 別 Font Face のマージは locale キー単位で行う。候補が同じ locale を指定した場合だけ Work の値を上書きし、他の locale は Work の指定を残す。
- 外観プリセットは残し、適用先を Work 共通外観の下書きへ変える。適用は従来どおりスナップショットで、プリセットの後日の変更は適用済み Work へ波及しない。
- 他言語版からの候補取り込みは、候補名・文言・テンプレート・素材参照・切り出し／配置設定を新規候補フォームへ複製する。元候補の外観上書きは複製せず、保存時に取り込み先の Work 外観を適用する。
- 外観APIは `GET/PUT /works/:workId/thumbnail-appearance?languageEditionId=...` とする。Edition ID は Theme と locale の解決文脈にだけ使い、Edition が Work に属することを検証する。エージェントの読み取りは Edition を受け取り、その文脈で Work 外観を解決して返す。
- Thumbnail 文書を v3 とし、v1/v2 の読み取り互換は設けない。DB 更新で旧 Thumbnail 候補、Edition の外観値、旧形式の外観プリセットを破棄し、Work・Edition・ScriptVersion・Asset は保持する。

## Considered Options

- 言語版ごとに外観を持ち続け、取り込み時にコピーする。→ 同じ作品の言語版で見た目がずれ、共通の見た目を直すたびに全言語版を編集する必要があるため不採用。
- 解決済みの外観を各候補へ保存する。→ Theme 変更への追従と Work 外観のライブ反映が失われるため不採用。
- Font Face を単一のまま、Work の代表 locale だけで決める。→ 言語ごとに適切な字形のフォントが異なり、他言語版で意図しないフォントが使われるため不採用。
- 旧 Edition 外観を Work へ移行する。→ どの Edition の値が正か決められず、旧候補の Font Face も新契約と互換でないため、pre-1.0 の割り切りとして破棄する。

## Consequences

- 作品内の言語版は同じサムネイル外観を共有する。言語ごとの差は locale 別 Font Face と候補固有の上書きで表現する。
- Work 外観の変更は、候補固有の上書きがない項目について既存候補の次回プレビュー／PNGへ即座に反映される。
- 旧候補と旧プリセットは DB 更新で消える。復元や読み取り互換は提供しない。
- 動画の Visual Theme 設定は変更せず、サムネイル外観だけを Work 単位で編集する。
