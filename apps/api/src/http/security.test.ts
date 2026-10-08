import { describe, expect, it } from "vitest";
import {
  type AccessContext,
  type AccessPolicy,
  constantTimeEqual,
  evaluateJsonAccess,
  evaluateMediaAccess,
  isLoopbackHost,
  parseCookie,
} from "./security.ts";

const PORT = 4317;
const policy: AccessPolicy = {
  port: PORT,
  allowedOrigins: new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]),
};
const TOKEN = "secret-token";

function context(overrides: Partial<AccessContext>): AccessContext {
  return {
    hostHeader: `127.0.0.1:${PORT}`,
    origin: undefined,
    secFetchSite: undefined,
    method: "GET",
    ...overrides,
  };
}

describe("isLoopbackHost", () => {
  it("accepts loopback hostnames on the configured port", () => {
    expect(isLoopbackHost(`127.0.0.1:${PORT}`, PORT)).toBe(true);
    expect(isLoopbackHost(`localhost:${PORT}`, PORT)).toBe(true);
    expect(isLoopbackHost(`[::1]:${PORT}`, PORT)).toBe(true);
  });

  it("rejects other hosts and ports", () => {
    expect(isLoopbackHost("evil.example.com:4317", PORT)).toBe(false);
    expect(isLoopbackHost(`127.0.0.1:9999`, PORT)).toBe(false);
    expect(isLoopbackHost(undefined, PORT)).toBe(false);
  });
});

describe("evaluateJsonAccess", () => {
  it("allows a same-origin GET without an Origin header", () => {
    expect(evaluateJsonAccess(context({}), policy).allowed).toBe(true);
  });

  it("rejects a non-loopback Host", () => {
    const decision = evaluateJsonAccess(context({ hostHeader: "evil.example.com:4317" }), policy);
    expect(decision).toEqual({ allowed: false, reason: "host" });
  });

  it("rejects an unlisted Origin", () => {
    const decision = evaluateJsonAccess(context({ origin: "http://evil.example.com" }), policy);
    expect(decision).toEqual({ allowed: false, reason: "origin" });
  });

  it("requires an Origin header for state-changing methods", () => {
    const decision = evaluateJsonAccess(context({ method: "POST" }), policy);
    expect(decision).toEqual({ allowed: false, reason: "origin-required" });
    expect(
      evaluateJsonAccess(context({ method: "POST", origin: `http://127.0.0.1:${PORT}` }), policy).allowed,
    ).toBe(true);
  });

  it("rejects cross-site fetch metadata", () => {
    const decision = evaluateJsonAccess(context({ secFetchSite: "cross-site" }), policy);
    expect(decision).toEqual({ allowed: false, reason: "sec-fetch-site" });
  });
});

describe("evaluateMediaAccess", () => {
  it("allows a request with the media session cookie", () => {
    const decision = evaluateMediaAccess(
      context({ cookieHeader: `Kakeai-Media-Session=${TOKEN}` }),
      policy,
      TOKEN,
    );
    expect(decision.allowed).toBe(true);
  });

  it("rejects a missing or wrong cookie", () => {
    expect(evaluateMediaAccess(context({}), policy, TOKEN)).toEqual({
      allowed: false,
      reason: "media-cookie",
    });
    expect(
      evaluateMediaAccess(context({ cookieHeader: "Kakeai-Media-Session=other" }), policy, TOKEN),
    ).toEqual({ allowed: false, reason: "media-cookie" });
  });

  it("rejects a cross-site subresource request", () => {
    const decision = evaluateMediaAccess(
      context({ secFetchSite: "cross-site", cookieHeader: `Kakeai-Media-Session=${TOKEN}` }),
      policy,
      TOKEN,
    );
    expect(decision).toEqual({ allowed: false, reason: "sec-fetch-site" });
  });
});

describe("parseCookie", () => {
  it("finds a named cookie among others", () => {
    expect(parseCookie("a=1; Kakeai-Media-Session=abc; b=2", "Kakeai-Media-Session")).toBe("abc");
    expect(parseCookie(undefined, "Kakeai-Media-Session")).toBeUndefined();
    expect(parseCookie("a=1", "Kakeai-Media-Session")).toBeUndefined();
  });
});

describe("constantTimeEqual", () => {
  it("compares equal and unequal strings", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });
});
