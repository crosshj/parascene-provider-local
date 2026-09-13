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
  ])("bypasses ResolutionSelector for %s when aspectRatio is 4:5", (id) => {
    const wf = buildWorkflowByFamily({
      managedWorkflowId: id,
      aspectRatio: "4:5",
    });
    const selectorNodes = Object.values(wf).filter(
      (node) => node?.class_type === "ResolutionSelector",
    );
    const targetNode = id.startsWith("text2video")
      ? wf["105:104"]
      : id.startsWith("image2video")
        ? wf["105:104"]
        : wf["136"];

    expect(selectorNodes).toHaveLength(0);
    expect(targetNode.inputs.width).toBe(896);
    expect(targetNode.inputs.height).toBe(1120);
  });

  it.each(ids)("can build workflow for %s", (id) => {
    const wf = buildWorkflowByFamily({ managedWorkflowId: id });
    expect(typeof wf).toBe("object");
    expect(Object.keys(wf).length).toBeGreaterThan(0);

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
});
