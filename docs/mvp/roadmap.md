# ロードマップ

## 方針

段階ごとに、前段で確立した正本データとJobの枠組みを利用する。AIや外部サービスの出力は、不変の Asset または新しい Script Version として保存し、常に人が確認・巻き戻しできる形で扱う。台本編集・素材割り当て・素材取り込み・レンダー投入のような可逆な操作は AI が直接実行してよい。実体の削除・外部公開・課金を伴う生成などの不可逆な操作は人に限る（[ADR 0074](../adr/0074-agent-direct-reversible-operations.md)、[Agent Access](../agent-access/spec.md)）。利用者が設定済みのループバック TTS Adapter への合成 Job は、生成 Asset と Script Version を戻せるため可逆な操作に含む（[ADR 0077](../adr/0077-agent-tts-on-configured-adapters.md)）。

優先順位は「手作業でも再現可能な動画制作」から「編集表現の拡張」、「制作の一部自動化」、「複数言語・派生コンテンツの量産」へ進める。

正式リリース（`1.0.0`）前の開発段階では、テンプレート版と `schemaVersion` の破壊的変更を許容し、移行コードを持たない（[../adr/0034-destructive-changes-before-1-0.md](../adr/0034-destructive-changes-before-1-0.md)）。`1.0.0` 以降は版追加と移行の規律へ戻る。

## Phase 0: MVP — ローカル日本語動画制作（実装完了）

詳細は [spec.md](./spec.md) を参照。実装フェーズと完了状況は [todo.md](./todo.md) を正とする。

- 横型解説動画の可変Sceneテンプレート、手動素材、手動立ち絵、セリフ単位の手動音声候補、作品全体BGM、プレビュー、MP4出力を提供する。
- 新規作品は導入、要点1件、結びで開始し、要点Sceneを追加・削除・並べ替えできる。背景とカードは各Sceneに各1件、立ち絵は各Sceneに1体指定できる。
- `Work`、`LanguageEdition`、`ScriptVersion`、`Asset`、`Job`、`Artifact` をテーブルとして確立する。`NarrationSegment` は独立したテーブルではなく `ScriptVersion.contentJson` 内の構造として持つ。
- `ja-JP` だけを有効化し、単一Mac上でSQLite、ローカル保存、ローカルワーカーを動かす。

完了条件：外部サービスなしに、保存済みの日本語作品を繰り返し編集、プレビュー、レンダーできる。

既知の未達：`health.storage.status` の容量警告（80GiB閾値）のみ。詳細は [todo.md](./todo.md) の「MVP後」を参照。

## Phase 1: 編集表現の拡張

