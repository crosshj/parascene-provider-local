/* eslint-env jest */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), "inbox-graduation-"),
);

jest.mock("../server/lib/aspect-ratio.js", () => {
  const actual = jest.requireActual("../server/lib/aspect-ratio.js");
  return {
    ...actual,
    resolveAspectRatioFromInputImage: jest.fn(
      async ({ body, inputFilename }) => {
        const dims = actual.resolveAspectRatioDimensions(
          String(body.aspect_ratio ?? "1:1").trim() || "1:1",
          1024,
          1024,
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
  downloadImagesToComfyInput: jest.fn(async () => ["input_1_abc.png"]),
  ensureAudio2videoPlaceholderImage: jest.fn(async () => "a2v_placeholder.png"),
  COMFY_INPUT_DIR: "/fake/comfy/input",
  A2V_PLACEHOLDER_IMAGE_FILENAME: "a2v_placeholder.png",
}));

jest.mock("../server/generator/audio-input.js", () => ({
  downloadAudioToComfyInput: jest.fn(async () => ["audio_1_abc.mp3"]),
}));

jest.mock("../server/generator/video-input.js", () => ({
  downloadVideoToComfyInput: jest.fn(async () => ["video_1_abc.mp4"]),
}));

jest.mock("../server/lib/video-prepare.js", () => {
  const actual = jest.requireActual("../server/lib/video-prepare.js");
  return {
    ...actual,
    prepareControlVideo: jest.fn(async ({ filename, durationSeconds }) => ({
      filename: "prep_1_abcd.mp4",
      effectiveDurationSeconds: durationSeconds || 5,
      targetFps: 25,
      startOffsetSeconds: 0,
    })),
  };
});

jest.mock("../server/lib/model-registry.js", () => ({
  resolveModel: jest.fn(() => ({
    modelId: "diffusion_models/krea2/krea2_turbo_fp8_scaled.safetensors",
    name: "krea2_turbo_fp8_scaled",
    file: "krea2_turbo_fp8_scaled.safetensors",
    family: "krea2",
    fullPath: "/fake/krea2_turbo_fp8_scaled.safetensors",
    loadKind: "diffusion_model",
    managedWorkflowId: "text2image-krea2_turbo",
    comfyCheckpointGroup: null,
    diffusionModelComfyName: "krea2\\krea2_turbo_fp8_scaled.safetensors",
    defaults: { width: 1024, height: 1024, steps: 20, cfg: 7 },
  })),
  getModels: jest.fn(() => []),
}));

jest.mock("../server/generator/index.js", () => ({
  runComfyGeneration: jest.fn(() => new Promise(() => {})),
  hasWorkflow: jest.fn(() => true),
  ensureManagedComfyReady: jest.fn(async () => ({ running: true })),
  getManagedComfyStatus: jest.fn(),
}));

const { downloadImagesToComfyInput } = require("../server/generator/image-input.js");
const { downloadAudioToComfyInput } = require("../server/generator/audio-input.js");
const { buildComfyArgs } = require("../server/lib/comfy-args.js");
const {
  contentTypeForArtifactFilename,
  handleApiPost,
} = require("../server/handlers/api.js");
const { occupancyPeek, reloadPersistedQueueForTests } = require("../server/lib/scheduler.js");
const { WORKFLOWS } = require("../server/workflows/_index.js");

const Krea2Turbo = require("../server/workflows/text2image/krea2_turbo.js");
const Krea2Style = require("../server/workflows/image2image/krea2_style_ref.js");
const FastH3 = require("../server/workflows/image2video/fastvideo_fasth3_i2v.js");
const Yue2 = require("../server/workflows/text2audio/yue2.js");
const Yue2Cover = require("../server/workflows/audio2audio/yue2_cover.js");
const Music3 = require("../server/workflows/text2audio/minimax_music3.js");
const Ltx25T2a = require("../server/workflows/text2audio/ltx2_5_t2a.js");
const Ltx25T2v = require("../server/workflows/text2video/ltx2_5_t2v.js");
const Ltx25I2v = require("../server/workflows/image2video/ltx2_5.js");
const Ltx25Flf = require("../server/workflows/image2video/ltx2_5_flf2v.js");
const Ltx25A2v = require("../server/workflows/imageAudio2video/ltx2_5_ia2v.js");
const Ltx25Ic = require("../server/workflows/video2video/ltx2_5_ic_lora.js");
const Ltx25Ing = require("../server/workflows/reference2video/ltx2_5_ic_lora_ingredients.js");

const OUTPUT_DIR = path.join(process.env.DATA_ROOT, "out");
const STATE_PATH = path.join(
  process.env.DATA_ROOT,
  "runtime",
  "jobs-state.json",
);
const TOKEN = "parascene-local-dev-token";
const IMAGE_URL = "http://example.com/start.png";
const AUDIO_URL = "http://example.com/clip.mp3";
const VIDEO_URL = "http://example.com/clip.mp4";

function fakeReq(body) {
  const str = JSON.stringify(body);
  return {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    setEncoding() {},
    on(event, cb) {
      if (event === "data") cb(str);
      if (event === "end") cb();
      return this;
    },
  };
}

function fakeRes() {
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  return {
    statusCode: null,
    _headers: {},
    _body: null,
    _done: done,
    setHeader(key, value) {
      this._headers[key] = value;
    },
    writeHead(code, headers) {
      this.statusCode = code;
      if (headers) Object.assign(this._headers, headers);
    },
    end(data) {
      this._body = data;
      if (this.statusCode == null) this.statusCode = 200;
      resolveDone();
    },
  };
}

async function postApi(body) {
  const res = fakeRes();
  await handleApiPost(fakeReq(body), res, { outputDir: OUTPUT_DIR });
  return res;
}

function assertNoCloudNodes(wf) {
  const blob = JSON.stringify(wf);
  expect(blob).not.toMatch(/GemmaAPITextEncode/);
  expect(blob).not.toMatch(/ltx_api_key/);
  expect(blob).not.toMatch(/huggingface\.co/i);
}

describe("inbox graduation builders", () => {
  it("krea2 turbo patches prompt, seed, size, and unet", () => {
    const wf = Krea2Turbo({
      prompt: "neon alley",
      seed: 11,
      width: 1344,
      height: 768,
      diffusionModelComfyName: "krea2\\krea2_turbo_int8_convrot.safetensors",
    });
    expect(wf["30:19"].inputs.value).toBe("neon alley");
    expect(wf["30:3"].inputs.seed).toBe(11);
    expect(wf["30:5"].inputs.width).toBe(1344);
    expect(wf["30:5"].inputs.height).toBe(768);
    expect(wf["30:10"].inputs.unet_name).toBe(
      "krea2\\krea2_turbo_int8_convrot.safetensors",
    );
    assertNoCloudNodes(wf);
  });

  it("krea2 style-ref patches image, prompt, size, and unet", () => {
    const wf = Krea2Style({
      prompt: "oil paint",
      inputImageFilename: "ref.png",
      seed: 3,
      width: 768,
      height: 1344,
      diffusionModelComfyName: "krea2\\krea2_turbo_int8_convrot.safetensors",
    });
    expect(wf["30:19"].inputs.value).toBe("oil paint");
    expect(wf["69"].inputs.image).toBe("ref.png");
    expect(wf["30:63"].inputs.noise_seed).toBe(3);
    expect(wf["30:5"].inputs.width).toBe(768);
    expect(wf["30:5"].inputs.height).toBe(1344);
    expect(wf["30:61"].inputs.width).toBe(768);
    expect(wf["30:61"].inputs.height).toBe(1344);
    expect(wf["30:64"].inputs.width).toBe(768);
    expect(wf["30:64"].inputs.height).toBe(1344);
    expect(wf["30:10"].inputs.unet_name).toBe(
      "krea2\\krea2_turbo_int8_convrot.safetensors",
    );
  });

  it("FastH3 i2v wires first frame only", () => {
    const wf = FastH3({
      prompt: "walk",
      inputImageFilename: "start.png",
      durationSeconds: 8,
      seed: 9,
    });
    expect(wf["105:104"].inputs.prompt).toBe("walk");
    expect(wf["136"].inputs.image).toBe("start.png");
    expect(wf["105:104"].inputs.first_frame).toEqual(["136", 0]);
    expect(wf["105:104"].inputs.last_frame).toBeUndefined();
    expect(wf["105:111"].inputs.value).toBe(8);
    expect(wf["105:15"].inputs.noise_seed).toBe(9);
  });

  it("FastH3 t2v strips the start-frame chain", () => {
    const wf = FastH3({
      prompt: "city night",
      durationSeconds: 6,
      aspectRatio: "16:9",
      seed: 3,
    });
    expect(wf["105:104"].inputs.prompt).toBe("city night");
    expect(wf["105:104"].inputs.first_frame).toBeUndefined();
    expect(wf["136"]).toBeUndefined();
    expect(wf["141"]).toBeUndefined();
    expect(wf["142"]).toBeUndefined();
    expect(wf["105:104"].inputs.width).toBe(1344);
    expect(wf["105:104"].inputs.height).toBe(768);
    expect(wf["105:111"].inputs.value).toBe(6);
  });

  it("Yue2 / MiniMax Music 3 / LTX T2A patch prompt and lyrics/duration", () => {
    const yue = Yue2({
      prompt: "lofi rain",
      lyrics: "soft words",
      seed: 2,
      durationSeconds: 45,
    });
    expect(yue["33:36"].inputs.value).toBe("lofi rain");
    expect(yue["33:37"].inputs.value).toBe("soft words");
    expect(yue["33:34"].inputs.seed).toBe(2);
    expect(yue["33:25"].inputs.max_duration).toBe(300);
    expect(yue["10"].inputs.format).toBe("mp3");
    expect(yue["10"].inputs["format.quality"]).toBe("V0");
    expect(yue["33:25"].inputs.abc).toEqual(["33:30", 0]);

    const music = Music3({
      prompt: "city pop",
      lyrics: "chorus",
      seed: 4,
      durationSeconds: 40,
    });
    expect(music["37:13"].inputs.caption).toBe("city pop");
    expect(music["37:13"].inputs.lyrics).toBe("chorus");
    expect(music["37:38"].inputs.seed).toBe(4);
    expect(music["37:13"].inputs.max_duration).toBe(300);

    const t2a = Ltx25T2a({
      prompt: "distant thunder",
      durationSeconds: 6,
      seed: 7,
    });
    expect(t2a["6"].inputs.value).toBe("distant thunder");
    expect(t2a["11"].inputs.value).toBe(6);
    expect(t2a["4:5566"].inputs.noise_seed).toBe(7);
    expect(t2a["2:5556"].inputs.switch).toBe(false);
    expect(t2a["5574"].inputs.format).toBe("mp3");
    assertNoCloudNodes(t2a);

    const t2aMagic = Ltx25T2a({
      prompt: "rain on tin",
      promptMagic: true,
      seed: 8,
    });
    expect(t2aMagic["2:5556"].inputs.switch).toBe(true);
    expect(t2aMagic["2:5549"].inputs["sampling_mode.seed"]).toBe(8);
  });

  it("Yue2 cover requires input audio and writes mp3", () => {
    const wf = Yue2Cover({
      prompt: "jazz cover",
      lyrics: "verse",
      inputAudioFilename: "src.mp3",
      seed: 5,
      durationSeconds: 180,
    });
    expect(wf["45"].inputs.audio).toBe("src.mp3");
    expect(wf["33:25"].inputs.style).toBe("jazz cover");
    expect(wf["33:25"].inputs.lyrics).toBe("verse");
    expect(wf["33:25"].inputs.max_duration).toBe(300);
    expect(wf["10"].inputs.format).toBe("mp3");
    expect(wf["10"].inputs["format.quality"]).toBe("V0");
    expect(wf["33:25"].inputs.abc).toEqual(["33:41", 0]);
  });

  it("LTX 2.5 twins match the 2.3 field contract", () => {
    const t2v = Ltx25T2v({
      prompt: "foggy pier",
      seed: 12,
      durationSeconds: 4,
      width: 1280,
      height: 720,
    });
    expect(t2v["405:376"].inputs.value).toBe("foggy pier");
    expect(t2v["405:338"].inputs.noise_seed).toBe(12);
    expect(t2v["405:362"].inputs.value).toBe(4);
    expect(t2v["405:372"].inputs.value).toBe(1280);
    expect(t2v["405:360"].inputs.value).toBe(720);
    assertNoCloudNodes(t2v);

    const i2v = Ltx25I2v({
      prompt: "nods once",
      inputImageFilename: "frame.png",
      seed: 8,
      durationSeconds: 3,
    });
    expect(i2v["398:376"].inputs.value).toBe("nods once");
    expect(i2v["395"].inputs.image).toBe("frame.png");
    expect(i2v["398:383"].inputs.value).toBe(true);
    expect(i2v["398:338"].inputs.noise_seed).toBe(8);
    const i2vOff = Ltx25I2v({
      prompt: "nods once",
      promptMagic: false,
      inputImageFilename: "frame.png",
    });
    expect(i2vOff["398:383"].inputs.value).toBe(false);

    const flf = Ltx25Flf({
      prompt: "morph",
      inputImageFilename: "a.png",
      endImageFilename: "b.png",
      durationSeconds: 5,
    });
    expect(flf["31"].inputs.image).toBe("a.png");
    expect(flf["39"].inputs.image).toBe("b.png");
    expect(flf["251:252"].inputs.value).toBe("morph");

    const a2v = Ltx25A2v({
      prompt: "lip sync",
      inputAudioFilename: "voice.mp3",
      inputImageFilename: "face.png",
      durationSeconds: 4,
      seed: 21,
    });
    expect(a2v["5508"].inputs.value).toBe("lip sync");
    expect(a2v["5600"].inputs.audio).toBe("voice.mp3");
    expect(a2v["2004"].inputs.image).toBe("face.png");
    expect(a2v["5516:4832"].inputs.noise_seed).toBe(21);
    expect(a2v["5014:5506"].inputs.value).toBe(true);
    assertNoCloudNodes(a2v);

    const ic = Ltx25Ic({
      prompt: "follow the path",
      inputVideoFilename: "drive.mp4",
      inputImageFilename: "hero.png",
      durationSeconds: 5,
    });
    expect(ic["5508"].inputs.value).toBe("follow the path");
    expect(ic["5001"].inputs.file).toBe("drive.mp4");
    expect(ic["2004"].inputs.image).toBe("hero.png");
    assertNoCloudNodes(ic);

    const ing = Ltx25Ing({
      prompt: "the knight walks",
      inputImageFilename: "sheet.png",
      durationSeconds: 8,
    });
    expect(ing["5508"].inputs.value).toBe("the knight walks");
    expect(ing["2004"].inputs.image).toBe("sheet.png");
    expect(ing["9008"].inputs.value).toBe(8);
    assertNoCloudNodes(ing);
  });

  it("registers the new managed workflows", () => {
    for (const id of [
      "text2image-krea2_turbo",
      "image2image-krea2_style_ref",
      "image2video-fastvideo_fasth3_i2v",
      "text2video-fastvideo_fasth3_t2v",
      "text2audio-yue2",
      "text2audio-minimax_music3",
      "text2audio-ltx2_5_t2a",
      "audio2audio-yue2_cover",
      "text2video-ltx2_5_t2v",
      "image2video-ltx2_5",
      "image2video-ltx2_5_flf2v",
      "audio2video-ltx2_5_ia2v",
      "video2video-ltx2_5_ic_lora",
      "reference2video-ltx2_5_ic_lora_ingredients",
    ]) {
      expect(typeof WORKFLOWS[id]).toBe("function");
    }
  });

  it("does not advertise duration on music audio methods", () => {
    const { BASE_PROVIDER_CAPABILITIES } = require("../server/configs/provider-api-config.js");
    const t2a = BASE_PROVIDER_CAPABILITIES.methods.text2audio.fields;
    expect(t2a.duration_seconds).toBeUndefined();
    expect(t2a.prompt_magic.default).toBe(false);
    const a2a = BASE_PROVIDER_CAPABILITIES.methods.audio2audio.fields;
    expect(a2a.duration_seconds).toBeUndefined();
  });
});

describe("inbox graduation comfy-args", () => {
  it("text2image krea2 path keeps the shared builder", async () => {
    const { payload } = await buildComfyArgs(
      {
        prompt: "portrait",
        model: "diffusion_models/krea2/krea2_turbo_fp8_scaled.safetensors",
        method: "text2image",
        aspect_ratio: "16:9",
      },
      OUTPUT_DIR,
    );
    expect(payload.managedWorkflowId).toBe("text2image-krea2_turbo");
    expect(payload.diffusionModelComfyName).toBe(
      "krea2\\krea2_turbo_fp8_scaled.safetensors",
    );
    expect(payload.aspectRatio).toBe("16:9");
    expect(payload.width).toBe(1344);
    expect(payload.height).toBe(768);
  });

  it("image2image krea2_style_ref maps to the style-ref workflow", async () => {
    const { payload } = await buildComfyArgs(
      {
        prompt: "in this style",
        model: "krea2_style_ref",
        method: "image2image",
        input_images: [IMAGE_URL],
      },
      OUTPUT_DIR,
    );
    expect(payload.managedWorkflowId).toBe("image2image-krea2_style_ref");
    expect(payload.inputImageFilename).toBe("input_1_abc.png");
    expect(payload.diffusionModelComfyName).toBe(
      "krea2\\krea2_turbo_int8_convrot.safetensors",
    );
    expect(downloadImagesToComfyInput).toHaveBeenCalled();
  });

  it("image2video fasth3_i2v does not advertise flf", async () => {
    const { payload } = await buildComfyArgs(
      {
        prompt: "animate",
        model: "fasth3_i2v",
        method: "image2video",
        input_images: [IMAGE_URL],
      },
      OUTPUT_DIR,
    );
    expect(payload.managedWorkflowId).toBe("image2video-fastvideo_fasth3_i2v");
    expect(payload.endImageFilename).toBeUndefined();
  });

  it("text2video fasth3_t2v reuses the FastH3 i2v graph with no image", async () => {
    const { payload } = await buildComfyArgs(
      {
        prompt: "city night",
        model: "fasth3_t2v",
        method: "text2video",
        duration_seconds: 6,
        aspect_ratio: "16:9",
      },
      OUTPUT_DIR,
    );
    expect(payload.managedWorkflowId).toBe("text2video-fastvideo_fasth3_t2v");
    expect(payload.family).toBe("fasth3-t2v");
    expect(payload.durationSeconds).toBe(6);
    expect(payload.inputImageFilename).toBeUndefined();
    expect(payload.expectVideo).toBe(true);

    const wf = FastH3(payload);
    expect(wf["105:104"].inputs.first_frame).toBeUndefined();
    expect(wf["136"]).toBeUndefined();
  });

  it("text2audio music presets ignore duration; LTX T2A is parked", async () => {
    const yue = await buildComfyArgs(
      {
        prompt: "dream pop",
        model: "yue2",
        method: "text2audio",
        lyrics: "la la",
        duration_seconds: 90,
      },
      OUTPUT_DIR,
    );
    expect(yue.payload.managedWorkflowId).toBe("text2audio-yue2");
    expect(yue.payload.lyrics).toBe("la la");
    expect(yue.payload.durationSeconds).toBeUndefined();
    expect(yue.payload.expectAudio).toBe(true);

    const music = await buildComfyArgs(
      {
        prompt: "city pop",
        model: "minimax_music3",
        method: "text2audio",
        duration_seconds: 90,
      },
      OUTPUT_DIR,
    );
    expect(music.payload.durationSeconds).toBeUndefined();

    await expect(
      buildComfyArgs(
        {
          prompt: "wind in pines",
          model: "ltx25_t2a",
          method: "text2audio",
        },
        OUTPUT_DIR,
      ),
    ).rejects.toThrow(/Unknown text2audio model "ltx25_t2a"/);
  });

  it("audio2audio yue2_cover requires input audio", async () => {
    await expect(
      buildComfyArgs(
        { prompt: "cover", model: "yue2_cover", method: "audio2audio" },
        OUTPUT_DIR,
      ),
    ).rejects.toThrow(/input_audio_urls/);

    const { payload } = await buildComfyArgs(
      {
        prompt: "cover",
        model: "yue2_cover",
        method: "audio2audio",
        input_audio_urls: [AUDIO_URL],
        lyrics: "bridge",
        duration_seconds: 180,
      },
      OUTPUT_DIR,
    );
    expect(payload.managedWorkflowId).toBe("audio2audio-yue2_cover");
    expect(payload.inputAudioFilename).toBe("audio_1_abc.mp3");
    expect(payload.lyrics).toBe("bridge");
    expect(payload.durationSeconds).toBeUndefined();
    expect(downloadAudioToComfyInput).toHaveBeenCalledWith([AUDIO_URL]);
  });

  it("LTX 2.5 presets keep the same methods and fields as 2.3", async () => {
    const t2v = await buildComfyArgs(
      {
        prompt: "camera pan",
        model: "ltx25_t2v",
        method: "text2video",
        duration_seconds: 6,
      },
      OUTPUT_DIR,
    );
    expect(t2v.payload.managedWorkflowId).toBe("text2video-ltx2_5_t2v");
    expect(t2v.payload.durationSeconds).toBe(6);
    expect(t2v.payload.expectVideo).toBe(true);

    downloadImagesToComfyInput.mockResolvedValueOnce([
      "input_1_abc.png",
      "input_456_end.png",
    ]);
    const i2v = await buildComfyArgs(
      {
        prompt: "morph",
        model: "ltx25_i2v",
        method: "image2video",
        input_images: [IMAGE_URL, "http://example.com/end.png"],
        prompt_magic: false,
      },
      OUTPUT_DIR,
    );
    expect(i2v.payload.managedWorkflowId).toBe("image2video-ltx2_5_flf2v");
    expect(i2v.payload.endImageFilename).toBe("input_456_end.png");
    expect(i2v.payload.promptMagic).toBe(false);

    const a2v = await buildComfyArgs(
      {
        prompt: "sing",
        model: "ltx25_a2v",
        method: "audio2video",
        input_audio_urls: [AUDIO_URL],
      },
      OUTPUT_DIR,
    );
    expect(a2v.payload.managedWorkflowId).toBe("audio2video-ltx2_5_ia2v");
    expect(a2v.payload.inputAudioFilename).toBe("audio_1_abc.mp3");
    expect(a2v.payload.useStartingImage).toBe(true);

    const v2v = await buildComfyArgs(
      {
        prompt: "control",
        model: "ltx25_ic_lora",
        method: "video2video",
        input_video_urls: [VIDEO_URL],
        input_images: [IMAGE_URL],
        duration_seconds: 5,
      },
      OUTPUT_DIR,
    );
    expect(v2v.payload.managedWorkflowId).toBe("video2video-ltx2_5_ic_lora");
    expect(v2v.payload.inputVideoFilename).toBe("prep_1_abcd.mp4");
    expect(v2v.payload.inputImageFilename).toBe("input_1_abc.png");

    const r2v = await buildComfyArgs(
      {
        prompt: "sheet",
        model: "ltx25_ingredients",
        method: "reference2video",
        input_images: [IMAGE_URL],
        duration_seconds: 8,
      },
      OUTPUT_DIR,
    );
    expect(r2v.payload.managedWorkflowId).toBe(
      "reference2video-ltx2_5_ic_lora_ingredients",
    );
    expect(r2v.payload.durationSeconds).toBe(8);
  });
});

describe("audio poll Content-Type", () => {
  it("maps mp3 to audio/mpeg", () => {
    expect(contentTypeForArtifactFilename("aud-1.mp3")).toBe("audio/mpeg");
  });

  it("streams succeeded audio jobs as audio/mpeg with X-Credits", async () => {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const fileName = "aud-test.mp3";
    fs.writeFileSync(path.join(OUTPUT_DIR, fileName), Buffer.from("ID3"));
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(
      STATE_PATH,
      JSON.stringify({
        jobs: [
          {
            id: "job_audio_1",
            method: "text2audio",
            status: "succeeded",
            credits: 1,
            result: { file_name: fileName, media_kind: "audio" },
          },
        ],
        pendingOrder: [],
      }),
    );
    await reloadPersistedQueueForTests();

    const res = await postApi({
      method: "text2audio",
      args: { job_id: "job_audio_1" },
    });
    await res._done;
    expect(res.statusCode).toBe(200);
    expect(res._headers["Content-Type"]).toBe("audio/mpeg");
    expect(res._headers["X-Credits"]).toBe("1");
  });

  it("occupancy reports audio jobs as kind audio", async () => {
    const started = await postApi({
      method: "text2audio",
      args: { prompt: "secret song", model: "yue2" },
    });
    expect(started.statusCode).toBe(202);
    for (let i = 0; i < 40; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const peek = occupancyPeek();
    expect(peek.running).toEqual({ kind: "audio", family: "yue2" });
    expect(peek.eta_s).toBeGreaterThan(40);
  });
});
