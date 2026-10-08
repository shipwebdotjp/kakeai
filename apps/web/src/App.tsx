import { Link, Route, Routes } from "react-router-dom";
import { WorkEditPage } from "./pages/WorkEditPage";
import { WorkListPage } from "./pages/WorkListPage";

export function App() {
  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="app-title">
          Kakeai
        </Link>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<WorkListPage />} />
          <Route path="/works/:workId" element={<WorkEditPage />} />
          <Route
            path="*"
            element={
              <p>
                ページが見つかりません。<Link to="/">作品一覧へ戻る</Link>
              </p>
            }
          />
        </Routes>
      </main>
    </div>
  );
}
