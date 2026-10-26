# テーマのフォント指定を locale 別に上書きできるようにする

加算拡張。`themeDefinitionSchemaVersion` 据え置きの方針は ADR-0094 と同型。

Theme のテキストスタイルに、locale 別の fontFace 上書き辞書 `fontFaceByLocale` を加算する。既存の `fontFace`（共通指定）は ja-JP / en-US を含む「既定 locale 用の指定」として扱い、対象 locale に対応する上書きがあればそちらを優先する。フォールバックスタックも document locale 由来に差し替える。

- 加算・非破壊: `textStyleSchema` に `fontFaceByLocale: Partial<Record<SupportedLocale, FontFaceSpec>>`（optional、該当ロケールがない場合は空でもよい）を加える。`themeDefinitionSchemaVersion` は 2 のまま据え置き（ADR-0094 と同型）。既存の `definitionJson`・組み込みテーマ定義はそのままパースが通り、解決結果も変わらない。
- 優先順位: role の font 解決は `fontFaceByLocale[document.locale]` → `fontFace`（共通指定）→ locale 依存のカテゴリスタックの順。共通の「指定 Font Face」で ja/en 向けに選んだ意図を壊さない一方、中国語版では zh 用の指定が明示的に勝てる。zh 用の指定がない場合は共通指定に落ちる。
- locale 別カテゴリスタック: `THEME_FONT_STACKS` を locale 由来にする。`zh-Hans` は `PingFang SC` / `Noto Sans SC` 等の簡体字向け、`zh-Hant` は `PingFang TC` / `Noto Sans TC` 等の繁体字向けの CJK スタックをカテゴリ（sans/serif/mono）ごとに持つ。ja-JP・en-US のスタックは現状維持。
- UI 粒度: テーマ編集画面のすべてのロール（title / subtitle / heading / body / closing / caption / label / code）の「指定 Font Face」に locale タブを足す。ロール単位で先出しはしない（スキーマの加算対象も全ロール一律）。
- 適用範囲: `textStyleSchema` を解決する全テンプレート・話者字幕・サムネイルの headline/subline。document locale が zh 系の作品は title/caption がすべて locale に合った字形で描ける。
- 診断の表示箇所: 欠字形・字形カバレッジ不足の警告はレンダー前チェック（`createRenderJob` のテーマ診断）で出す。編集画面の常時検査は重くならないよう行わず、テーマ編集画面に文脈の診断は置かない。

## Context

zh-Hans / zh-Hant の言語版追加後、レンダーの字形選択は現在 `THEME_FONT_STACKS`（日本語前提の `Noto Sans JP` 等）とロール単位の fontFace 指定のみである。簡体字には `Noto Sans JP` の欠字形が多く、欠字形はシステム既定フォントへ落ちて混ざって見える。繁体字は字形自体が JP 字形（骨・直・住の旁の違いなど）になり、中国語として不格好である。言語別フォント診断・テーマ別フォントは `docs/multilingual-editions/spec.md` で対象外としてきたが、中国語を定点的に作る段階になったため、テーマ契約として locale 別の字形選択を許す。

テーマは edition 単位で `document.visualTheme`（id@version）を指せるが、「同じ見た目のままフォントだけ言語で変える」を満たすにはテーマ複製ではなく、フォント指定の上書き辞書が正本 JSON の編集意図（作品ロジックには触れず、見た目はテーマに寄せる）に合う。

## Considered Options

- **ロール単位の locale 辞書上書き（採用）** → 共通指定（ja/en 向け選択）の意味を変えず、locale 別の指定があれば勝たせられる。テーマ編集 UI は「文字スタイルの Font Face」に locale タブを足すだけで Font Catalog 選択の既存 UX を流用できる。静的 HTML 化の前提も、`resolveFontFamilyCss` が document locale を引数に取るだけの変化で保てる。
- **テーマ定義を locale ごとに複製する（zh 版で別テーマ参照）** → edition が別 id@version を指せば機械的には可能だが、「同じテーマの設計・違う字形」という意図が id 分散になり、色など他の共通変更がバラける。字形だけの差分を表現できないため不採用。
- **locale 優先で共通 fontFace を迂回する（zh では共通指定を無視し locale スタックまで落とす）** → 意図せず字形品質が上がるが、作者が ja 向けに選んだ指定の意味が locale で変わる説明が難しく不採用。zh 用指定なしの場合の品質は警告診断で担保する。
- **アプリ同梱 webfont（Noto Sans SC/TC をバンドル・@font-face）** → 出力の再現性は最も高いが、フォント容量・ライセンス確認・レンダーパイプラインの統合が要る。OS が見る実装フォントで足りる現段階では過剰。将来の再現性課題として残す。

## Consequences

- テーマカスタマイズの正（`docs/theme-customization/` にある spec）に `fontFaceByLocale`（v2 加算・`themeDefinitionSchemaVersion` 据え置き）と locale 依存のカテゴリスタックを追記する。
- `docs/multilingual-editions/spec.md` の「言語別フォント診断・テーマ別フォントは対象外」を「locale 別 fontFaceByLocale と locale 依存スタックで解決する」に更新する。ADR-0090 の文字幅推定（locale による基準の切り替えなし）は変更しない。
- コンパイラ・サムネイル・文字スタイル解決は `document.locale` を引数に取る。ja 作品の出力は変わらず、zh 系は「スタック差し替え＋指定時の上書き」の分だけ字形が改善する。
- Font Catalog は OS にインストール済みフォントに依存するため、zh 向けフォント（`PingFang SC/TC` は macOS 既存、`Noto Sans SC/TC` は要インストール）は診断で不足を警告する。実装フェーズで診断メッセージを設計する。
- webfont 同梱は見送り。ローカルレンダー前提で再現性を上げたくなったら新しい ADR で判断する。
