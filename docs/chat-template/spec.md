# チャットテンプレート（`chat.thread@1`）仕様

## 目的と境界

この文書は、会話を吹き出しで並べた「チャット画面」を表示するデータ駆動の VisualTemplate `chat.thread@1` の正とする。複合ビジュアルの基盤は [../composite-visuals/spec.md](../composite-visuals/spec.md)、台本の契約は [../mvp/content-schema.md](../mvp/content-schema.md)、決定は [ADR-0070](../adr/0070-container-relative-visual-template-layout.md) と [ADR-0093](../adr/0093-caption-safe-area-for-chat-frames.md) を参照する。

- 会話は**映像として見せるだけ**とする。Sceneの `lines`・`speakers`・TTS・字幕とは結びつけない。正本は引き続き Scene のセリフであり、チャットは独立した VisualCue の入力である。
- 正本は自前の小さな構造化JSON（タイトル・メッセージ列・枠・ステータスバー）とする。HTML・SVG・スクリプト・実時刻は正本にしない。
- アイコンは画像 Asset を参照する。ステータスバーの図形（ダイナミックアイランド・Wi‑Fi・バッテリー）はテンプレートが inline SVG で描き、素材を要求しない。
- テンプレートは**親のサイズに追従する**。固定pxを持たず、与えられた箱を埋める。これにより同じ入力が、端末枠の違い（スマートフォン／ノートPC／全面）で同じように表示される。

## 入力契約

`chat.thread@1` の `visualCue.input` は次を満たす。

```jsonc
{
  "title": "相談のやりとり",          // 任意。ヘッダバー。空なら描かない
  "frame": "phone",                  // phone | laptop | desktop | none（既定 phone）
  "statusBar": true,                 // 任意。frame が phone のときだけ有効（既定 true）
  "statusTime": "9:41",              // 任意。ステータスバーの時刻（既定 "9:41"、空文字で非表示）
  "keyboard": true,                  // 任意。frame が laptop のときだけ有効（既定 true）
  "messages": [
    {
      "name": "リン",                // 任意。表示名
      "icon": { "kind": "media", "assetId": "asset-icon-1" }, // 任意。画像 Asset（NestedVisual の media）
      "side": "left",                // left | right（既定 left）
      "body": "これってどう思う？",   // 必須。本文
      "time": "12:30"                // 任意。吹き出しの時刻（自由テキスト）
    }
  ],
  "effects": [                       // 任意。メッセージ単位のセリフ同期
    {
      "target": { "kind": "message", "index": 1 },   // message(index) | messages(全件)
      "trigger": { "kind": "lines", "startLineId": "line-a3f-9c2", "endLineId": "line-a3f-9c2" },
      "effect": { "kind": "emphasize", "style": "spotlight", "tone": "primary" }
    }
  ]
}
```

- `messages` は1件以上6件以下（`CHAT_MAX_MESSAGES = 6`）。空・7件以上は拒否する。
- `side` は `left`（相手）／`right`（自分）。`right` は吹き出しをアクセント色で塗る。
- `icon` は `nestedMediaVisualSchema`（`kind: "media"`）。`fit` は描画時に無視し、円形に `cover` する。
- `time` は吹き出しの装飾テキストであり、ステータスバーの `statusTime` とは別物とする。どちらも動画の実時間とは連動しない。
- `effects` は任意で最大32件。各要素は `{ target, trigger, effect }`。`target` は `{ kind: "message", index }`（1件）または `{ kind: "messages" }`（全件）で、`index` が件数以上なら拒否する。`trigger` は `lineTriggerSchema`、`effect` は `cueEffectSchema`（`appear` / `emphasize`）をそのまま使う。

## テンプレート定義

| 項目 | 値 |
| --- | --- |
| `id@version` | `chat.thread@1` |
| `layers` | `["card", "overlay"]` |
| `transitionPolicy` | 既定（入退場はCue側） |
| `animationPolicy` | 既定（内部アニメーションは持たない） |
| `collectAssetRefs` | 各メッセージの `icon` の素材参照を集める |
| `collectLineRefs` | `effects[].trigger` の行参照を収集する |

