import { useEffect, useState } from "react";
import { applyTheme, getStoredTheme, storeTheme, type Theme } from "../theme";
import { buttonNeutralClass } from "../ui";

const ORDER: Theme[] = ["system", "light", "dark"];

const LABELS: Record<Theme, string> = {
  system: "システム",
  light: "ライト",
  dark: "ダーク",
};

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    storeTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") {
      return;
    }
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handler);
      return () => media.removeEventListener("change", handler);
    }
    if (typeof media.addListener !== "function" || typeof media.removeListener !== "function") {
      return;
    }
    media.addListener(handler);
    return () => media.removeListener(handler);
  }, [theme]);

  const cycle = () => {
    const index = ORDER.indexOf(theme);
    setTheme(ORDER[(index + 1) % ORDER.length] as Theme);
  };

  return (
    <button type="button" className={buttonNeutralClass} onClick={cycle} title="テーマを切り替え">
      テーマ: {LABELS[theme]}
    </button>
  );
}