- 背景・カードに画像・動画・アプリ管理の複合ビジュアル（Composite Visual Template）を置く基盤は [../composite-visuals/spec.md](../composite-visuals/spec.md) で実装済み（VisualCue の `layer`/`order`/`transition`、`NestedVisual` 再帰、`scene.device-frame@1`、Cue一覧UI、テンプレート `inputFields` による汎用エディタ、有限presetの `AnimationPlan`）。
- AIが作る全画面・無音のHyperFrames projectを、Assetではなく不変のCompositionVersionとしてpublishし、Composition背景にnative nested compositionとして置くComposition Libraryを追加する。v1の詳細と将来のslot・複数instance・音声・外部project対応は [../composition-library/spec.md](../composition-library/spec.md) と [../composition-library/roadmap.md](../composition-library/roadmap.md) を正とする。
- 背景とカードの正規化した焦点位置と拡大率を編集する（[../focal-point/spec.md](../focal-point/spec.md) と [../media-zoom/spec.md](../media-zoom/spec.md) で実装済み。`focalPoint` の編集・中央リセット、メディアの拡大率と等倍リセット）。
- 1 Scene内の複数VisualCue、表示順、セリフ区間・offset区間を編集する。
- Scene別BGM、複数BGM、SFX、より高度な音声ミックスを追加する。
- セリフ前の間、Scene単位の非ナレーション音声、動画と埋め込み音声を同期して再生するインサートSceneを、[セリフ間・Scene音声・インサートScene](../timeline-inserts/spec.md)のR1→R2→R3の順に追加する。通常の背景・カード動画は無音のままとする（[ADR-0067](../adr/0067-insert-scene-owns-embedded-video-audio.md)）。
- 複数立ち絵、セリフ区間・offset区間ごとの立ち絵切替、口パクを追加する。台詞ごとの表情切替は [../face-expression/spec.md](../face-expression/spec.md) を正とする（グローバルな Face Set ライブラリ、`character.standing@1`、`NarrationSegment.expressionId`。再レンダー差異の許容は [ADR-0045](../adr/0045-face-set-global-reference.md)）。
- 有名な投稿サイト・技術サイト・ブラウザのガワに画像・動画を収めるサイトモックアップ（フレーム型）は [../site-mockup/spec.md](../site-mockup/spec.md) で実装済み（`scene.site-mockup@1`、variantの加算的追加を許容、汎用スタイル＋利用者ロゴ）。
- 見た目の既定値を提供するVisual Theme基盤は [../visual-themes/spec.md](../visual-themes/spec.md) で実装済み（`soft-editorial@1` を全作品で固定、Sceneアクセントのテーマ3色／自由色、Cue明示値が常に優先）。二つ目のテーマとWorkごとの選択UIは将来のテーマ追加時に導入する。Template横断の世界観であるVisual Skin、最初の`handmade-paper@1`、Theme編集のSkin選択、AI CompositionへStyle Kitを渡すComposition Authoring Context、Font診断は[../visual-skins/spec.md](../visual-skins/spec.md)で実装済み（利用者Themeの作成・選択は[../theme-customization/spec.md](../theme-customization/spec.md)）。追加Skinや`handmade-paper@1`の対応Template拡張は[../visual-skins/roadmap.md](../visual-skins/roadmap.md)を正とする。
- YouTube 投稿用のサムネイルを、前景切り抜きテンプレートに文字と素材を差し込んで作成・管理する（言語エディション単位・複数候補・選択中を1枚、PNGはオンデマンド生成、ブランドは Visual Theme を共有し、言語版共通と候補単位の外観上書き、アプリ全体の外観プリセットを持つ）。詳細は [../thumbnail/spec.md](../thumbnail/spec.md)。Phase 2 の画像生成によるサムネイル候補とは別機能で、テンプレート方式を正とする。
- 編集画面の構成とテキストモデルを再設計する（[../editor/spec.md](../editor/spec.md)）。Sceneスロットを廃止しテキストをVisualCueへ統一（統合テキストテンプレート、配置・フォント・サイズ・色・装飾）、3ペイン化と静的ジャンプメニュー、プレビューの再生コントロールとScene・セリフ間ナビゲーション、シーン間トランジション（カット／フェード／クロスフェード）、立ち絵の前Sceneコピーを含む。テキスト統一とシーン間トランジションは `schemaVersion: 1` の基準契約に含まれる（[ADR-0061](../adr/0061-template-version-as-reinterpretation-boundary.md) で再基準化）。
- `table.simple@1` と、その列定義、行、強調セルの構造化入力を編集可能にする（[表テンプレート](../table-template/spec.md)で対応済み）。続けてchart、flow系VisualTemplateを追加する。`chart.bar@1`（カテゴリ・複数系列・値軸・grow/bounce登場）は [棒グラフテンプレート](../chart-template/spec.md) で対応済み。サイトモックアップの後に着手する。

完了条件：固定のフォーム範囲を超える視覚・音声表現を、正本JSONを壊さずに編集、プレビュー、レンダーできる。

## Phase 2: 音声・画像制作の自動化

> ローカル TTS エンジン（VOICEVOX / AivisSpeech）を使う先行 TTS Job を [../tts/spec.md](../tts/spec.md) で実装する。対象は両エンジンの通常話者のみとし、画像生成・調査・台本下書きは引き続き本フェーズの対象である。