`inputFields` は次を持つ。

| key | kind | 内容 |
| --- | --- | --- |
| `title` | optionalText | チャットのタイトル |
| `frame` | select | スマートフォン / ノートPC / デスクトップ / 枠なし（全面） |
| `statusTime` | optionalText | ステータスバーの時刻 |
| `statusBar` | boolean | ステータスバーを表示（スマートフォン） |
| `keyboard` | boolean | キーボードを表示（ノートPC） |
| `messages` | messages | メッセージ（名前・本文・左右・時刻・アイコン） |
| `effects` | effects（`variant: "chat"`） | セリフ同期の効果（対象はメッセージ／全メッセージ） |

新規Cueには、`frame: "phone"` と2件のメッセージ（相手・自分）を入れる。`effects` は空で始める（既定では全メッセージを表示）。

## セリフ同期の効果

`effects` は既存の Cue Trigger / Cue Effect（[../cue-effects/spec.md](../cue-effects/spec.md)）をそのまま使う。新しい動きの語彙は増やさない。

- `appear`: 対象メッセージの**行**（アイコンと吹き出しのまとまり）を登場させる。契機前は `opacity: 0` で場所を確保したまま隠れ、契機でフェードなどで現れる。`{ kind: "messages" }` と `staggerMs` を組み合わせると、会話全体を順に登場させられる。
- `emphasize`: 対象メッセージの**吹き出し**に枠・背景・スポットライトを当て、区間の終わりで元に戻る。`background` は吹き出しの基本背景色（左＝surface、右＝アクセント）へ戻す。`spotlight` は他のメッセージの行を減光する。`onset` は吹き出し内の一時オーバーレイに当たる。
- 行トリガーの実時刻は選択済みAudioTakeの尺から派生し、入力にミリ秒を直書きしない。行IDは同一Sceneに実在することを `collectLineRefs` で検証する。
- 行を削除すると、その行を契機にしていた `effects` の要素だけが取り除かれ、**メッセージは残る**（データと効果を分離しているため）。

## 単位と枠（コンテナ相対レイアウト）

- `frame` は枠の形だけを決める。内部レイアウトは全ケースで共通とする。
  - `phone`: 中央に 9:16 のパネル（太いベゼル、大きな角丸）。
  - `laptop`: 中央に 16:9 のパネル。
  - `desktop`: 中央に 21:9 のワイドなパネル（薄いベゼル、小さめの角丸）。
  - `none`: キャンバス全面。
- `phone` と `desktop` は、字幕セーフエリア（後述）の上に収める。パネルは残りの領域で中央寄せするため、字幕が2行表示されてもパネルと重ならない。`laptop`・`none` はこの予約を行わない（[roadmap](roadmap.md) 参照）。
- `laptop` では既定で画面の下に、開いたノートPCのベース（キーボード・トラックパッド・スピーカーグリル）をパース投影で描く（`keyboard: false` で消せる）。画面＋ベースの全体が縦に収まるよう、画面幅を縮める。
- パネル要素を `container-type: size` にする。パネル自体は背景を持たず、角丸で切り抜いた内側（`.kakeai-chatinner`）が surface を描く。これにより枠の外側の角は透明になり、背景が透ける。キーボード付きラップトップでは画面の下辺の角丸を0にしてベースと接合する。内側の要素で `--kakeai-chat-u: min(1cqw, 1cqh)` を定義し、**すべての寸法（文字・余白・角丸・アイコン径・ステータスバー高さ）をこの倍数**で表す。固定pxを書かない。
- `min(1cqw, 1cqh)` により、縦横比が変わっても短辺基準で見た目の密度が揃う（幅基準で拡大したい場合は `1cqw` に替える）。横長の枠（`laptop`・`desktop`）は高さで頭打ちになるため、縦に収まる件数はスマートフォン枠より少ない。件数上限6は短いメッセージを前提とした目安であり、長い会話はプレビューで確認する。
- 縦方向は内蔵flexで吸収する。ヘッダは固定、メッセージ列は `flex: 1` かつ下寄せ、`overflow: hidden`。
- コンパイラは Cue 本体（`.kakeai-cuebody`）を `container-type: size` にして、任意の Cue が `cq` 単位を使えるようにする。`scene.device-frame` の画面が内側にある場合は、より近いその要素がコンテナになる。

