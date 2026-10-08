import { Link, Route, Routes } from "react-router-dom";
import { WorkEditPage } from "./pages/WorkEditPage";
import { WorkListPage } from "./pages/WorkListPage";

export function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 px-5 py-3 dark:border-gray-700">
        <Link to="/" className="text-lg font-bold text-inherit no-underline">
          Kakeai
        </Link>
      </header>
      <main className="mx-auto max-w-3xl p-5">
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