- TTS Jobを追加し、`NarrationSegment` の本文、音声モデル、話者、速度から音声素材を生成する。手動音声と生成音声は同じ選択欄で切り替えられるようにする。
- 画像生成Jobを追加し、背景、シーン用ビジュアル、サムネイル候補を `Asset` として保存する。
- アプリ内に画像生成アダプターを持たない経路として、外部エージェントが生成した素材を [Agent Access](../agent-access/spec.md) の取り込み操作で `Asset` として保存できる。
- 生成物にはモデル、プロンプト、パラメータ、作成時刻、元台本版を来歴として保存する。
- 生成前にコスト・利用規約・著作権上の扱いを確認し、生成サービスやモデルを差し替えられるアダプター境界を置く。
- Agent Access の契約安定性（操作スキーマのダイジェスト、プロトコル版）、変更操作の冪等化、素材検索の索引化、TTS の冪等化と Take 添付の一体化などの拡張候補は [../agent-access/roadmap.md](../agent-access/roadmap.md) を正とする。

完了条件：人がセリフまたはプロンプトを選び、生成候補を確認して再レンダーできる。AI が作った版は帰属が記録され、いつでも巻き戻せる。

## Phase 3: 調査と台本下書き

- 調査Jobを追加し、検索・取得結果をURL、取得時刻、抜粋付きの根拠として保存する。
- 台本下書きJobを追加し、企画と採用済み根拠から複数の下書きを生成する。
- 下書きは `ScriptVersion` の候補として表示し、利用者が差分を確認して採用したときだけ新しい台本版にする。
- 事実性、出典、禁止表現、読み上げ時間などのチェックを、採用前のレビューとして追加する。
- 台本下書きは、アプリ内の下書き Job のほかに、外部エージェントが [Agent Access](../agent-access/spec.md) の `script.save` で新しい版として直接保存する経路でも行う。どちらも帰属を記録し、人が確認・巻き戻しできる。

完了条件：根拠へ戻れる台本候補を人が採用し、既存版を保持したまま新しい動画版を作れる。

## Phase 4: 多言語制作

- `LanguageEdition` を使って英語などの言語別制作版を追加する。第2言語版の作成と翻訳接続の具体化は [../multilingual-editions/spec.md](../multilingual-editions/spec.md) と [../multilingual-editions/roadmap.md](../multilingual-editions/roadmap.md) を正とする。Edition 間の同期状態の表示は [ADR-0082](../adr/0082-no-edition-sync-tracking.md) により実装対象から外れた。
- R1/R2 は実装済み：既存 Work への Edition 追加（`POST /works/:workId/language-editions`、`edition.create`）、編集画面の切替・追加 UI、数値・通貨の locale フォーマット、翻訳のエージェント接続（`script.save` の locale 一致は既存 `VALIDATION_ERROR`、`skills/kakeai-production/` の手順）。残りは R3 候補（言語別品質・素材言語タグ）。
- 言語別の読速、文字量、フォント、音声モデル、公開先に合わせた品質検証を追加する（R3 候補として [../multilingual-editions/roadmap.md](../multilingual-editions/roadmap.md) に残る）。

完了条件：日本語原本から複数言語の制作版を人が承認し、言語ごとに再現可能なMP4を出力できる。

## Phase 5: 派生コンテンツと制作運用

- 本編の台本版、出力、または指定区間を親として、縦型ショートを子 `Work` として生成・管理する。
- 9:16テンプレート、ショート向けの再構成提案、サムネイル出力を追加する。
- 作品・台本・素材・レンダーの履歴比較、レビューコメント、承認状態を追加する。
- progressPercentに依存した詳細進捗、実行中Jobのキャンセル、複数worker、自動再試行、Jobリース、監視を、利用形態に合わせて導入する。
- `contentHash`／JCS、楽観ロック、同一SHA-256素材復旧の厳密化を、協業と運用上の要件に合わせて導入する。
- 複数ユーザー、権限、クラウド保存、レンダーワーカーのスケールを、利用形態に合わせて導入する。

完了条件：本編との親子関係と来歴を保ったまま派生動画を作成・修正・出力でき、必要な運用規模へ安全に拡張できる。

## 各フェーズで守る設計原則

- 正本は自作のデータモデル。HyperFrames Composition HTML、TTS応答、画像生成結果、SRTなどは交換・派生データとする。
- すべての成果物は、入力版、テンプレート、素材、モデル、設定を追跡できるようにする。
- AI出力は不変の Asset または新しい Script Version として保存し、人が確認・巻き戻しできる。人の明示操作なしに外部へ公開しない。
- 外部サービス・モデル・ライセンスは差し替え可能なアダプター越しに使い、作品データへ固有形式を持ち込まない。
