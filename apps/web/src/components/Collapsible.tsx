import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { detailsSummaryClass } from "../ui";

export function Collapsible({
  title,
  summary,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  children,
  className = "mt-2",
}: {
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const toggle = () => {
    if (!isControlled) {
      setInternalOpen((previous) => !previous);
    }
    onOpenChange?.(!open);
  };
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className={detailsSummaryClass}
      >
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
        />
        <span>{title}</span>
        {summary !== undefined && (
          <span className="font-normal text-muted-foreground">{summary}</span>
        )}
      </button>
      <div hidden={!open} className="mt-1">
        {children}
      </div>
    </div>
  );
}
