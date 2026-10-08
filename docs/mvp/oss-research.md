# OSSだけで似た動画制作基盤を作れる範囲

**2026-10-08の選定更新：主レンダラーはHyperFramesとする。** HyperFramesはHTML/CSS/JavaScriptとローカル素材から決定論的なMP4を生成するApache-2.0のOSSであり、ローカルCLI、埋め込みPlayer、Node.jsから使えるProducerを提供します。[20] [21] [22] これにより、Remotionの組織規模に応じた商用ライセンスの懸念を主レンダラーから外します。

ただし、構想にあるような **企画→台本→素材・音声→字幕→人間レビュー→承認→再レンダー→修正履歴の学習** を、一つのOSS製品だけで完結する候補は確認できません。正規データ、業務Web UI、ジョブ制御、権限、版管理は自作し、HyperFrames Composition HTMLは正本JSONから派生させます。以下のRemotion等の評価は代替候補・比較履歴として残します。

## 構想に対する役割分担

この比較では、構想を次の七つの能力に分解します。

1. 企画・台本・素材指定を、バージョン付きの構造化データとして持つ。
2. LLM等で下書き、翻訳、品質チェックを実行する。
3. TTS、ASR、字幕の生成・修正・多言語化を行う。
4. テンプレート、タイムライン、素材をプレビューし、人間が修正・承認する。
5. 確定データと素材選択を追跡可能な形でレンダーする。
6. 非同期ジョブ、再試行、通知、監査を運用する。
7. 修正内容を蓄積し、次回の提案・評価を改善する。

候補が直接強いのは 3〜6 の一部です。1、7 と、これらを横断する完成済みの業務UIは自作範囲です。

## 候補別の比較

