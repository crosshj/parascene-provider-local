/* eslint-env jest */

"use strict";

const path = require("path");

// Resolve from project root so the test works regardless of CWD.
const workflowsIndexPath = path.join(
  __dirname,
  "..",
  "server",
  "generator",
  "workflows",
  "_index.js",
);
const workflowsDefaultsPath = path.join(
  __dirname,
  "..",
  "server",
  "generator",
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

  it.each(ids)("can build workflow and defaults for %s", (id) => {
    const wf = buildWorkflowByFamily({ managedWorkflowId: id });
    expect(typeof wf).toBe("object");

    const defaults = _loadTemplateDefaults(id);
    expect(defaults).not.toBeNull();
    expect(typeof defaults.steps).toBe("number");
    expect(typeof defaults.cfg).toBe("number");
    expect(typeof defaults.width).toBe("number");
    expect(typeof defaults.height).toBe("number");
  });
}
);

