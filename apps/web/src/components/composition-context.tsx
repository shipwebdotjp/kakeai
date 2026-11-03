import { createContext, type ReactNode } from "react";
import type { VisualSkinRef } from "@kakeai/contracts";

export const ScriptSkinContext = createContext<VisualSkinRef | null>(null);
export const WorkIdContext = createContext<string | null>(null);

export function WorkIdProvider({
  workId,
  children,
}: {
  workId: string | null;
  children: ReactNode;
}) {
  return <WorkIdContext.Provider value={workId}>{children}</WorkIdContext.Provider>;
}
