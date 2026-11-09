import { randomUUID } from "node:crypto";

/** Prefixed ids keep DB rows and copied document ids visually distinct. */
export function newLiveId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
