import { describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { updateLiveFormat } from "./live-formats.ts";
import { liveFormatFixture } from "./live-program-test-helpers.ts";

describe("updateLiveFormat", () => {
  it("returns 404 when the row is deleted before the update", async () => {
    const now = new Date();
    const prisma = {
      liveFormat: {
        findUnique: async () => ({
          id: "format-1",
          name: "old",
          documentJson: "{}",
          createdAt: now,
          updatedAt: now,
        }),
        update: async () => {
          throw Object.assign(new Error("Record not found"), { code: "P2025" });
        },
      },
    } as unknown as PrismaClient;

    await expect(
      updateLiveFormat(
        prisma,
        "format-1",
        liveFormatFixture({ characterId: "char-1", voiceProfileId: "voice-1" }),
      ),
    ).rejects.toMatchObject({
      status: 404,
      code: "RESOURCE_NOT_FOUND",
      details: { resource: "live_format", id: "format-1" },
    });
  });
});
