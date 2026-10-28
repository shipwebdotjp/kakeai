import { describe, expect, it } from "vitest";
import {
  abortActiveRender,
  registerRenderCancellation,
  unregisterRenderCancellation,
} from "./render-cancellation.ts";

describe("render cancellation", () => {
  it("aborts a registered render", () => {
    const signal = registerRenderCancellation("job_cancel_test");
    expect(signal.aborted).toBe(false);

    expect(abortActiveRender("job_cancel_test")).toBe(true);
    expect(signal.aborted).toBe(true);

    unregisterRenderCancellation("job_cancel_test", signal);
    expect(abortActiveRender("job_cancel_test")).toBe(false);
  });

  it("stops a stale registration when the same job is registered again", () => {
    const first = registerRenderCancellation("job_duplicate");
    const second = registerRenderCancellation("job_duplicate");

    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);

    expect(abortActiveRender("job_duplicate")).toBe(true);
    expect(second.aborted).toBe(true);
    unregisterRenderCancellation("job_duplicate", second);
  });

  it("ignores an unregistered job", () => {
    expect(abortActiveRender("job_missing")).toBe(false);
  });

  it("does not remove a newer registration with the same job id", () => {
    const first = registerRenderCancellation("job_replaced");
    unregisterRenderCancellation("job_replaced", first);
    const second = registerRenderCancellation("job_replaced");

    unregisterRenderCancellation("job_replaced", first);
    expect(abortActiveRender("job_replaced")).toBe(true);
    expect(second.aborted).toBe(true);
    unregisterRenderCancellation("job_replaced", second);
  });
});
