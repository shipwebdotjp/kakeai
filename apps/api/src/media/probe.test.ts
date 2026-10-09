import { describe, expect, it } from "vitest";
import { summarizeProbe } from "./probe.ts";

describe("summarizeProbe", () => {
  it("reads dimensions and duration from a video stream", () => {
    const result = summarizeProbe("video", {
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
          r_frame_rate: "30/1",
          avg_frame_rate: "30/1",
        },
      ],
      format: { duration: "2.500000" },
    });
    expect(result).toMatchObject({
      kind: "video",
      codec: "h264",
      durationMs: 2500,
      widthPx: 1920,
      heightPx: 1080,
      constantFrameRate: true,
      rotation: 0,
    });
  });

  it("detects variable frame rate and rotation", () => {
    const result = summarizeProbe("video", {
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 640,
          height: 480,
          r_frame_rate: "30000/1001",
          avg_frame_rate: "30/1",
          side_data_list: [{ side_data_type: "Display Matrix", rotation: 90 }],
        },
      ],
      format: { duration: "1" },
    });
    expect(result.constantFrameRate).toBe(false);
    expect(result.rotation).toBe(90);
  });

  it("leaves image duration null and audio dimensions null", () => {
    const image = summarizeProbe("image", {
      streams: [{ codec_type: "video", codec_name: "png", width: 320, height: 240 }],
      format: { duration: "0.04" },
    });
    expect(image.durationMs).toBeNull();
    expect(image.widthPx).toBe(320);

    const audio = summarizeProbe("audio", {
      streams: [{ codec_type: "audio", codec_name: "mp3" }],
      format: { duration: "3" },
    });
    expect(audio.durationMs).toBe(3000);
    expect(audio.widthPx).toBeNull();
    expect(audio.heightPx).toBeNull();
    expect(audio.codec).toBe("mp3");
  });
});
