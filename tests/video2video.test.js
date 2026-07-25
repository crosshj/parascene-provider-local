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

const {
  downloadImagesToComfyInput,
} = require("../server/generator/image-input.js");
const {
  downloadVideoToComfyInput,
} = require("../server/generator/video-input.js");
const { buildComfyArgs } = require("../server/lib/comfy-args.js");
const WanVaceVideo2VideoWorkflow = require("../server/workflows/video2video/wan2_2_vace_v2v.js");
const WanVaceMotionTransferWorkflow = require("../server/workflows/video2video/wan2_2_vace_motion.js");

const OUTPUT_DIR = "/fake/output";
const VIDEO_URL = "http://example.com/motion.mp4";
const IMAGE_URL = "http://example.com/character.png";
const FAKE_VIDEO = "video_123_abc.mp4";
const FAKE_IMAGE = "input_123_abc.png";

describe("video2video", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    downloadVideoToComfyInput.mockResolvedValue([FAKE_VIDEO]);
    downloadImagesToComfyInput.mockResolvedValue([FAKE_IMAGE]);
  });

  it("wan_v2v: video + prompt → classic VACE workflow", async () => {
    const { payload, entry, method } = await buildComfyArgs(
      {
        prompt: "anime restyle",
        model: "wan_v2v",
        method: "video2video",
        input_video_urls: [VIDEO_URL],
        duration_seconds: 3,
      },
      OUTPUT_DIR,
    );
    expect(method).toBe("video2video");
    expect(entry.managedWorkflowId).toBe("video2video-wan2_2_vace_v2v");
    expect(payload.inputVideoFilename).toBe(FAKE_VIDEO);
    expect(payload.inputImageFilename).toBeUndefined();
    expect(payload.durationSeconds).toBe(3);
    expect(payload.expectVideo).toBe(true);
    expect(downloadVideoToComfyInput).toHaveBeenCalledWith([VIDEO_URL]);
    expect(downloadImagesToComfyInput).not.toHaveBeenCalled();
  });

  it("wan_motion: requires character image", async () => {
    await expect(
      buildComfyArgs(
        {
          prompt: "dance",
          model: "wan_motion",
          method: "video2video",
          input_video_urls: [VIDEO_URL],
        },
        OUTPUT_DIR,
      ),
    ).rejects.toThrow(/requires input_images/);
  });

  it("wan_motion: video + image → motion transfer workflow", async () => {
    const { payload } = await buildComfyArgs(
      {
        prompt: "character dances",
        model: "wan_motion",
        method: "video2video",
        input_video_urls: [VIDEO_URL],
        input_images: [IMAGE_URL],
        aspect_ratio: "1:1",
      },
      OUTPUT_DIR,
    );
    expect(payload.managedWorkflowId).toBe("video2video-wan2_2_vace_motion");
    expect(payload.inputVideoFilename).toBe(FAKE_VIDEO);
    expect(payload.inputImageFilename).toBe(FAKE_IMAGE);
    expect(downloadImagesToComfyInput).toHaveBeenCalledWith([IMAGE_URL]);
  });

  it("classic V2V builder patches video, prompt, length", () => {
    const workflow = WanVaceVideo2VideoWorkflow({
      prompt: "oil painting",
      inputVideoFilename: "clip.mp4",
      durationSeconds: 2,
      fps: 16,
      seed: 7,
    });
    expect(workflow["10"].inputs.file).toBe("clip.mp4");
    expect(workflow["30"].inputs.text).toBe("oil painting");
    expect(workflow["40"].inputs.length).toBe(32);
    expect(workflow["40"].inputs.control_video).toEqual(["11", 0]);
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
    });
    expect(workflow["10"].inputs.file).toBe("dance.mp4");
    expect(workflow["12"].inputs.image).toBe("hero.png");
    expect(workflow["40"].inputs.reference_image).toEqual(["12", 0]);
    expect(workflow["40"].inputs.width).toBe(512);
  });
});