## 字幕セーフエリア

字幕はコンパイラ固定層で、キャンバス下端から72pxの位置に描く。`phone`・`desktop` のチャットは、字幕と物理的に領域を分けるため、キャンバス下端に字幕の高さぶんの余白を予約する。

- 余白は `--kakeai-caption-safe`（コンパイラが `#kakeai-root` に出力する）で受け取る。チャット側は値を計算しない。
- 値はテーマの `textRoles.caption`（`fontSize`・`lineHeight`）と `surfaces.caption`（上下padding・border）から導出する。既定テーマでは **216px**（下端72 + 2行×60px + 上下padding 24）。
- 基準は**2行**とする。字幕は2行まで警告せず、3行から `text_overflow` を警告する既存方針（[../mvp/content-schema.md](../mvp/content-schema.md)）に合わせる。3行以上の字幕は保証外とし、プレビューで確認する。
- 字幕の無いシーンでも常に予約する。シーンの内容で端末の大きさが変わると、見た目の一貫性を損なうため。
- レイヤーの前後（`card` / `overlay`）では解決しない。`card` では字幕がチャットを覆い、`overlay` ではチャットが字幕を覆うため、どちらでも読めなくなる。物理的に重ならないことが要件である。
- `laptop`・`none` は今回の対象外とする（`laptop` はキーボードベースを含めた再フィットが別途必要）。

## 入力ドック（スマートフォン）

`phone` のときだけ、パネル下端にチャットアプリ風の入力ドックを静的に描く。

- 中身は空の丸角入力欄と、円形の送信ボタン（inline SVG の矢印）。入力欄は空で、プレースホルダ文言を持たない。
- **装飾のみ**であり、`<input>`・`<textarea>`・`contenteditable`・`tabindex`・スクリプトを持たない。実時刻も読まないため、プレビューのシークとMP4が一致する。
- ドックはメッセージ列の次の flex 兄弟として置く。メッセージ列は `flex: 1` かつ下寄せのままなので、最新メッセージはドックの上で止まり、入力欄へ潜り込まない。
- 寸法は `--kakeai-chat-u` の倍数で表し、固定pxを書かない。`laptop`・`desktop`・`none` では描かない。
- 入力内容・送信先・操作性は持たない。将来必要になっても、この見た目のための新しい入力フィールド（例: `composer`）は追加しない。スマートフォン枠の標準外観とする（[ADR-0071](../adr/0071-pre-release-appearance-changes-without-version-bump.md)）。

## ステータスバー

- `frame: "phone"` かつ `statusBar !== false` のときだけ、パネル最上部に描く。`laptop` / `desktop` / `none` では描かない。
- 左に時刻（`statusTime`、既定 `9:41`）、中央にダイナミックアイランド（黒いピル）、右に Wi‑Fi とバッテリーの inline SVG を並べる。
- すべて静的な装飾であり、**実時刻を読む JavaScript を持たない**。プレビューのシークと MP4 が一致する。
- ステータスバーとキーボードベースは `scene.device-frame@1` と共通の描画（`device-chrome`）を使う。寸法はコンテナ相対（`--kakeai-status-u`）で、置かれた画面の大きさに追従する。
- ステータスバー（`phone`）とキーボード（`laptop`）は**既定オン**の任意入力（`.default(true)`）で、`false` を明示すると消せる。正式リリース前は見た目の変更を版の追加なしで行えるため、既存の保存済み入力の描画もこの既定に従う（[ADR-0071](../adr/0071-pre-release-appearance-changes-without-version-bump.md)）。

## レンダリング

