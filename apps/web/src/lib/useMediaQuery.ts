import { useEffect, useState } from "react";
import { EDITOR_LAYOUT_WIDE_BREAKPOINT_PX } from "./editorLayout";

export const EDITOR_WIDE_MEDIA_QUERY = `(min-width: ${EDITOR_LAYOUT_WIDE_BREAKPOINT_PX}px)`;

interface LegacyMediaQueryList {
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia(query) as MediaQueryList & LegacyMediaQueryList;
    const onChange = () => setMatches(media.matches);
    onChange();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }
    if (typeof media.addListener === "function") {
      media.addListener(onChange);
      return () => media.removeListener?.(onChange);
    }
    return;
  }, [query]);
  return matches;
}
