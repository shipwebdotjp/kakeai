# 字幕の話者名表示は作品設定、見せ方は Theme/Skin に分担する

`amends ADR-0092`

焼き込み字幕に話者名タブを出せるようにする。表示可否は作品（ContentDocument）が持ち、見せ方は Theme が持ち、Skin は装飾だけを持つ。SRT には話者名を出さない。

- 作品: `caption.showSpeakerName: boolean`（既定 `false`）。焼き込み専用。セリフごとの上書きは持たない。名前は `Speaker.name`（言語版作成時に解決済み）を描画時に引く。`speakerId: null` と空名はタブなし。
- Theme v2（加算・`themeDefinitionSchemaVersion` 据え置き）: `caption.layout: "frame" | "band"`（既定 `frame`）と `caption.speaker: { text, surface }`（既定は 20px・太字・白・`#1B2740` 85%・上下4左右16・角丸8）。`frame` は既存の2行枠、`band` は下端全幅の3行帯。タブはどちらの上端にも左寄せで重ね、ON/OFF で行数予算とセーフエリアを変えない。
- Skin: 行数・セーフエリアを変えない。今回は全 Skin で Theme 駆動の neutral 描画に fallback し、紙・テープ等の Skin 固有装飾は将来の Skin 新版で足す。
- SRT・警告: SRT は `captionText` のみで変更なし。行数警告は当面2行のまま（band の3行目も警告する保守側）。

## Context

ADR-0092 は「台本の真偽値ではなく Skin の描写規則」とし、実装を見送った。その後、作品ごとに ON/OFF を選びたい需要と、2行セーフエリアを変えずに上部へ重ねる見せ方が固まった。「出すか」と「どう見せるか」を分けていなかったため、台本真偽値を一律に退けていた。

## Considered Options

- **作品共通設定 + Theme/Skin 描画（採用）。** → 編集意図が1箇所に集まり、テーマ共有・SRT 一致・レイアウト安定を両立できる。セリフごとの例外は要否が明確になってから話者単位で足せる。
- **セリフごと（+Scene/話者上書き）。** → 会話シーンだけ出す用途には合うが、データが冗長になり表示が揺れる。主軸ではなく上書き層向きのため今回は不採用。
- **Skin の字幕バリエーションに表示可否を持たせる。** → 作品ごとの ON/OFF がテーマ複製になり、SRT（二重管理）・セーフエリア（Skin 依存）が複雑になるため不採用。
- **字幕テンプレート新設。** → 将来の拡張余地は最大だが、入力契約・registry・選択スコープの設計が要り、今回の ON/OFF には過剰のため不採用。

## Consequences

- `content-schema.md` に `caption.showSpeakerName`（加算・`schemaVersion: 1` 据え置き）を追記する。
- `theme-customization/spec.md` に `caption.layout`・`caption.speaker`（v2 加算）を追記する。既存テーマは `frame` + 既定話者スタイルに解決し、見た目は変わらない。
- `visual-skins/spec.md` に「行数・セーフエリアは変えず、今回は Theme 駆動へ fallback」を追記する。
- `subtitle-export/spec.md` の「話者名は含めない」を維持し、焼き込み専用であることを追記する。
- セーフエリアは `frame: 216px`（既存）、`band: 224px`（3行）をテーマから導出する。タブは重ねのため高さに含めない。
