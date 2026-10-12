/* eslint-env jest */
"use strict";

const {
  sanitizePromptForComfyApi,
} = require("../server/workflows/_api-sanitize.js");
const Yue2 = require("../server/workflows/text2audio/yue2.js");
const Yue2Cover = require("../server/workflows/audio2audio/yue2_cover.js");
const { buildWorkflowByFamily } = require("../server/workflows/_index.js");

describe("sanitizePromptForComfyApi", () => {
  it("adds format.quality so SaveAudioAdvanced mp3 matches the UI widget", () => {
    const wf = {
      save: {
        class_type: "SaveAudioAdvanced",
        inputs: { format: "mp3", filename_prefix: "audio/x", audio: ["dec", 0] },
      },
    };
    sanitizePromptForComfyApi(wf);
    expect(wf.save.inputs["format.quality"]).toBe("V0");
  });

  it("rewires consumers off PreviewAny so display nodes are not in the data path", () => {
    const wf = {
      src: { class_type: "YuE2GenerateABC", inputs: {} },
      prev: {
        class_type: "PreviewAny",
        inputs: { source: ["src", 0] },
      },
      gen: {
        class_type: "YuE2GenerateMusic",
        inputs: { abc: ["prev", 0] },
      },
    };
    sanitizePromptForComfyApi(wf);
    expect(wf.gen.inputs.abc).toEqual(["src", 0]);
    expect(wf.prev.inputs.source).toEqual(["src", 0]);
  });

  it("keeps an explicit quality override", () => {
    const wf = {
      save: {
        class_type: "SaveAudioAdvanced",
        inputs: {
          format: "mp3",
          quality: "320k",
          audio: ["dec", 0],
        },
      },
    };
    sanitizePromptForComfyApi(wf);
    expect(wf.save.inputs["format.quality"]).toBe("320k");
  });
});

describe("YuE graphs", () => {
  it("text2music does not feed GenerateMusic from PreviewAny and saves mp3 with quality", () => {
    const yue = Yue2({ prompt: "lofi rain" });
    expect(yue["33:25"].inputs.abc).toEqual(["33:30", 0]);
    expect(yue["33:31"].inputs.value).toBe(true);
    expect(yue["33:14"].class_type).toBe("PreviewAny");
    expect(yue["10"].inputs.format).toBe("mp3");
    expect(yue["10"].inputs["format.quality"]).toBe("V0");

    const scored = Yue2({ prompt: "lofi rain", abc: "X:1\nT:User\nK:G\nGABc|" });
    expect(scored["33:31"].inputs.value).toBe(false);
    expect(scored["33:32"].inputs.value).toBe("X:1\nT:User\nK:G\nGABc|");
    expect(scored["33:25"].inputs.abc).toEqual(["33:30", 0]);

    const submitted = buildWorkflowByFamily({
      managedWorkflowId: "text2audio-yue2",
      prompt: "lofi rain",
    });
    expect(submitted["33:25"].inputs.abc[0]).not.toBe("33:14");
    expect(submitted["10"].inputs["format.quality"]).toBe("V0");
  });

  it("blank lyrics run the instrumental AR LoRA and write a bare plan", () => {
    const yue = Yue2({ prompt: "dark ambient piano" });
    expect(yue["33:37"].inputs.value).toBe("[instrumental]");
    expect(yue["33:40"].class_type).toBe("LoraLoader");
    expect(yue["33:40"].inputs.lora_name).toBe(
      "ar_lora_inst_v3abc_comfyui.safetensors",
    );
    expect(yue["33:40"].inputs.strength_model).toBe(0);
    expect(yue["33:40"].inputs.strength_clip).toBe(1);
    expect(yue["33:40"].inputs.clip).toEqual(["33:15", 1]);
    expect(yue["33:24"].inputs.clip).toEqual(["33:40", 1]);
    expect(yue["33:25"].inputs.clip).toEqual(["33:40", 1]);
    expect(yue["33:8"].inputs.model).toEqual(["33:15", 0]);
    expect(yue["33:24"].inputs.mode).toBe("full");
    expect(yue["33:25"].inputs.mode).toBe("full");
  });

  it("tag-only lyrics keep the plan and enable the instrumental LoRA", () => {
    const plan = "[intro]\n[verse]\n[chorus 0:45-1:10]\n[outro]";
    const yue = Yue2({ prompt: "slow piano", lyrics: plan });
    expect(yue["33:37"].inputs.value).toBe(plan);
    expect(yue["33:40"].inputs.lora_name).toBe(
      "ar_lora_inst_v3abc_comfyui.safetensors",
    );
    expect(yue["33:25"].inputs.clip).toEqual(["33:40", 1]);
  });

  it("sung lyrics stay on the checkpoint CLIP path", () => {
    const yue = Yue2({
      prompt: "indie pop",
      lyrics: "[Verse]\nMorning light across the window",
    });
    expect(yue["33:37"].inputs.value).toBe(
      "[Verse]\nMorning light across the window",
    );
    expect(yue["33:40"]).toBeUndefined();
    expect(yue["33:24"].inputs.clip).toEqual(["33:15", 1]);
    expect(yue["33:25"].inputs.clip).toEqual(["33:15", 1]);
  });

  it("cover does not feed GenerateMusic from PreviewAny", () => {
    const wf = Yue2Cover({
      prompt: "jazz",
      inputAudioFilename: "src.mp3",
    });
    expect(wf["33:25"].inputs.abc).toEqual(["33:41", 0]);
    expect(wf["33:44"].class_type).toBe("PreviewAny");
    expect(wf["10"].inputs["format.quality"]).toBe("V0");
  });
});
