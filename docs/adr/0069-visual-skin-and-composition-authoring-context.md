# Visual ThemeからVisual Skinを参照し、AIにはStyle Kitを渡す

Visual Themeはtokenだけでなく、アプリ同梱で不変なVisual Skinをversion付きで参照する。VisualTemplateはSkin対応rendererを持つときだけ世界観に合わせ、未対応時はTheme token付き`neutral@1`へfallbackする。AIが作るCompositionには、解決済みTheme・Skin・Style Kit・Font診断からなるComposition Authoring Contextをloopback API経由で渡し、publish済みCompositionVersionにはその来歴を固定する。これにより、任意CSS／任意HTMLをThemeへ持ち込まず、TemplateとAI Compositionの世界観を揃えられる。

## Considered Options

- Theme tokenだけで表現する。→ 色と書体は揃うが、紙、テープ、ネオンなどTemplate横断の描写文法を表せないため不採用。
- 各VisualTemplateへ世界観を固定で実装する。→ 同じ世界観を複数Templateへ重複実装し、作品単位の選択・AIへの共有ができないため不採用。
- ユーザー素材だけで世界観を作る。→ サイズや内容に追従する枠・装飾を一貫して扱えず、毎回の編集負荷が高いため不採用。
- AIへ文章のpromptだけを渡す。→ 素材・CSS部品・正確なfont aliasが共有されず、Compositionごとに世界観が揺れるため不採用。

## Consequences

- SkinのrendererとStyle Kitはアプリ管理のtrustedな版付き資産であり、利用者が任意コードとして作成・importできない。
- 既存Themeは暗黙に`neutral@1`へ解決し、ContentDocumentのTheme Ref形状と既存CompositionVersionを変えない。
- Style KitはComposition bundleへコピーされ、AIはKakeaiの共有ファイルパスを参照しない。Kit改変はpublish時に拒否する。
- 同一Macのローカルレンダーでは、Font ResolverがHyperFrames Chromiumで診断した`@font-face local()` aliasを使う。別Mac・Docker・クラウドへの完全なfont再現は、この決定の対象外とする。
