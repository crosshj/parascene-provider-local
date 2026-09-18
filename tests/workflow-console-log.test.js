/* eslint-env jest */
"use strict";

const {
  CONSOLE_LOG_NODE_ID,
  DEFAULT_CONSOLE_LOG_TEXT,
  composeRunConsoleLog,
  ensureConsoleLog,
} = require("../server/workflows/_console-log.js");
const { buildWorkflowByFamily } = require("../server/workflows/_index.js");

describe("workflow ConsoleLog banner", () => {
  it("composes a bordered run summary from overrides", () => {
    const text = composeRunConsoleLog({
      managedWorkflowId: "text2image-krea2_turbo",
      modelFile: "krea2_turbo_fp8_scaled.safetensors",
      width: 1344,
      height: 768,
      seed: 42,
      prompt: "a fish in the ocean",
    });
    expect(text.startsWith("=========\n")).toBe(true);
    expect(text.endsWith("\n=========")).toBe(true);
    expect(text).toContain("workflow: text2image-krea2_turbo");
    expect(text).toContain("model: krea2_turbo_fp8_scaled.safetensors");
    expect(text).toContain("size: 1344x768");
    expect(text).toContain("seed: 42");
    expect(text).toContain("prompt: a fish in the ocean");
  });

  it("falls back to the default placeholder when empty", () => {
    expect(composeRunConsoleLog({})).toBe(DEFAULT_CONSOLE_LOG_TEXT);
  });

  it("puts ConsoleLog first and removes duplicates", () => {
    const wf = ensureConsoleLog(
      {
        "30:5": {
          class_type: "EmptyLatentImage",
          inputs: { width: 1024, height: 1024 },
        },
        old_log: {
          class_type: "ConsoleLog",
          inputs: { text: "stale" },
        },
      },
      { managedWorkflowId: "text2image-krea2_turbo", seed: 1 },
    );
    const keys = Object.keys(wf);
    expect(keys[0]).toBe(CONSOLE_LOG_NODE_ID);
    expect(wf[CONSOLE_LOG_NODE_ID].class_type).toBe("ConsoleLog");
    expect(wf[CONSOLE_LOG_NODE_ID].inputs.text).toContain(
      "workflow: text2image-krea2_turbo",
    );
    expect(wf.old_log).toBeUndefined();
    expect(keys.filter((k) => wf[k].class_type === "ConsoleLog")).toEqual([
      CONSOLE_LOG_NODE_ID,
    ]);
  });

  it("buildWorkflowByFamily always injects a top ConsoleLog", () => {
    const wf = buildWorkflowByFamily({
      managedWorkflowId: "text2image-krea2_turbo",
      prompt: "neon",
      width: 1024,
      height: 1024,
      seed: 9,
      diffusionModelComfyName: "krea2\\krea2_turbo_fp8_scaled.safetensors",
    });
    expect(Object.keys(wf)[0]).toBe(CONSOLE_LOG_NODE_ID);
    expect(wf[CONSOLE_LOG_NODE_ID].inputs.text).toContain(
      "workflow: text2image-krea2_turbo",
    );
    expect(wf[CONSOLE_LOG_NODE_ID].inputs.text).toContain("prompt: neon");
  });
});
