import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { liveRuntimeConfigSchema, type CommentCandidate } from "@kakeai/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { Director } from "../director/director.ts";
import type {
  CommentCornerResponder,
  CommentCornerRespondOutcome,
} from "../runtime/comment-responder.ts";
import { loadLivePackage } from "../package/loader.ts";
import { createTestPackage } from "../testing/package-fixture.ts";
import { createLiveServer, type LiveServer } from "./server.ts";

const tempRoots: string[] = [];
const servers: LiveServer[] = [];

async function makeTemp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function config(dataDir: string) {
  return liveRuntimeConfigSchema.parse({
    llm: { mode: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "test-model" },
    tts: { adapters: {} },
    port: 3010,
    dataDir,
  });
}

const fakeDirector: Director = {
  sourceKind: "fixture",
  async generate() {
    return { cues: [], skip: true };
  },
};

class FakeResponder implements CommentCornerResponder {
  async respond(_candidate: CommentCandidate): Promise<CommentCornerRespondOutcome> {
    return "done";
  }
  pause(): void {}
  resume(): void {}
  stop(): void {}
}

async function newServer(options: {
  dataDir: string;
  distDir: string;
  director?: Director;
  responder?: CommentCornerResponder;
}): Promise<LiveServer> {
  const pkg = await createTestPackage({ includeCommentCorner: true });
  tempRoots.push(pkg.rootDir);
  const loaded = await loadLivePackage(pkg.rootDir);
  const server = await createLiveServer({
    package: loaded,
    config: config(options.dataDir),
    port: 0,
    distDir: options.distDir,
    testMode: true,
    ...(options.director === undefined ? {} : { director: options.director }),
    ...(options.responder === undefined ? {} : { responder: options.responder }),
  });
  servers.push(server);
  return server;
}

describe("live server director wiring", () => {
  it("builds the default responder and runtime around an injected director", async () => {
    const dataDir = await makeTemp("kakeai-live-data-");
    const distDir = await makeTemp("kakeai-live-dist-");
    const server = await newServer({ dataDir, distDir, director: fakeDirector });
    expect(server.directorRuntime).not.toBeNull();
  });

  it("uses an injected responder without constructing a director runtime", async () => {
    const dataDir = await makeTemp("kakeai-live-data-");
    const distDir = await makeTemp("kakeai-live-dist-");
    const server = await newServer({
      dataDir,
      distDir,
      responder: new FakeResponder(),
    });
    expect(server.directorRuntime).toBeNull();
  });
});
