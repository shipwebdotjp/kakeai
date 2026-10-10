# シーン複製は前のSceneの視覚要素のみを新IDで複製する

各 point Scene に「前のシーンを複製」ボタンを置き、直前Scene（pointに限る）の視覚要素を新IDで複製して、複製元の直後に新しい point Scene として挿入する。複製するのは `accentColor`・`timing`・`scene.transition`・全VisualCue・立ち絵。**セリフ（`lines`）と `AudioTake` は複製しない**。

IDは Scene・VisualCue ごとに新規発行する。立ち絵Cueの `cueId` も新規にする。セリフ・音声を複製しないため line/take のID再発行は不要。素材・話者・キャラクター・外観はdocument-levelで共有し、複製しない。複製先は常に point とし、`intro → point* → outro` の順序を保つ。複製元が point でない場合は無効化する。

理由は、要点Sceneの反復レイアウト（色・背景・カード・テキスト・立ち絵を共通にした量産）に効くため。立ち絵だけの複製では背景・カード・テキストの作り直しが残る。一方、セリフと音声は各Scene固有で、同一内容を複製する用途が薄く、`AudioTake` を複製すると `narrationSegmentId` の張り替えと重複排除の複雑さだけが増えるため対象外とする。参照IDを共有することで、素材やキャラクターを再選択させない。

## Considered Options

- 立ち絵だけを複製する。→ 背景・カード・テキストの作り直しが残り、量産用途に効かないため不採用。
- 現在のScene自体を複製する。→ 「前のSceneを複製して次のSceneに活かす」編集の流れに合わず、本ADRでは前のSceneを複製元とする。
- セリフ・音声も複製する。→ `AudioTake` の `narrationSegmentId` 張り替えと重複排除が必要になり、反復用途も薄いため不採用。
- 複製を現在Sceneへ上書きする。→ 既存内容を失う誤操作に弱いため不採用。常に新Sceneとして挿入する。

## Consequences

- `apps/web` の `form.ts` に `cloneSceneFormValue` を追加し、Scene/VisualCue の新ID発行と `lines: []` を行う。
- ボタンは各 point Scene の見出しコントロール群の最左に置き、直前Sceneがpointのときだけ有効にする。挿入位置は複製元の直後。
- `buildContentDocument` の既存の往復モデルに乗るため、複製後も検証（ID一意性・参照整合）を満たす。
