/* eslint-env jest */
"use strict";

const MinimaxI2v = require("../server/workflows/image2video/minimax_h3_i2v.js");
const MinimaxT2v = require("../server/workflows/text2video/minimax_h3_t2v.js");
const MinimaxR2v = require("../server/workflows/reference2video/minimax_h3_r2v.js");

describe("MiniMax workflow builders", () => {
  it("t2v sets prompt and duration", () => {
    const wf = MinimaxT2v({
      prompt: "hello",
      durationSeconds: 8,
      seed: 42,
    });
    expect(wf["105:104"].inputs.prompt).toBe("hello");
    expect(wf["105:111"].inputs.value).toBe(8);
    expect(wf["105:15"].inputs.noise_seed).toBe(42);
    expect(wf["105:104"].inputs.first_frame).toBeUndefined();
  });

  it("i2v wires first_frame only when no end frame", () => {
    const wf = MinimaxI2v({
      prompt: "animate",
      inputImageFilename: "start.png",
    });
    expect(wf["114"].inputs.image).toBe("start.png");
    expect(wf["105:104"].inputs.first_frame).toEqual(["114", 0]);
    expect(wf["105:104"].inputs.last_frame).toBeUndefined();
    expect(wf["121"]).toBeUndefined();
  });

  it("i2v wires first and last for flf2va", () => {
    const wf = MinimaxI2v({
      prompt: "morph",
      inputImageFilename: "start.png",
      endImageFilename: "end.png",
    });
    expect(wf["105:104"].inputs.first_frame).toEqual(["114", 0]);
    expect(wf["105:104"].inputs.last_frame).toEqual(["121", 0]);
    expect(wf["121"].inputs.image).toBe("end.png");
  });

  it("r2v wires only provided refs and drops unused loaders", () => {
    const wf = MinimaxR2v({
      prompt: "Use <Picture 1> and <Video 1>",
      inputImageFilenames: ["a.png", "b.png"],
      inputVideoFilenames: ["m.mp4"],
      inputAudioFilenames: ["v.mp3"],
    });
    const inputs = wf["136"].inputs;
    expect(inputs["ref_images.ref_image_0"]).toEqual(["137", 0]);
    expect(inputs["ref_images.ref_image_1"]).toEqual(["139", 0]);
    expect(inputs["ref_images.ref_image_2"]).toBeUndefined();
    expect(inputs["ref_videos.ref_video_0"]).toEqual(["140", 0]);
    expect(inputs["ref_videos.ref_video_1"]).toBeUndefined();
    expect(inputs["ref_audios.ref_audio_0"]).toEqual(["143", 0]);
    expect(wf["141"]).toBeUndefined();
    expect(wf["150"]).toBeUndefined();
    expect(wf["138"].inputs.value).toContain("<Picture 1>");
  });
});
