import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";
import { iconButtonClass } from "../ui";

export const iconMenuItemClass =
  "flex w-full items-center gap-2 whitespace-nowrap rounded px-2 py-1 text-left text-sm hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40";

export const iconMenuDangerItemClass =
  "flex w-full items-center gap-2 whitespace-nowrap rounded px-2 py-1 text-left text-sm text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-950";

interface IconMenuProps {
  label: string;
  children: (close: () => void) => ReactNode;
}

export function IconMenu({ label, children }: IconMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current !== null && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={label}
        title={label}
        className={iconButtonClass}
        onClick={() => setOpen((previous) => !previous)}
      >
        <Ellipsis aria-hidden="true" className="h-4 w-4" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 z-20 mt-1 min-w-48 rounded border border-border bg-surface p-1 shadow-lg"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
