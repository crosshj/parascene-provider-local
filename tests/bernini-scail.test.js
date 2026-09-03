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
const BerniniRImage = require("../server/workflows/image2image/bernini_r.js");
const BerniniRVideo = require("../server/workflows/video2video/bernini_r.js");
const WanScail2 = require("../server/workflows/video2video/wan_scail_2.js");

const OUTPUT_DIR = "/fake/output";
const VIDEO_URL = "http://example.com/clip.mp4";
const IMAGE_URL = "http://example.com/char.png";

describe("Bernini + SCAIL builders", () => {
  it("bernini image patches source image and prompt", () => {
    const wf = BerniniRImage({
      prompt: "make it night",
      inputImageFilename: "scene.png",
      seed: 9,
      width: 1024,
      height: 768,
    });
    expect(wf["114"].inputs.image).toBe("scene.png");
    expect(wf["76:120"].inputs.value).toBe("make it night");
    expect(wf["76:19"].inputs.noise_seed).toBe(9);
    expect(wf["116"].inputs["resize_type.longer_size"]).toBe(1024);
    expect(wf["115"].class_type).toBe("SaveImage");
  });

  it("bernini video patches file, prompt, and slice duration", () => {
    const wf = BerniniRVideo({
      prompt: "urban street",
      inputVideoFilename: "prep.mp4",
      durationSeconds: 4,
      seed: 3,
    });
    expect(wf["47"].inputs.file).toBe("prep.mp4");
    expect(wf["298:297"].inputs.value).toBe("urban street");
    expect(wf["109"].inputs.start_time).toBe(0);
    expect(wf["109"].inputs.duration).toBe(4);
    expect(wf["298:275"].inputs.noise_seed).toBe(3);
    expect(wf["46"].class_type).toBe("SaveVideo");
  });

  it("scail patches media/prompt and swaps unet for fp16", () => {
    const wf = WanScail2({
      prompt: "streetwear character",
      inputVideoFilename: "drive.mp4",
      inputImageFilename: "ref.png",
      seed: 11,
      diffusionModelComfyName: "wan2.1_14B_SCAIL_2_fp16.safetensors",
    });
    expect(wf["155"].inputs.file).toBe("drive.mp4");
    expect(wf["30"].inputs.image).toBe("ref.png");
    expect(wf["213:3"].inputs.text).toBe("streetwear character");
    expect(wf["262:258"].inputs.text).toBe("streetwear character");
    expect(wf["213:154"].inputs.unet_name).toBe(
      "wan2.1_14B_SCAIL_2_fp16.safetensors",
    );
    expect(wf["262:223"].inputs.unet_name).toBe(
      "wan2.1_14B_SCAIL_2_fp16.safetensors",
    );
    expect(wf["213:19"].inputs.noise_seed).toBe(11);
    expect(wf["271"].class_type).toBe("SaveVideo");
  });
});

describe("Bernini + SCAIL comfy-args", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    downloadVideoToComfyInput.mockResolvedValue(["video_x.mp4"]);
    downloadImagesToComfyInput.mockResolvedValue(["image_x.png"]);
    prepareControlVideo.mockResolvedValue({
      filename: "prep_x.mp4",
      effectiveDurationSeconds: 5,
      targetFps: 16,
      startOffsetSeconds: 0,
    });
  });

  it("bernini_r_i2i does not run video prepare", async () => {
    const { payload } = await buildComfyArgs(
      {
        prompt: "night",
        model: "bernini_r_i2i",
        method: "image2image",
        input_images: [IMAGE_URL],
      },
      OUTPUT_DIR,
    );
    expect(prepareControlVideo).not.toHaveBeenCalled();
    expect(payload.managedWorkflowId).toBe("image2image-bernini_r");
    expect(payload.inputImageFilename).toBe("image_x.png");
    expect(payload.expectVideo).toBeUndefined();
  });

  it("bernini_r_v2v prepares control video and skips reference image", async () => {
    const { payload } = await buildComfyArgs(
      {
        prompt: "street",
        model: "bernini_r_v2v",
        method: "video2video",
        input_video_urls: [VIDEO_URL],
        duration_seconds: 5,
      },
      OUTPUT_DIR,
    );
    expect(prepareControlVideo).toHaveBeenCalled();
    expect(payload.managedWorkflowId).toBe("video2video-bernini_r");
    expect(payload.inputVideoFilename).toBe("prep_x.mp4");
    expect(payload.inputImageFilename).toBeUndefined();
    expect(payload.expectVideo).toBe(true);
  });

  it("wan_scail requires reference image and uses int8 unet name", async () => {
    await expect(
      buildComfyArgs(
        {
          prompt: "replace",
          model: "wan_scail",
          method: "video2video",
          input_video_urls: [VIDEO_URL],
        },
        OUTPUT_DIR,
      ),
    ).rejects.toThrow(/requires input_images/);

    const { payload } = await buildComfyArgs(
      {
        prompt: "replace",
        model: "wan_scail",
        method: "video2video",
        input_video_urls: [VIDEO_URL],
        input_images: [IMAGE_URL],
      },
      OUTPUT_DIR,
    );
    expect(payload.managedWorkflowId).toBe("video2video-wan_scail_2");
    expect(payload.diffusionModelComfyName).toBe(
      "wan2.1_14B_SCAIL_2_int8_convrot.safetensors",
    );
    expect(payload.inputImageFilename).toBe("image_x.png");
  });

  it("wan_scail_fp16 shares builder with fp16 unet", async () => {
    const { payload } = await buildComfyArgs(
      {
        prompt: "replace",
        model: "wan_scail_fp16",
        method: "video2video",
        input_video_urls: [VIDEO_URL],
        input_images: [IMAGE_URL],
      },
      OUTPUT_DIR,
    );
    expect(payload.managedWorkflowId).toBe("video2video-wan_scail_2");
    expect(payload.diffusionModelComfyName).toBe(
      "wan2.1_14B_SCAIL_2_fp16.safetensors",
    );
  });
});
