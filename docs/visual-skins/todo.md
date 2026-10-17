# Visual Skin 実装TODO

[仕様](./spec.md)を正とする。SkinはTheme、VisualTemplate、Composition Libraryをまたぐため、上から順に進める。各実装フェーズでは`npm run typecheck`、`npm test`、OCRレビュー、コミットを行う。

## S1: Skin契約とneutral互換

- [x] `VisualSkinRef`、app管理Skin registry、Skin version、TemplateごとのSkin renderer登録契約を`packages/contracts`と`packages/video`へ追加する
- [x] Theme Definition Schema v2に`skin`を追加し、v1のskin欠落を`neutral@1`へ解決する互換規則を実装する
- [x] `neutral@1`を既存rendererと同じ出力意味で登録し、すべての既存VisualTemplateにfallbackを持たせる
- [x] Render Context、Theme preview、Render Job snapshotへ解決済みSkin Refを接続する。ContentDocumentの`visualTheme`形状は変えない
- [x] テスト: v1 Theme互換、未知Skin拒否、Skin未対応Templateのneutral fallback、snapshot固定
- [x] 完了条件: 既存ScriptVersionとJobを変えずに、新しいTheme RevisionがSkinを明示選択できる

## S2: `handmade-paper@1`とTheme選択

- [ ] `handmade-paper@1`のtrusted rendererと部品を追加する。初期対象はScene背景、`text.block@1`、`media.card@1`、`list.callout@1`、`quote@1`に限定する
- [ ] 紙、テープ、破れ縁、控えめなshadow、有限の貼り付けmotionを、Template入力を増やさずにSkin実装へ閉じる
- [ ] Skin未対応の表、グラフ、フロー、stat、端末枠、立ち絵がneutral fallbackになることを確認する
- [ ] Theme Draft／公開revisionの編集画面にSkin選択を追加する。Skin自体の作成・編集UIは追加しない
- [ ] 代表Theme previewに、初期対象5表現とSkin未対応fallbackを含める
- [ ] テスト: Skin描画の回帰、Cue明示上書き優先、Template入力・Cue range・AnimationPlan境界の維持
- [ ] 完了条件: `handmade-paper@1`を選ぶThemeで、通常の解説動画のタイトル、画像、3要点、引用が一貫した紙の世界観になる

## S3: Style KitとComposition Authoring Context

- [ ] Skinごとの不変Style Kit（`STYLE.md`、CSS、SVG／画像、lock）とhash計算を追加する
- [ ] `POST /composition-authoring-contexts`を追加し、公開Theme RevisionとCanvas Profileから非永続Contextを返す
- [ ] `POST /compositions`の`authoringStyle`入力を追加し、Style Kit付きDraftをseedする
- [ ] Draft read-back、更新、dry-run publish、publishでKitの相対path・サイズ上限・hash検証を接続し、改変を`STYLE_KIT_MODIFIED`で拒否する
- [ ] `CompositionStyleProvenance`をDraft／publish済みCompositionVersionへ保存し、既存Compositionは`legacy`または`neutral`互換として読めるようにする
- [ ] `skills/kakeai-composition/SKILL.md`とスターターをContext取得、Kit利用、ローカルfont alias、Style QAの手順へ更新する
- [ ] テスト: Context無永続性、同じ入力のKit hash安定、seed／read-back、Kit改変拒否、provenance不変性、旧Composition互換
- [ ] 完了条件: Kakeai外で動くCLI agentがloopback APIだけを使い、Skinに沿う自己完結Composition bundleを作成・QA・publishできる

## S4: Font診断と互換性表示

- [ ] Font CatalogへChromium用の検証済みlocal face nameを追加し、ThemeのFont Faceから安全な`fonts.css`を生成する
- [ ] Context生成、draft preview、publish前、render投入前のFont診断とfallback警告を追加する
- [ ] Composition selectorと詳細画面にStyle Provenanceを表示し、Script VersionのSkinと異なるCompositionへ警告を出す
- [ ] テスト: family名と正確なlocal face nameの区別、`@font-face local()`のChromium解決、欠落時fallback、Skin不一致警告
- [ ] 完了条件: 同一macOSで選択した手書きFont Faceを、agent生成CompositionとKakeai rendererが安全に共有できる

## S5: 文書・回帰・手動確認

- [ ] [spec.md](./spec.md)、Theme／Composition仕様、API契約、MVPロードマップ、CONTEXT、ADR、ユーザーガイドを同期する
- [ ] `handmade-paper@1`で、タイトル、画像カード、3要点、引用、Skin未対応の表を含む代表動画をpreview／MP4 renderする
- [ ] OCRレビューを最大3回実行し、正当な指摘だけを修正する
- [ ] 完了条件: Theme変更、Composition authoring、既存作品のpreview／renderが相互に回帰しない
