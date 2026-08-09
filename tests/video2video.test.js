/* eslint-env jest */
"use strict";

jest.mock("../server/lib/aspect-ratio.js", () => {
  const actual = jest.requireActual("../server/lib/aspect-ratio.js");
  return {
    ...actual,
    resolveAspectRatioFromInputImage: jest.fn(
      async ({ body, inputFilename }) => {
        const dims = actual.resolveAspectRatioDimensions(
          String(body.aspect_ratio ?? "1:1").trim() || "1:1",
          640,
          640,
        );
        return {
          aspectRatio: dims.requested,
          width: dims.width,
          height: dims.height,
          inputFilename,
        };
      },
    ),
  };
});

jest.mock("../server/generator/image-input.js", () => ({
  downloadImagesToComfyInput: jest.fn(),
  ensureAudio2videoPlaceholderImage: jest.fn(),
  COMFY_INPUT_DIR: "/fake/comfy/input",
  A2V_PLACEHOLDER_IMAGE_FILENAME: "a2v_placeholder.png",
}));

jest.mock("../server/generator/audio-input.js", () => ({
  downloadAudioToComfyInput: jest.fn(),
}));

jest.mock("../server/generator/video-input.js", () => ({
  downloadVideoToComfyInput: jest.fn(),
}));

jest.mock("../server/lib/video-prepare.js", () => {
  const actual = jest.requireActual("../server/lib/video-prepare.js");
  return {
    ...actual,
    prepareControlVideo: jest.fn(),
  };
});

const {
  downloadImagesToComfyInput,
} = require("../server/generator/image-input.js");
const {
  downloadVideoToComfyInput,
} = require("../server/generator/video-input.js");
const { prepareControlVideo } = require("../server/lib/video-prepare.js");
const { buildComfyArgs } = require("../server/lib/comfy-args.js");
const WanVaceVideo2VideoWorkflow = require("../server/workflows/video2video/wan2_2_vace_v2v.js");
const WanVaceMotionTransferWorkflow = require("../server/workflows/video2video/wan2_2_vace_motion.js");

const OUTPUT_DIR = "/fake/output";
const VIDEO_URL = "http://example.com/motion.mp4";
const IMAGE_URL = "http://example.com/character.png";
const FAKE_VIDEO = "video_123_abc.mp4";
const FAKE_PREP = "prep_123_abcd.mp4";
const FAKE_IMAGE = "input_123_abc.png";