- DOM 構造: `div.kakeai-chatwrap` > `div.kakeai-chatpanel`（コンテナ）> `div.kakeai-chatinner`（`--kakeai-chat-u`）> ステータスバー / ヘッダ / `div.kakeai-chatmessages` > `div.kakeai-chatrow` > `span.kakeai-chaticon` + `div.kakeai-chatbubble`（名前・本文・時刻）、続いて `div.kakeai-chatdock`（`phone` のみ）、最後にベゼルのオーバーレイ。
- 各行と吹き出しに Cue scope 配下の要素IDを割り当てる。`appear` は行、`emphasize`・`onset` は吹き出しを対象にし、`onset` のオーバーレイは吹き出し内に置く。
- アクセント色はテーマの `accents.primary` とし、`right` の吹き出しの文字色はコントラストから算出する。
- テキストはエスケープして描画する。要素IDは Cue scope 配下に閉じ、アイコンごとに子 scope を割り当てる。複数配置・入れ子で衝突しない。
- 決定性: 同じ入力・同じシーク位置で同じ表示になる。プレビューとMP4が一致する。

## 制約と警告

- メッセージは最大6件。超過は保存時に拒否する。
- 本文は目安（4行・全角16文字/行、半角32文字/行相当）を超えると保存を拒否せず、`meta.warnings`（`text_overflow`）で該当フィールドのJSON Pointerと理由を返す。
- 描画時に黙って縮小・切り詰めしない。あふれる場合はプレビューで確認して修正する。
- `phone` は字幕セーフエリア（216px）と入力ドックのぶんだけ描画領域が減る。既定テーマの1080pでパネルは約457×812px（従来は約571×1015px）になり、本文は約17px相当になる。6件の長文は窮屈になるため、プレビューで確認する。

## 非ゴール

- 会話の読み上げ・字幕・TTS との連動、`speakers` への対応付け。
- 実時刻のライブ表示、実機アイコン素材・ブランドロゴの同梱。
- `scene.device-frame@1` の画面への入れ子配置（エディタが入れ子テンプレートを編集できないため）。任意テンプレートの入れ子編集は別途。
- 複数種類のチャットアプリ風ガワ（LINE/Twitter 等）の作り分け。
- 入力欄の編集・送信・プレースホルダ文言。`composer` のような入力フィールドの追加。
- `laptop`・`none` への字幕セーフエリア適用と、`laptop` のキーボードベースを含めた再フィット。
- 3行以上の字幕との非重複保証。

## 受け入れ条件

- `chat.thread@1` の会話を `card` / `overlay` の両レイヤーで保存し、プレビューでシークし、MP4をレンダーできる。
- `frame` を `phone` / `laptop` / `desktop` / `none` に切り替えても同じ入力で表示でき、固定pxに依存しない。
- `phone` と `desktop` のパネルが、2行の字幕と重ならない（既定テーマで下端から216pxを予約する）。
- `phone` で、メッセージ列の下に空の入力欄と送信アイコンのドックが表示され、最新メッセージがドックに潜り込まない。ドックは `input` / `textarea` / `contenteditable` を持たない。
- `laptop` / `desktop` / `none` では入力ドックを描かない。
- `phone` でステータスバー（時刻・ダイナミックアイランド・Wi‑Fi・バッテリー）が表示され、`laptop` / `desktop` / `none` では表示されない。
- `laptop` でキーボードベースが既定で表示され、`keyboard: false` で消える。画面＋ベースがキャンバスに収まる。
- アイコン素材の参照が `collectAssetRefs` で収集され、存在・ready が保存時に検証される。
- 空・7件以上のメッセージを拒否し、本文の目安超過を警告で返す。
- `effects` の `appear` が契機前のメッセージを隠し契機で表示し、`emphasize` が対象の吹き出しを強調し、`spotlight` が他のメッセージを減光する。プレビューのシークとMP4で一致する。
- `effects` の対象メッセージ番号が件数以上なら拒否する。
- 行を削除すると、その行を契機にした効果だけが取り除かれ、メッセージは残る。
- 同一テンプレートの複数配置・入れ子で要素IDが衝突しない。
