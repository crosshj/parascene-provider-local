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
    expect(yue["33:14"].class_type).toBe("PreviewAny");
    expect(yue["10"].inputs.format).toBe("mp3");
    expect(yue["10"].inputs["format.quality"]).toBe("V0");

    const submitted = buildWorkflowByFamily({
      managedWorkflowId: "text2audio-yue2",
      prompt: "lofi rain",
    });
    expect(submitted["33:25"].inputs.abc[0]).not.toBe("33:14");
    expect(submitted["10"].inputs["format.quality"]).toBe("V0");
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
