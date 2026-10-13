import { Link, Outlet, RouterProvider, createBrowserRouter } from "react-router-dom";
import { ThemeToggle } from "./components/ThemeToggle";
import { AssetsPage } from "./pages/AssetsPage";
import {
  CHARACTER_LIBRARY_ROUTE_PATH,
  COMPOSITION_LIBRARY_ROUTE_PATH,
  VOICE_PROFILES_ROUTE_PATH,
} from "./lib/routes";
import { CharacterLibraryPage } from "./pages/CharacterLibraryPage";
import { CompositionLibraryPage } from "./pages/CompositionLibraryPage";
import { VoiceProfilesPage } from "./pages/VoiceProfilesPage";
import { WorkEditPage } from "./pages/WorkEditPage";
import { WorkListPage } from "./pages/WorkListPage";

function RootLayout() {
  return (
    <div className="flex h-screen flex-col supports-[height:100dvh]:h-dvh">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-lg font-bold text-inherit no-underline">
            Kakeai
          </Link>
          <nav className="flex items-center gap-3 text-sm">
            <Link to="/" className="text-inherit no-underline hover:underline">
              作品
            </Link>
            <Link to="/assets" className="text-inherit no-underline hover:underline">
              素材
            </Link>
            <Link
              to={VOICE_PROFILES_ROUTE_PATH}
              className="text-inherit no-underline hover:underline"
            >
              音声
            </Link>
            <Link
              to={CHARACTER_LIBRARY_ROUTE_PATH}
              className="text-inherit no-underline hover:underline"
            >
              キャラクター
            </Link>
            <Link
              to={COMPOSITION_LIBRARY_ROUTE_PATH}
              className="text-inherit no-underline hover:underline"
            >
              コンポジション
            </Link>
          </nav>
        </div>
        <ThemeToggle />
      </header>
      <main className="min-h-0 flex-1 overflow-auto p-5">
        <Outlet />
      </main>
    </div>
  );
}

function PageLayout() {
  return (
    <div className="mx-auto max-w-3xl">
      <Outlet />
    </div>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      {
        path: "works/:workId",
        element: <WorkEditPage />,
      },
      {
        element: <PageLayout />,
        children: [
          {
            index: true,
            element: <WorkListPage />,
          },
          {
            path: "assets",
            element: <AssetsPage />,
          },
          {
            path: VOICE_PROFILES_ROUTE_PATH,
            element: <VoiceProfilesPage />,
          },
          {
            path: CHARACTER_LIBRARY_ROUTE_PATH,
            element: <CharacterLibraryPage />,
          },
          {
            path: COMPOSITION_LIBRARY_ROUTE_PATH,
            element: <CompositionLibraryPage />,
          },
          {
            path: "*",
            element: (
              <p>
                ページが見つかりません。<Link to="/">作品一覧へ戻る</Link>
              </p>
            ),
          },
        ],
      },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
