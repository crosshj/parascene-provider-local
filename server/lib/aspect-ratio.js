"use strict";

const fs = require("fs");
const path = require("path");

/** Provider API: aspect ratios advertised to host (matches parascene-provider). */
const ASPECT_RATIO_OPTIONS = ["1:1", "4:5", "9:16", "16:9"];

const RATIO_KEY_RE = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/;

/** Comfy-friendly pixel pairs per workflow base size (multiples of 8). */
const DIMENSIONS_BY_BASE = {
  512: {
    "1:1": { width: 512, height: 512 },
    "16:9": { width: 768, height: 432 },
    "9:16": { width: 432, height: 768 },
    "4:5": { width: 512, height: 640 },
  },
  1024: {
    "1:1": { width: 1024, height: 1024 },
    "16:9": { width: 1344, height: 768 },
    "9:16": { width: 768, height: 1344 },
    "4:5": { width: 896, height: 1120 },
  },
};

const UNSUPPORTED_RATIO_MSG = `Allowed: ${ASPECT_RATIO_OPTIONS.join(", ")}`;

function aspectRatioFieldDef() {
  return {
    label: "Aspect Ratio",
    type: "select",
    hidden: true,
    required: false,
    default: "1:1",
    options: ASPECT_RATIO_OPTIONS.map((value) => ({ label: value, value })),
  };
}

/**
 * Parse "W:H" aspect ratio key to numeric parts and width/height quotient.
 * @param {string} ratioKey
 * @returns {{ key: string, width: number, height: number, value: number }}
 */
function parseAspectRatioKey(ratioKey) {
  const key = String(ratioKey ?? "").trim();
  const m = key.match(RATIO_KEY_RE);
  if (!m) {
    throw new Error(`Invalid aspect ratio key: ${ratioKey}`);
  }
  const width = Number.parseFloat(m[1]);
  const height = Number.parseFloat(m[2]);
  if (!(width > 0 && height > 0)) {
    throw new Error(`Invalid aspect ratio key: ${ratioKey}`);
  }
  return { key, width, height, value: width / height };
}

function normalizeBase(baseWidth, baseHeight) {
  const w = Number(baseWidth);
  const h = Number(baseHeight);
  const short = Math.min(
    Number.isFinite(w) && w > 0 ? w : 1024,
    Number.isFinite(h) && h > 0 ? h : 1024,
  );
  return short <= 512 ? 512 : 1024;
}

function getDimensionsTable(baseWidth, baseHeight) {
  const base = normalizeBase(baseWidth, baseHeight);
  return DIMENSIONS_BY_BASE[base];
}

/**
 * Map aspect_ratio string to pixel dimensions for a workflow base size.
 * @returns {{ requested: string, width: number, height: number }}
 */
function resolveAspectRatioDimensions(aspectRatio, baseWidth, baseHeight) {
  const requested = String(aspectRatio ?? "").trim() || "1:1";
  if (!ASPECT_RATIO_OPTIONS.includes(requested)) {
    throw new Error(
      `Unsupported aspect_ratio "${requested}". ${UNSUPPORTED_RATIO_MSG}`,
    );
  }
  const table = getDimensionsTable(baseWidth, baseHeight);
  const dims = table[requested];
  return { requested, width: dims.width, height: dims.height };
}

/**
 * Match image dimensions to a supported aspect ratio key, or null.
 */
function classifyDimensions(width, height, baseWidth = 1024, baseHeight = 1024) {
  const iw = Math.round(Number(width));
  const ih = Math.round(Number(height));
  if (!(iw > 0 && ih > 0)) return null;

  const table = getDimensionsTable(baseWidth, baseHeight);
  for (const ratio of ASPECT_RATIO_OPTIONS) {
    const d = table[ratio];
    if (d.width === iw && d.height === ih) return ratio;
  }

  const actual = iw / ih;
  const tolerance = 0.02;
  for (const ratio of ASPECT_RATIO_OPTIONS) {
    const { value } = parseAspectRatioKey(ratio);
    if (Math.abs(actual - value) < tolerance) return ratio;
  }
  return null;
}

/**
 * Detect aspect ratio from image dimensions (alias for classifyDimensions).
 */
function detectAspectRatioFromDimensions(
  width,
  height,
  baseWidth = 1024,
  baseHeight = 1024,
) {
  return classifyDimensions(width, height, baseWidth, baseHeight);
}

/**
 * Resolve width/height from body: explicit dimensions beat aspect_ratio; else aspect_ratio; else omit.
 */
