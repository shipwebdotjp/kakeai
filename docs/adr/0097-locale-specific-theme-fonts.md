# テーマのフォント指定を locale 別に上書きできるようにする

加算拡張。`themeDefinitionSchemaVersion` 据え置きの方針は ADR-0094 と同型。

Theme のテキストスタイルに、locale 別の fontFace 上書き辞書 `fontFaceByLocale` を加算する。既存の `fontFace`（共通指定）は ja-JP / en-US を含む「既定 locale 用の指定」として扱い、対象 locale に対応する上書きがあればそちらを優先する。フォールバックスタックも document locale 由来に差し替える。適用範囲は信頼済みテンプレート（trusted video templates）、話者字幕、サムネイルとする。AI Composition（Style Kit 生成）は生成コンテキストに locale を持たないため対象外とし、対応は別フェーズで判断する。

- 加算・非破壊: `textStyleSchema` に `fontFaceByLocale: Partial<Record<SupportedLocale, FontFaceSpec>>`（optional）を加える。`themeDefinitionSchemaVersion` は 2 のまま据え置き（ADR-0094 と同型）。既存の `definitionJson`・組み込みテーマ定義はそのままパースが通り、解決結果も変わらない。
- 正規化: Zod では列挙キーの部分 Record として検証し、未知 locale のキーを拒否する。最後のエントリを消したときは `{}` を保存せず `fontFaceByLocale` 自体を省略する（空辞書と未指定を同義にし、Draft 差分やテーマ hash の無駄な差を防ぐ）。Font Catalog は UI が選択肢を出す根拠であり、保存・公開時に未検出 face を拒否する根拠にはしない（既存の欠落時 fallback 方針を維持）。`FontFaceSpec.fallbacks` は今回 CSS 出力で使用しない。有効化する場合は `platformId → family → fallbacks → locale 依存スタック` の解決順を別途決める。
- 優先順位（trusted テンプレート・話者字幕）: Cue の明示 `fontFace` 上書き → `fontFaceByLocale[document.locale]` → ロールの `fontFace`（共通指定）→ locale 依存のカテゴリスタック。`font` カテゴリは Cue 指定があればそれを使う。共通の「指定 Font Face」で ja/en 向けに選んだ意図を壊さない一方、中国語版では zh 用の指定が明示的に勝てる。zh 用の指定がない場合は共通指定に落ちる。
- サムネイル: 解決順は「候補 Appearance の明示 fontFace → Edition 共通 Appearance の fontFace → Theme の `fontFaceByLocale` → Theme の共通 fontFace → locale 依存スタック」。`resolveThumbnailAppearanceDefaults` と `compileThumbnail` は Language Edition の locale を受け取るようにする。Appearance の明示指定が Theme の locale 指定より強いため、既存の日本語用サムネイル設定が中国語版を再び上書きしない。
- 話者名タブ: `caption.speaker.text` も `TextStyle` であり対象に含める。テーマ編集 UI の locale タブは話者名スタイルにも付ける。
- locale 別カテゴリスタック: `THEME_FONT_STACKS` を locale 由来にする。`zh-Hans` は `PingFang SC` / `Noto Sans SC` 等の簡体字向け、`zh-Hant` は `PingFang TC` / `Noto Sans TC` 等の繁体字向けの CJK スタックをカテゴリごとに持つ。`mono` は Latin 等幅フォントの後・generic `monospace` の前に SC/TC 向け CJK フォールバックを置く（generic に直落すると中国語の字形が OS 任せになるため）。ja-JP・en-US のスタックは現状維持。
- `lang` 属性: 動画とサムネイルの HTML は現在 `<html lang="ja">` 固定。動画は ContentDocument locale、サムネイルは Language Edition locale を出力する。
- UI 粒度: テーマ編集画面のすべてのロール（title / subtitle / heading / body / closing / caption / label / code）と話者名スタイルの「指定 Font Face」に locale タブを足す。ロール単位で先出しはしない（スキーマの加算対象も一律）。
- 診断の表示箇所: 警告はレンダー前チェック（`createRenderJob` のテーマ診断）で出す。編集画面の常時検査は重くならないよう行わない。

## Context

