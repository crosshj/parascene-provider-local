/* eslint-env jest */

"use strict";

const path = require("path");

// Resolve from project root so the test works regardless of CWD.
const workflowsIndexPath = path.join(
  __dirname,
  "..",
  "server",
  "workflows",
  "_index.js",
);
const workflowsDefaultsPath = path.join(
  __dirname,
  "..",
  "server",
  "workflows",
  "_defaults.js",
);

// eslint-disable-next-line import/no-dynamic-require, global-require
const { WORKFLOWS, buildWorkflowByFamily } = require(workflowsIndexPath);
// eslint-disable-next-line import/no-dynamic-require, global-require
const { _loadTemplateDefaults } = require(workflowsDefaultsPath);

describe("managed workflows", () => {
  const ids = Object.keys(WORKFLOWS);

  it("has at least one managed workflow registered", () => {
    expect(ids.length).toBeGreaterThan(0);
  });

  it.each([
    "text2video-minimax_h3_t2v",
    "image2video-minimax_h3_i2v",
    "reference2video-minimax_h3_r2v",
    "reference2video-minimax_h3_r2v_turbo",
    "reference2video-minimax_h3_r2v_pdd",
    "text2image-krea2_turbo",
    "image2image-krea2_style_ref",
    "text2image-flux3-klein",
    "text2image-qwen-image-2_1",
    "text2image-qwen-image-2_1_turbo",
    "text2image-moss-image",
    "image2image-flux3-klein",
    "image2image-qwen-image-2_1",
    "image2image-qwen-image-2_1_turbo",
    "image2image-moss-image",
  ])("has no ResolutionSelector for %s", (id) => {
    const wf = buildWorkflowByFamily({
      managedWorkflowId: id,
      aspectRatio: "4:5",
      width: 896,
      height: 1120,
    });
    const selectorNodes = Object.values(wf).filter(
      (node) => node?.class_type === "ResolutionSelector",
    );
    expect(selectorNodes).toHaveLength(0);

    if (id === "text2image-krea2_turbo") {
      expect(wf["30:5"].inputs.width).toBe(896);
      expect(wf["30:5"].inputs.height).toBe(1120);
    } else if (id === "text2image-flux3-klein") {
      expect(wf["18:6"].inputs.width).toBe(896);
      expect(wf["18:6"].inputs.height).toBe(1120);
    } else if (
      id === "text2image-qwen-image-2_1" ||
      id === "text2image-qwen-image-2_1_turbo"
    ) {
      expect(wf["459:456"].inputs.width).toBe(896);
      expect(wf["459:456"].inputs.height).toBe(1120);
    } else if (id === "text2image-moss-image") {
      expect(wf["18:6"].inputs.width).toBe(896);
      expect(wf["18:6"].inputs.height).toBe(1120);
    } else if (id === "image2image-krea2_style_ref") {
      expect(wf["30:5"].inputs.width).toBe(896);
      expect(wf["30:61"].inputs.height).toBe(1120);
    } else if (id === "image2image-flux3-klein") {
      expect(wf["44"].inputs.width).toBe(896);
      expect(wf["44"].inputs.height).toBe(1120);
    } else if (id === "image2image-qwen-image-2_1") {
      expect(wf["459:456"].inputs.width).toBe(896);
      expect(wf["459:456"].inputs.height).toBe(1120);
    } else if (id === "image2image-qwen-image-2_1_turbo") {
      expect(wf["459:456"].inputs.width).toBe(896);
      expect(wf["459:456"].inputs.height).toBe(1120);
    } else if (id === "image2image-moss-image") {
      expect(wf["28"].inputs.width).toBe(896);
      expect(wf["28"].inputs.height).toBe(1120);
    } else if (id.startsWith("text2video") || id.startsWith("image2video")) {
      expect(wf["105:104"].inputs.width).toBe(896);
      expect(wf["105:104"].inputs.height).toBe(1120);
    } else {
      expect(wf["136"].inputs.width).toBe(896);
      expect(wf["136"].inputs.height).toBe(1120);
    }
  });

  it.each(ids)("can build workflow for %s", (id) => {
    const wf = buildWorkflowByFamily({ managedWorkflowId: id });
    expect(typeof wf).toBe("object");
    expect(Object.keys(wf).length).toBeGreaterThan(0);
    expect(Object.keys(wf)[0]).toBe("0");
    expect(wf["0"].class_type).toBe("ConsoleLog");

    // Template defaults are extracted only for classic text2image layouts
    // (KSampler "31" + latent "27"/"39"). Other families may return null.
    const defaults = _loadTemplateDefaults(id);
    if (defaults) {
      expect(typeof defaults.steps).toBe("number");
      expect(typeof defaults.cfg).toBe("number");
      expect(typeof defaults.width).toBe("number");
      expect(typeof defaults.height).toBe("number");
    }
  });

  it("routes only caller images into Qwen Image 2.1 editing", () => {
    const singleImage = buildWorkflowByFamily({
      managedWorkflowId: "image2image-qwen-image-2_1",
      inputImageFilename: "uploaded-primary.png",
    });
    expect(singleImage["470"].inputs.image).toBe("uploaded-primary.png");
    expect(singleImage["475"].inputs.image).toBe("uploaded-primary.png");
    expect(singleImage["459:474"].inputs["images.image_1"]).toEqual([
      "470",
      0,
    ]);
    expect(singleImage["459:474"].inputs).not.toHaveProperty(
      "images.image_2",
    );

    const twoImages = buildWorkflowByFamily({
      managedWorkflowId: "image2image-qwen-image-2_1",
      inputImageFilename: "uploaded-primary.png",
      secondaryImageFilename: "uploaded-secondary.png",
    });
    expect(twoImages["470"].inputs.image).toBe("uploaded-primary.png");
    expect(twoImages["475"].inputs.image).toBe("uploaded-secondary.png");
    expect(twoImages["459:474"].inputs["images.image_2"]).toEqual([
      "475",
      0,
    ]);
  });

  it("uses the official Turbo T2I graph with API overrides", () => {
    const workflow = buildWorkflowByFamily({
      managedWorkflowId: "text2image-qwen-image-2_1_turbo",
      prompt: "a small red boat on a quiet lake",
      seed: 12345,
      cfg: 2.5,
      width: 896,
      height: 1120,
    });
    expect(workflow["459:451"].inputs.unet_name).toBe(
      "qwen_image_2.1_turbo_int8_convrot.safetensors",
    );
    expect(workflow["459:474"].inputs.on_false).toBe(
      "a small red boat on a quiet lake",
    );
    expect(workflow["459:488"].inputs.noise_seed).toBe(12345);
    expect(workflow["459:484"].inputs.sigmas).toContain("0.845148");
    expect(workflow["459:489"].inputs.cfg).toBe(2.5);
    expect(workflow["459:486"].inputs.latent_image).toEqual([
      "459:456",
      0,
    ]);
    expect(
      Object.values(workflow).some(
        (node) => node?.class_type === "ResolutionSelector",
      ),
    ).toBe(false);
    expect(workflow["459:456"].inputs.width).toBe(896);
    expect(workflow["459:456"].inputs.height).toBe(1120);
  });

  it("routes the caller image through MOSS scale and edit encoders", () => {
    const workflow = buildWorkflowByFamily({
      managedWorkflowId: "image2image-moss-image",
      inputImageFilename: "uploaded-moss.png",
      prompt: "replace the jacket with a blue coat",
      seed: 12345,
      steps: 18,
      cfg: 3.5,
    });
    expect(workflow["8"].inputs.image).toBe("uploaded-moss.png");
    expect(workflow["29"].inputs.image).toEqual(["8", 0]);
    expect(workflow["36"].inputs["images.image_0"]).toEqual(["29", 0]);
    expect(workflow["39"].inputs["images.image_0"]).toEqual(["29", 0]);
    expect(workflow["39"].inputs.prompt).toBe(
      "replace the jacket with a blue coat",
    );
    expect(workflow["37"].inputs.seed).toBe(12345);
    expect(workflow["37"].inputs.steps).toBe(18);
    expect(workflow["37"].inputs.cfg).toBe(3.5);
  });
});
