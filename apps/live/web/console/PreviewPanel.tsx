/**
 * Muted preview of the actual stage. The iframe opens `/stage?preview=1`, so
 * its WebSocket asks for a preview lease and never takes program from OBS.
 */
export function PreviewPanel() {
  return (
    <section className="panel preview-panel">
      <h2>ステージプレビュー</h2>
      <div className="preview-frame">
        <iframe src="/stage?preview=1" title="ステージプレビュー" />
      </div>
      <p className="muted">
        プレビューはミュートで、再生イベントを送信しません。OBS に出す program
        ステージは別タブで開いてください。
      </p>
      <a className="stage-link" href="/stage" target="_blank" rel="noreferrer">
        OBS 用 program ステージを別タブで開く
      </a>
    </section>
  );
}
