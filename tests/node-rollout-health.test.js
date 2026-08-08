/* eslint-env jest */
"use strict";

const path = require("path");
const {
  healthMatchesRelease,
} = require("../service/src/supervisor/nodeAppManager.js");

describe("healthMatchesRelease", () => {
  const releaseRoot = path.join(
    "C:",
    "svc",
    "runtime",
    "releases",
    "2026-08-08_224736_044e5ef2e56b",
  );

  it("matches public_dir_abs under the release root", () => {
    expect(
      healthMatchesRelease(
        {
          public_dir_abs: path.join(releaseRoot, "server", "public"),
        },
        releaseRoot,
      ),
    ).toBe(true);
  });

  it("rejects a different release path", () => {
    const other = path.join(
      "C:",
      "svc",
      "runtime",
      "releases",
      "2026-08-08_044711_c8fd96968713",
      "server",
      "public",
    );
    expect(
      healthMatchesRelease({ public_dir_abs: other }, releaseRoot),
    ).toBe(false);
  });

  it("falls back to release id in relative public_dir", () => {
    expect(
      healthMatchesRelease(
        {
          public_dir:
            "runtime/releases/2026-08-08_224736_044e5ef2e56b/server/public",
        },
        releaseRoot,
      ),
    ).toBe(true);
  });
});