zh-Hans / zh-Hant の言語版追加後、レンダーの字形選択は現在 `THEME_FONT_STACKS`（日本語前提の `Noto Sans JP` 等）とロール単位の fontFace 指定のみである。簡体字には `Noto Sans JP` の欠字形が多く、欠字形はシステム既定フォントへ落ちて混ざって見える。繁体字は字形自体が JP 字形（骨・直・住の旁の違いなど）になり、中国語として不格好である。言語別フォント診断・テーマ別フォントは `docs/multilingual-editions/spec.md` で対象外としてきたが、中国語を定点的に作る段階になったため、テーマ契約として locale 別の字形選択を許す。

テーマは edition 単位で `document.visualTheme`（id@version）を指せるが、「同じ見た目のままフォントだけ言語で変える」を満たすにはテーマ複製ではなく、フォント指定の上書き辞書が正本 JSON の編集意図（作品ロジックには触れず、見た目はテーマに寄せる）に合う。

## Considered Options

- **ロール単位の locale 辞書上書き（採用）** → 共通指定（ja/en 向け選択）の意味を変えず、locale 別の指定があれば勝たせられる。テーマ編集 UI は「文字スタイルの Font Face」に locale タブを足すだけで Font Catalog 選択の既存 UX を流用できる。静的 HTML 化の前提も、`resolveFontFamilyCss` が document locale を引数に取るだけの変化で保てる。
- **テーマ定義を locale ごとに複製する（zh 版で別テーマ参照）** → edition が別 id@version を指せば機械的には可能だが、「同じテーマの設計・違う字形」という意図が id 分散になり、色など他の共通変更がバラける。字形だけの差分を表現できないため不採用。
- **locale 優先で共通 fontFace を迂回する（zh では共通指定を無視し locale スタックまで落とす）** → 意図せず字形品質が上がるが、作者が ja 向けに選んだ指定の意味が locale で変わる説明が難しく不採用。zh 用指定なしの場合の品質は警告診断で担保する。
- **アプリ同梱 webfont（Noto Sans SC/TC をバンドル・@font-face）** → 出力の再現性は最も高いが、フォント容量・ライセンス確認・レンダーパイプラインの統合が要る。OS が見る実装フォントで足りる現段階では過剰。将来の再現性課題として残す。

## Consequences

- テーマカスタマイズの正（`docs/theme-customization/spec.md`）に `fontFaceByLocale`（v2 加算・`themeDefinitionSchemaVersion` 据え置き）と locale 依存のカテゴリスタックを追記する。
- `docs/multilingual-editions/spec.md` の「言語別フォント診断・テーマ別フォントは対象外」を「locale 別 fontFaceByLocale と locale 依存スタックで解決する」に更新する。ADR-0090 の文字幅推定（locale による基準の切り替えなし）は変更しない。
- コンパイラ・サムネイル・文字スタイル解決は `document.locale` を引数に取る。ja 作品の出力は変わらず、zh 系は「スタック差し替え＋指定時の上書き」の分だけ字形が改善する。
- 診断の意味は「字形カバレッジの実測」ではない。現在の Font Catalog は face の存在と Chromium での解決可否までしか判定できないため、警告は「document locale が zh 系で zh 用の指定がなく共通 fontFace のみが使われるロールがある」という字形不一致リスクの指摘とする。診断対象は `THEME_TEXT_ROLES` の8ロールに `caption.speaker.text` を加え、解決済み（locale 適用後）の fontFace を見る。Render Job は解決済み Theme Definition を snapshot 化しているため、locale を診断入力に追加しても不変性の設計と整合する。
- テーマ代表サンプルプレビューは現在 `ja-JP` 固定（`theme-preview`）。プレビュー locale の選択と、簡体字／繁体字の判別用サンプル文を追加する。locale タブで中国語を選んでも、プレビューで確認できない状態のままにはしない。
- Font Catalog は OS にインストール済みフォントに依存する。zh 向けフォント（`PingFang SC/TC` は macOS 既存、`Noto Sans SC/TC` は要インストール）をスタックの先頭に置くが、カタログに存在しない環境では次の family / generic へ落ちる（保存・公開は拒否しない）。
- AI Composition の Style Kit は locale を持たないため対象外。locale を扱う Style Kit（生成コンテキスト・Style Provenance・fonts.css の locale 化）は需要が固まってから別 ADR で設計する。
- webfont 同梱は見送り。ローカルレンダー前提で再現性を上げたくなったら新しい ADR で判断する。
