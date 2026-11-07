import { isLoopbackHostname } from "@kakeai/contracts";

/**
 * A "local" LLM must actually be on this machine. A config that says
 * `mode: "local"` but points at an external host would still send real YouTube
 * comments off-device, so every gate checks the URL as well as the label.
 */
export function isLocalLlmEndpoint(llm: { mode: "local" | "external"; baseUrl: string }): boolean {
  if (llm.mode !== "local") {
    return false;
  }
  try {
    const url = new URL(llm.baseUrl);
    return isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}