function resolveGenerationDimensions(body, defaults = {}) {
  const defW = defaults.width ?? 1024;
  const defH = defaults.height ?? 1024;

  const rawW = body.width;
  const rawH = body.height;
  const hasWidth =
    rawW !== undefined && rawW !== null && Number.isFinite(Number(rawW));
  const hasHeight =
    rawH !== undefined && rawH !== null && Number.isFinite(Number(rawH));

  if (hasWidth && hasHeight) {
    return {
      width: Math.floor(Number(rawW)),
      height: Math.floor(Number(rawH)),
    };
  }

  const aspectRaw = body.aspect_ratio;
  if (aspectRaw !== undefined && aspectRaw !== null && String(aspectRaw).trim()) {
    const { width, height } = resolveAspectRatioDimensions(
      aspectRaw,
      defW,
      defH,
    );
    return { width, height };
  }

  return { width: undefined, height: undefined };
}

/**
 * Read image width/height from a file on disk (PNG/JPEG/GIF/WebP via sharp).
 */
async function getImageDimensionsFromPath(filePath) {
  let sharp;
  try {
    sharp = require("sharp");
  } catch {
    throw new Error(
      "Cannot read image dimensions: sharp is not installed. Run npm install sharp.",
    );
  }
  const meta = await sharp(filePath, { failOn: "none" }).metadata();
  const width = meta.width;
  const height = meta.height;
  if (!(width > 0 && height > 0)) {
    throw new Error("Cannot read image dimensions: image has no size metadata");
  }
  return { width, height };
}

/**
 * Scale an input image down to the preset cap (exact target dimensions).
 * Overwrites the file in place. No-op when already within cap.
 */
async function scaleDownInputImageIfNeeded(filePath, targetWidth, targetHeight) {
  const { width: iw, height: ih } = await getImageDimensionsFromPath(filePath);
  if (iw <= targetWidth && ih <= targetHeight) {
    return false;
  }
  let sharp;
  try {
    sharp = require("sharp");
  } catch {
    throw new Error(
      "Cannot scale input image: sharp is not installed. Run npm install sharp.",
    );
  }
  const buffer = await sharp(filePath)
    .resize(targetWidth, targetHeight, { fit: "fill" })
    .toBuffer();
  fs.writeFileSync(filePath, buffer);
  return true;
}

/**
 * Validate input image aspect ratio and enforce preset size cap for i2i / i2v.
 * - Explicit aspect_ratio: reject when image ratio does not match.
 * - Omitted aspect_ratio: detect ratio from image; reject when unsupported.
 * - Oversized images are scaled down to the preset cap for the ratio.
 */
async function resolveAspectRatioFromInputImage({
  body,
  inputFilename,
  inputDir,
  baseWidth,
  baseHeight,
}) {
  const filePath = path.join(inputDir, inputFilename);
  if (!fs.existsSync(filePath)) {
    throw new Error("Failed to read input image for aspect ratio validation.");
  }

  const { width: iw, height: ih } = await getImageDimensionsFromPath(filePath);
  const explicit = String(body.aspect_ratio ?? "").trim();
  let aspectRatio;

  if (explicit) {
    resolveAspectRatioDimensions(explicit, baseWidth, baseHeight);
    const detected = classifyDimensions(iw, ih, baseWidth, baseHeight);
    if (!detected || detected !== explicit) {
      throw new Error(
        `Input image aspect ratio does not match aspect_ratio "${explicit}". ${UNSUPPORTED_RATIO_MSG}`,
      );
    }
    aspectRatio = explicit;
  } else {
    aspectRatio = classifyDimensions(iw, ih, baseWidth, baseHeight);
    if (!aspectRatio) {
      throw new Error(
        `Input image aspect ratio is not supported. ${UNSUPPORTED_RATIO_MSG}`,
      );
    }
  }

  const { width: targetW, height: targetH } = resolveAspectRatioDimensions(
    aspectRatio,
    baseWidth,
    baseHeight,
  );

  await scaleDownInputImageIfNeeded(filePath, targetW, targetH);

  return {
    aspectRatio,
    width: targetW,
    height: targetH,
    inputFilename,
  };
}

module.exports = {
  ASPECT_RATIO_OPTIONS,
  DIMENSIONS_BY_BASE,
  aspectRatioFieldDef,
  parseAspectRatioKey,
  normalizeBase,
  resolveAspectRatioDimensions,
  classifyDimensions,
  detectAspectRatioFromDimensions,
  resolveGenerationDimensions,
  getImageDimensionsFromPath,
  scaleDownInputImageIfNeeded,
  resolveAspectRatioFromInputImage,
};
