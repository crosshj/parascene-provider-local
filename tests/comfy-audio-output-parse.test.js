"use strict";

const {
  parseOutputAudio,
  tryParseAudioRef,
} = require("../server/generator/client.js");

describe("Comfy audio output parsing", () => {
  it("parses standard audio list outputs", () => {
    const history = {
      pid_1: {
        outputs: {
          "10": {
            audio: [
              {
                filename: "YuE2_00001.mp3",
                subfolder: "audio/YuE2",
                type: "output",
              },
            ],
          },
        },
      },
    };
    expect(parseOutputAudio(history, "pid_1")).toEqual({
      kind: "audio",
      filename: "YuE2_00001.mp3",
      subfolder: "audio/YuE2",
      type: "output",
    });
  });

  it("parses generic result arrays with path strings", () => {
    const history = {
      pid_2: {
        outputs: {
          "10": {
            result: ["audio/YuE2/YuE2_00002.mp3"],
          },
        },
      },
    };
    expect(parseOutputAudio(history, "pid_2")).toEqual({
      kind: "audio",
      filename: "YuE2_00002.mp3",
      subfolder: "audio/YuE2",
      type: "output",
    });
  });

  it("parses nested ui output payloads", () => {
    const slot = {
      ui: {
        files: [
          {
            filename: "song_003.wav",
            subfolder: "audio/custom",
            type: "output",
          },
        ],
      },
    };
    expect(tryParseAudioRef(slot)).toEqual({
      kind: "audio",
      filename: "song_003.wav",
      subfolder: "audio/custom",
      type: "output",
    });
  });
});