describe("video2video", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    downloadVideoToComfyInput.mockResolvedValue([FAKE_VIDEO]);
    downloadImagesToComfyInput.mockResolvedValue([FAKE_IMAGE]);
    prepareControlVideo.mockResolvedValue({
      filename: FAKE_PREP,
      effectiveDurationSeconds: 3,
      targetFps: 25,
      startOffsetSeconds: 0,
    });
  });

  it("parked Wan VACE presets are rejected by the API", async () => {
    await expect(
      buildComfyArgs(
        {
          prompt: "anime restyle",
          model: "wan_v2v",
          method: "video2video",
          input_video_urls: [VIDEO_URL],
        },
        OUTPUT_DIR,
      ),
    ).rejects.toThrow(/Unknown video2video model "wan_v2v"/);
    await expect(
      buildComfyArgs(
        {
          prompt: "dance",
          model: "wan_motion",
          method: "video2video",
          input_video_urls: [VIDEO_URL],
          input_images: [IMAGE_URL],
        },
        OUTPUT_DIR,
      ),
    ).rejects.toThrow(/Unknown video2video model "wan_motion"/);
  });

  it("ltx_ic_lora runs shared prepareControlVideo before payload", async () => {
    const { payload } = await buildComfyArgs(
      {
        prompt: "ruins walk",
        model: "ltx_ic_lora",
        method: "video2video",
        input_video_urls: [VIDEO_URL],
        input_images: [IMAGE_URL],
        duration_seconds: 3,
        start_offset_seconds: 1.5,
        aspect_ratio: "1:1",
      },
      OUTPUT_DIR,
    );
    expect(downloadVideoToComfyInput).toHaveBeenCalledWith([VIDEO_URL]);
    expect(prepareControlVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: FAKE_VIDEO,
        startOffsetSeconds: 1.5,
        durationSeconds: 3,
        profile: expect.objectContaining({ targetFps: 25 }),
      }),
    );
    expect(payload.inputVideoFilename).toBe(FAKE_PREP);
    expect(payload.durationSeconds).toBe(3);
    expect(payload.fps).toBe(25);
    expect(payload.inputImageFilename).toBe(FAKE_IMAGE);
  });

  it("wan_animate requires reference image and uses 16fps prepare profile", async () => {
    await expect(
      buildComfyArgs(
        {
          prompt: "pose transfer",
          model: "wan_animate",
          method: "video2video",
          input_video_urls: [VIDEO_URL],
        },
        OUTPUT_DIR,
      ),
    ).rejects.toThrow(/requires input_images/);

    prepareControlVideo.mockResolvedValueOnce({
      filename: FAKE_PREP,
      effectiveDurationSeconds: 5,
      targetFps: 16,
      startOffsetSeconds: 0,
    });
    const { payload } = await buildComfyArgs(
      {
        prompt: "pose transfer",
        model: "wan_animate",
        method: "video2video",
        input_video_urls: [VIDEO_URL],
        input_images: [IMAGE_URL],
        duration_seconds: 5,
        aspect_ratio: "1:1",
      },
      OUTPUT_DIR,
    );
    expect(prepareControlVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({ targetFps: 16 }),
      }),
    );
    expect(payload.managedWorkflowId).toBe("video2video-wan_animate_2");
    expect(payload.fps).toBe(16);
    expect(payload.inputImageFilename).toBe(FAKE_IMAGE);
    expect(payload.expectVideo).toBe(true);
  });

  // Builders kept for a possible VACE revival (presets commented out above).
  it("classic V2V builder patches video, prompt, length, and slice", () => {
    const workflow = WanVaceVideo2VideoWorkflow({
      prompt: "oil painting",
      inputVideoFilename: "clip.mp4",
      durationSeconds: 2,
      fps: 16,
      seed: 7,
    });
    expect(workflow["10"].inputs.file).toBe("clip.mp4");
    expect(workflow["30"].inputs.text).toBe("oil painting");
    // 2s × 16fps = 32 → snap to Wan 4n+1 = 33
    expect(workflow["40"].inputs.length).toBe(33);
    // WAN v2v++: LoadVideo → Video Slice(92) → components → optional resize(96)
    expect(workflow["11"].inputs.video).toEqual(["92", 0]);
    expect(workflow["92"].inputs.duration).toBe(2);
    expect(workflow["40"].inputs.control_video).toEqual(["96", 0]);
    expect(workflow["40"].inputs.reference_image).toBeUndefined();
    expect(workflow["60"].inputs.noise_seed).toBe(7);
  });

  it("motion builder patches video + reference image", () => {
    const workflow = WanVaceMotionTransferWorkflow({
      prompt: "dance",
      inputVideoFilename: "dance.mp4",
      inputImageFilename: "hero.png",
      width: 512,
      height: 512,
      durationSeconds: 4,
      fps: 16,
    });
    expect(workflow["10"].inputs.file).toBe("dance.mp4");
    expect(workflow["12"].inputs.image).toBe("hero.png");
    expect(workflow["40"].inputs.reference_image).toEqual(["12", 0]);
    expect(workflow["40"].inputs.width).toBe(512);
    expect(workflow["40"].inputs.control_video).toEqual(["96", 0]);
    expect(workflow["92"].inputs.duration).toBe(4);
    // 4s × 16fps = 64 → 4n+1 = 65
    expect(workflow["40"].inputs.length).toBe(65);
  });
});