| 候補（適合度） | 構想で担わせる役割／できる範囲 | Web UI・JSON・レンダラーとの関係 | ライセンスと運用上の注意 |
|---|---|---|---|
| **HyperFrames（主レンダラー）** | HTML/CSS/JavaScript、ローカルの画像・動画・音声、seek可能なアニメーションからMP4を生成する。CLI、`@hyperframes/player`、`@hyperframes/producer`を持つ。[20] [22] | 自作JSONをVisualTemplate経由でComposition HTMLへコンパイルする。React業務UIにはWeb ComponentのPlayerを埋め込み、WorkerがProducerで出力する。SDKのHTML編集機能は正本にせず、必要なら将来の補助UIに限定する。[22] [23] | Apache-2.0。[21] Node.js 22以上とFFmpegが必要。[20] 0.x系で更新頻度が高いため、lockfileによる通常の依存管理と代表素材でのレンダー回帰テストを運用する。[24] |
| **Remotion（代替候補）** | 動画表現、テンプレート、プレビュー、字幕合成、最終レンダーの中核候補です。公式はJSONデータを入力し、`selectComposition()` と `renderMedia()` に各要素を `inputProps` として渡して複数MP4を出力する例を示します。[1] | Reactコンポーネントと `inputProps` が強みです。本プロジェクトではライセンス上の理由で採用しないが、正規JSONを派生入力として渡すという設計原則は同じです。 | 単純なMITではありません。個人、営利でも従業員3人以下、非営利、評価用途はFree Licenseの対象で、対象外の営利組織にはCompany Licenseが必要です。[3] |
| **React Video Editor / RVE（4/5）** | 人間によるタイムライン修正、ライブプレビュー、字幕・テキスト・素材の編集画面に向きます。SDK資料では`EditorState`を保存・復元し、`onSave`で完全なシリアライズ済み状態をバックエンドへ送れると説明します。[7] | Remotionベースであり、HyperFramesを主レンダラーとする本構成の編集UIには採用しない。`EditorState`は、いずれにせよ企画、レビューコメント、承認、修正理由を表す正規JSONの代替にはならない。 | **公開版のライセンス表示には不整合があります。** GitHubの表示はMITですが、READMEはRVE Licenseおよび商用時のRVE/Remotion双方のライセンスを記載しています。[6] 有償SDK・Proを含める場合もあるため、「MITの編集SDK」と決め打ちせず、採用するリポジトリ、タグ、配布物、契約を確認してから使います。 |
| **OpenCut（2/5）** | ブラウザ／デスクトップ／モバイルを視野に入れた人間編集UIの候補です。MITであり、将来のEditor API、MCP、headless batch rendering、scriptingが掲げられています。[4] | 現時点でREADMEは「全面的に書き直し中」で、稼働中サイトはclassic版、rewriteは準備中と明記します。[4] 公開済みの安定した動画プロジェクトJSON、headless API、HyperFrames連携を前提に中核へ据える根拠は不足します。 | MIT表示で組込みや改変には有利です。[4] ただし、計画機能を設計前提にしないことが重要です。PoCで現行版の保存形式、出力、編集要件を確認し、rewriteの安定化後に再評価します。 |
| **Motion Canvas（3/5）** | TypeScriptで説明的な2Dモーショングラフィックスや音声同期の素材を作る専門エンジンです。ローカルのブラウザエディタでプレビューし、FFmpeg exporterで音声を含む完成動画を出力できます。[5] | `npm run serve`でローカルエディタを起動する開発ツールです。[5] 公式の企画JSON、REST API、字幕管理、マルチユーザー業務UIは確認できません。JSONからTypeScriptのscene/projectを生成するアダプターを作り、**生成済み動画・連番をHyperFramesの動画Assetとして合成する** 使い方が現実的です。 | MIT（入力の公式LICENSE）で扱いやすい一方、FFmpegや素材の権利は別に管理します。汎用NLEや承認ワークフローの代替とは位置付けません。 |
| **Kdenlive / MLT（4/5）** | Kdenliveは人間編集、MLTはタイムライン合成・レンダー実行器の候補です。KdenliveはVOSK/Whisperで自動字幕、Whisper＋SeamlessM4Tで入力・出力言語を指定する字幕翻訳を説明します。[8] レンダースクリプト、ジョブキュー、`melt your_script.mlt` 実行も公式に案内されています。[9] | ブラウザ業務UI、REST/JSON API、HyperFrames公式統合は確認できません。MLTの主なプロジェクト表現はXMLで、正規JSONからMLT XMLへ変換する層が必要です。HyperFramesを主にするなら、デスクトップでの細部修正・字幕確認・前処理、または代替レンダラーに限定します。 | KdenliveはGPL-3.0、MLTはモジュールごとにLGPL/GPLの差があるという入力情報です。配布、組込み、依存モジュールの組合せは法務確認が必要です。コンテナを別プロセスのワーカーとして使っても、利用態様に応じた確認は省略できません。 |
| **Subtitle Edit（4/5）** | 字幕のASR補助、タイミング修正、翻訳補助、品質確認、SRT/VTT/ASS等の変換に強いサブシステムです。公式文書はAI Review、エラー修正、字幕形式、音声認識、字幕焼込みを案内し、`seconv` をCI・一括変換向けのheadless CLIと説明します。[10] [11] | デスクトップ版と字幕専用のWeb UIはありますが、動画制作全体の統合UIではありません。正規字幕JSONをSRT/VTT/ASSまたはSubtitle Edit用データへ変換し、人間修正後の承認版をHyperFrames Compositionの字幕テキスト・時間情報へ変換します。 | 入力情報ではGPL系のLICENSE本文とリポジトリ表示に差異があります。採用リリース、CLI、依存ライブラリを分けて確認し、単純なMIT扱いはしません。翻訳・AI Reviewに外部またはローカルモデルを使う場合は、そのモデル／APIの条件も別管理します。 |
| **WhisperX（4/5）** | ASR、単語単位タイムコード、VAD、強制アラインメント、話者分離を担当します。CLIはSRT/VTT/TXT/TSV/**JSON**を出力でき、話者ラベルと単語ハイライトのオプションを持ちます。[12] [13] | 公式Web UI・HTTP API・映像合成は確認できません。ジョブワーカーからCLIまたはPython APIを呼び、結果JSONを正規字幕データへ正規化してHyperFrames／Subtitle Editへ渡します。`--task translate` はX→英語であり、任意言語間翻訳の基盤とは見なしません。[13] | BSD-2-Clauseです。[12] ただし、Whisper/faster-whisper、言語別アラインメントモデル、pyannoteの条件は別確認です。話者分離にはHF token／モデル同意が必要な場合があり、GPU容量、未対応言語、重複発話、辞書にない表記で時刻が欠ける制約もREADMEが挙げます。[12] |
| **Piper TTS（4/5）** | 台本セグメントからローカル音声を作るTTSワーカーです。HTTP `/synthesize` はJSONでテキスト、voice、speaker、速度・ノイズ系パラメータを受け、WAVを返します。[14] | 簡易Web UIは音声テスト用です。[14] 動画、字幕、翻訳、タイムライン、HyperFrames連携は担当しません。言語・話者・速度・モデル版を正規JSONで指定し、生成WAVをAudioTakeとして保存してHyperFramesの音声素材として渡します。 | 現行リポジトリはGPL-3.0です。[15] 旧系との混同を避け、現行版と音声モデルごとのMODEL_CARD／利用条件を確認します。認証、レート制限、キュー、キャッシュ、監視は自作または別基盤で補います。 |
| **Dify（4/5）** | LLM、Agent、Workflow、ツール、知識検索をまとめ、企画案、構造化台本、翻訳案、素材プロンプト、品質チェックのオーケストレーション候補です。公開アプリをバックエンドからREST APIとして呼べます。[16] | Web UIはワークフロー設計・アプリ利用用です。動画タイムライン、MP4、字幕時刻、映像レビューの専用UIではありません。確定したJSONを外部ワーカーへ渡す**AI制御プレーン**として使い、レンダー・資産版管理・承認画面は別にします。 | Dify Open Source LicenseはApache 2.0に追加条件を加えます。書面許可なしのマルチテナント運用禁止、Dify frontendのLOGO／著作権表示の変更・削除禁止が明記されています。[17] 顧客向けSaaSやブランド変更の前に条件を確認します。 |
| **n8n（4/5）** | Webhook、外部API、AIエージェント、コード、条件分岐、人間承認、監査・再実行をつなぐ運用オーケストレーターです。WebhookはHTTPメソッド、JSON、バイナリ、認証、応答を扱えます。[19] | Web UIはワークフロー編集・運用用であり、動画の企画・台本・字幕・タイムライン編集画面ではありません。ストレージ上の動画をWebhookに丸ごと載せず、オブジェクトストレージのURIとジョブIDを渡します（標準Webhookの既定最大ペイロードは16MB）。[19] HyperFrames/WhisperX/Piperを外部ワーカーとして起動・監視します。 | MIT/Apacheではなく、Sustainable Use Licenseのfair-code製品です。[18] 入力情報が示すとおり、商用SaaS組込みや顧客提供は特に許諾条件を確認します。Difyとn8nを併用するなら、どちらを正とするログ／再実行基盤にするかを決め、二重の状態管理を避けます。 |

## Web UI・JSON・HyperFramesをどう分離するか

**Web UIは三層に分ける** と、候補の得意領域を無理なく使えます。

- **業務Web UI（自作）**：案件、企画、台本、言語版、素材選択、レビューコメント、承認、差分、監査を扱います。HyperFrames Playerは「プレビュー」だけに埋め込みます。HyperFrames StudioやSDKを案件・台本・承認の業務UIの代替にしません。
- **正規JSON＋DB（自作）**：台本・VisualCue・字幕・素材・音声・承認を一つのバージョンに固定します。HyperFrames Composition HTML、SDKのDOM編集差分、MLT XML、SRT/VTTはいずれも交換形式または派生物です。各製品の内部表現を正本にしないことが、差分、監査、再現性を守る条件です。
- **レンダー／AIワーカー**：承認済みバージョンを不変の入力として、HyperFrames、WhisperX、Piper、Subtitle Edit CLI、Motion Canvas、必要ならMLTへ渡します。生成物のハッシュ、使用テンプレート、モデル／音声、レンダー設定、入力JSONの版をJob記録に残します。

HyperFramesはHTMLをレンダー入力とするため、JSON→HTMLコンパイラと、信頼済みVisualTemplateの管理が必要です。利用者入力やAI出力をHTML/JavaScriptとして直接実行せず、Zodで検証したVisualTemplate入力だけからCompositionを生成します。MVPは出力バイト列の完全一致を保証しないが、品質の揺れを抑えるため、レンダー中の外部ネットワーク取得、壁時計、未seedの乱数へ依存しません。[25]

## 推奨する現実的な組合せ

### A. まず実用化する構成：HyperFrames中心（採用）

次が、Apache-2.0の主レンダラーを使いつつ、MVPの実装量を抑える構成です。

1. **Vite + React業務UI、Express API、SQLite + Prisma、ローカルファイル保存**を中核にする。作品、台本、素材、版、Job、Renderはここで持つ。
2. **HyperFrames**でテンプレート、音声、字幕、ビジュアルを合成する。正規JSONをVisualTemplateへ渡してComposition HTMLを生成し、Playerでプレビュー、Producerで最終MP4を生成する。[20] [22] [23]
3. **レンダーワーカー**はNode.js 22以上、FFmpeg、管理済み日本語フォントを備える。レンダー開始時のJSON・Asset Rendition参照・テンプレート版を記録し、実行時にCompositionを生成する。実行環境の版は障害調査用に残すが、同一MP4の再現は要件にしない。[20] [25]
4. **Piper、WhisperX、Subtitle Edit、Dify、n8n** はMVPには組み込まない。TTS、ASR、AI下書き、外部連携が必要になったフェーズで、正規JSONとJobを介して追加する。
5. グラフ、表、フローチャート、立ち絵、背景メディアは、HyperFrames側の信頼済みVisualTemplateとして実装する。事前生成したモーショングラフィックスは動画Assetとして合成できる。

この構成で、**手動素材と音声からのテンプレート動画、字幕、入力内容を追跡できる出力** をMVPとして実装する。TTS、画像・動画生成、翻訳、AI調査は別フェーズで追加する。

### B. 厳密なOSS／自社運用を優先する構成：MLT中心（代替）

HyperFramesが品質・保守性・実行環境の要件を満たせない場合は、**自作Web UI + 自作ジョブキュー + MLT/Kdenlive + Motion Canvas + WhisperX + Piper + Subtitle Edit** が代替になります。KdenliveはMLTスクリプトの生成、バッチ、`melt`実行を公式に案内しており、レンダー実行器にはできます。[9]

ただし、この構成では、Reactでのテンプレート表現、ブラウザ編集、JSON→動画の開発者体験を自作する割合が大きくなります。MLT XML変換、プレビュー、Webタイムライン、レンダーAPI、キューを作る必要があり、**「ライセンスの寛容さ」と引換えに実装・検証コストが増える** 選択です。GPL/LGPLの配布・連携態様も別途審査します。

### 併用しないほうがよい軸

- **HyperFramesとMLTを同じ案件の主レンダラーに二重採用しない。** 現在はHyperFramesに寄せ、MLTは将来の例外案件または代替評価に限定します。
- **RVEとOpenCutを正規編集UIにしない。** RVEはRemotionとの近さを前提としており、本採用のHyperFrames構成には適合しません。OpenCutの将来APIも正規UIの前提にしません。[4]
- **Difyとn8nを案件DBにしない。** 両者はオーケストレーション用です。案件・版・承認の唯一の正本は自前DBです。

## 足りない自作部分

候補だけでは、以下を作らない限り構想は完成しません。

1. **正規ドメインスキーマと版管理**：`project`、`scriptVersion`、`locale`、`scene`、`asset`、`voice`、`captionCue`、`timelineDirective`、`templateVersion`、`review`、`approval`、`renderJob`、`provenance`を識別子付きで定義します。台本・字幕・編集の変更理由、親版、承認者、時刻を残します。
2. **Compositionコンパイラ**：正規JSONからHyperFrames Composition HTML、SRT/VTT/Caption、Piperリクエスト、WhisperX結果、必要ならMLT XML／Motion Canvasの生成物へ変換します。HyperFrames固有のDOM属性・HTMLを正本へ逆流させません。
3. **動画制作の業務Web UI**：企画、脚本、素材選択、字幕比較、波形、タイムライン、コメント、差分、承認、公開前チェック、権限を一貫して見せる画面です。Dify/n8nのWeb UI、PiperのテストUI、Motion Canvasのローカルエディタはこの代替ではありません。
4. **ジョブ制御と追跡可能性**：キュー、冪等キー、再試行、キャンセル、GPU/CPUワーカー割当、進捗、成果物URI、失敗診断、入力スナップショットを実装します。MVPでは入力内容と素材Renditionの固定を守るが、ツール更新後の同一出力までは保証しません。n8nは連結・通知に使えても、レンダージョブの正本と大容量ファイル管理は外部に置きます。[19]
5. **多言語制作の品質工程**：台本翻訳、用語集、翻訳メモリ、言語別の文字数・読速制約、TTS音声選択、字幕再タイミング、人間レビュー、ローカル別承認を作ります。WhisperXの翻訳はX→英語であり、Piperの多言語voiceは翻訳機能ではありません。[13] [14]
6. **AIの評価・改善ループ**：修正ログを集めるだけでは自動改善になりません。評価項目（事実性、ブランド規約、読速、字幕時刻、素材権利、レンダー欠落）、人間判定、プロンプト／テンプレート／モデルの版、再実行基準を定義します。候補の公式情報だけでは「修正ログから学習して品質を上げる」完成機能は確認できません。
7. **セキュリティと権利管理**：RBAC、テナント分離、秘密情報をバックエンドに置くこと、外部モデルへの送信制御、素材・音声モデル・BGM・フォントの利用許諾、削除保持方針を実装します。Dify APIキーをフロントエンドに埋め込まない旨は公式ドキュメントにも明記されています。[16]

## 導入時の判断基準

- **最短でApache-2.0のテンプレート動画を出したい**：HyperFramesを核にし、HTML/CSS/JavaScriptのVisualTemplateを自作する。MVPでは字幕・音声・素材を手動で指定する。
- **人間編集の画面を早く用意したい**：フォーム主体の自作UIを維持する。HyperFrames StudioはComposition編集用であり、作品・台本・承認管理のUIにはしない。[23]
- **字幕の精度・レビューを優先したい**：WhisperXで時刻付き下書きを作り、Subtitle Editで同期とルールチェックを人間が確定する。
- **既存NLEに近い編集・FFmpeg系レンダーを重視する**：Kdenlive/MLTを補助または代替レンダラーとしてPoCする。ただしWeb化とJSON化の自作量を見込む。
- **商用SaaSで「OSSのみ」が必須**：HyperFrames本体はApache-2.0だが、導入するCatalogブロック、フォント、素材、外部AIサービスは個別に確認する。Dify、n8n、RVEはライセンス確認なしに組み込まない。

## 主要な注意点

- HyperFramesも、企画・承認・翻訳・TTS・修正履歴を内蔵する完成業務製品ではない。これらと正規JSON・Job管理は自作する。
- HyperFramesは0.x系であり、HTMLの時間属性、seek可能なアニメーション、決定論の規約に従う必要がある。Compositionが壁時計、未seedの乱数、レンダー中のネットワーク取得へ依存すると、同じ編集内容でも品質検証が不安定になる。[25]
- OpenCutのEditor API/MCP/headlessは公式READMEでは将来項目です。実装済み機能として工程や納期を置きません。[4]
- RVEのGitHub表示とREADMEのライセンス記述は衝突しています。公開リポジトリの表示だけを根拠に商用採用しません。[6]
- WhisperXの言語別アラインメント、話者分離、Piperの音声モデル、Subtitle Editの外部AI／翻訳、Kdenlive/MLTのモジュール、素材・フォントは本体とは別の条件と品質検証が必要です。[12] [15]
- Difyのマルチテナント制限とn8nのSustainable Use Licenseは、社内利用と顧客向けサービスで結論が変わり得ます。[17] [18]

## References

[1]: https://www.remotion.dev/docs/dataset-render "Remotion: Render videos programmatically from a dataset"
[2]: https://www.remotion.dev/docs/captions/api "Remotion: @remotion/captions"
[3]: https://www.remotion.dev/license "Remotion License"
[4]: https://github.com/OpenCut-app/OpenCut "OpenCut repository"
[5]: https://motioncanvas.io/docs/rendering/video "Motion Canvas: Video (FFmpeg)"
[6]: https://github.com/reactvideoeditor/free-react-video-editor "React Video Editor Open Source Edition repository"
[7]: https://www.reactvideoeditor.com/docs/sdk/components/react-video-editor "React Video Editor SDK component documentation"
[8]: https://docs.kdenlive.org/en/effects_and_filters/speech_to_text.html "Kdenlive: Speech to Text"
[9]: https://docs.kdenlive.org/en/exporting/render.html "Kdenlive: Rendering"
[10]: https://subtitleedit.github.io/subtitleedit/ "Subtitle Edit documentation"
[11]: https://subtitleedit.github.io/subtitleedit/features/seconv.html "Subtitle Edit: seconv command-line converter"
[12]: https://github.com/m-bain/whisperX "WhisperX repository"
[13]: https://github.com/m-bain/whisperX/blob/main/whisperx/__main__.py "WhisperX command-line interface"
[14]: https://github.com/OHF-voice/piper1-gpl/blob/main/docs/API_HTTP.md "Piper HTTP API"
[15]: https://github.com/OHF-voice/piper1-gpl "Piper repository"
[16]: https://docs.dify.ai/api-reference "Dify API reference"
[17]: https://github.com/langgenius/dify/blob/main/LICENSE "Dify Open Source License"
[18]: https://github.com/n8n-io/n8n "n8n repository"
[19]: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook "n8n Webhook node documentation"
[20]: https://github.com/heygen-com/hyperframes "HyperFrames repository and quickstart"
[21]: https://github.com/heygen-com/hyperframes/blob/main/LICENSE "HyperFrames Apache-2.0 license"
[22]: https://github.com/heygen-com/hyperframes/blob/main/docs/packages/producer.mdx "HyperFrames Producer"
[23]: https://github.com/heygen-com/hyperframes/blob/main/docs/packages/player.mdx "HyperFrames Player"
[24]: https://github.com/heygen-com/hyperframes/releases "HyperFrames releases"
[25]: https://github.com/heygen-com/hyperframes/blob/main/docs/concepts/determinism.mdx "HyperFrames deterministic rendering"
