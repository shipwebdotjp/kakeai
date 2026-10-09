import { useState, type DragEvent, type ReactNode } from "react";

interface FileDropZoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export function FileDropZone({ onFiles, disabled = false, className, children }: FileDropZoneProps) {
  const [active, setActive] = useState(false);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setActive(false);
    if (disabled) {
      return;
    }
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) {
      onFiles(files);
    }
  };

  return (
    <div
      className={`relative rounded border border-dashed p-3 transition-colors ${
        active && !disabled ? "border-brand-500 bg-brand-500/10" : "border-border"
      } ${className ?? ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) {
          setActive(true);
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) {
          setActive(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setActive(false);
        }
      }}
      onDrop={onDrop}
    >
      {children}
      {active && !disabled && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded bg-brand-500/15 text-sm font-medium text-foreground">
          ここにファイルをドロップ
        </div>
      )}
    </div>
  );
}

export function filesFromInput(input: HTMLInputElement): File[] {
  return input.files === null ? [] : Array.from(input.files);
}
