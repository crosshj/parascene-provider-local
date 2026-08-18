/* eslint-env jest */
"use strict";

const {
  ComfyExecutionError,
  extractHistoryExecutionError,
  historyHasPromptEntry,
  isRecoverableComfyError,
  looksLikeHostBufferFailure,
  missingOutputError,
  retryAfterComfyRecycle,
  shouldRestartAfterMissingOutput,
} = require("../server/generator/comfy-errors.js");

function historyWithExecutionError(promptId, exceptionMessage, extra = {}) {
  return {
    [promptId]: {
      outputs: {},
      status: {
        status_str: "error",
        completed: false,
        messages: [
          ["execution_start", { prompt_id: promptId }],
          [
            "execution_error",
            {
              prompt_id: promptId,
              node_id: "63",
              node_type: "CLIPTextEncode",
              exception_message: exceptionMessage,
              exception_type: extra.exceptionType || "RuntimeError",
              traceback: extra.traceback || [],
            },
          ],
        ],
      },
    },
  };
}

describe("comfy host-buffer error recovery", () => {
  it("recognizes host-buffer failure strings", () => {
    expect(
      looksLikeHostBufferFailure(
        "[ERROR] !!! Exception during processing !!! hostbuf_file_reader_read failed",
      ),
    ).toBe(true);
    expect(
      looksLikeHostBufferFailure("HostBuffer.read_file_slice failed"),
    ).toBe(true);
    expect(looksLikeHostBufferFailure("CUDA kernel launch failed")).toBe(false);
    expect(looksLikeHostBufferFailure("comfy_aimdo host_buffer.py")).toBe(false);
  });

  it("restarts only when output is missing AND evidence is a host-buffer error", () => {
    const logs = [
      "[ERROR] !!! Exception during processing !!! hostbuf_file_reader_read failed",
      "RuntimeError: hostbuf_file_reader_read failed",
    ].join("\n");
    expect(shouldRestartAfterMissingOutput(logs)).toBe(true);
    expect(
      shouldRestartAfterMissingOutput("Error while loading CLIP model"),
    ).toBe(false);
    expect(shouldRestartAfterMissingOutput("")).toBe(false);
  });

  it("treats a history entry as 'prompt finished', even when completed is false", () => {
    const promptId = "abc-123";
    expect(
      historyHasPromptEntry(historyWithExecutionError(promptId, "boom"), promptId),
    ).toBe(true);
    expect(historyHasPromptEntry({}, promptId)).toBe(false);
  });

  it("does not mark history errors recoverable on their own", () => {
    const promptId = "abc-123";
    const err = extractHistoryExecutionError(
      historyWithExecutionError(promptId, "hostbuf_file_reader_read failed"),
      promptId,
    );
    expect(err).toBeInstanceOf(ComfyExecutionError);
    expect(err.recoverable).toBe(false);
    expect(isRecoverableComfyError(err)).toBe(false);
  });

  it("marks missing output recoverable when this run's logs show hostbuf failure", () => {
    const err = missingOutputError(
      "Comfy finished without an output file.",
      "[ERROR] !!! Exception during processing !!! hostbuf_file_reader_read failed",
    );
    expect(err.recoverable).toBe(true);
    expect(isRecoverableComfyError(err)).toBe(true);
  });

  it("does not restart for missing output without host-buffer evidence", () => {
    const err = missingOutputError(
      "Comfy finished without an output file.",
      "Error while loading CLIP model\nFileNotFoundError: gemma3.safetensors",
    );
    expect(err.recoverable).toBe(false);
    expect(isRecoverableComfyError(err)).toBe(false);
  });

  it("recycles Comfy and retries once when missing output is a host-buffer error", async () => {
    const recycle = jest.fn().mockResolvedValue({ running: true });
    let attempts = 0;
    const result = await retryAfterComfyRecycle(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw missingOutputError(
          "Comfy finished without an output file.",
          "hostbuf_file_reader_read failed",
        );
      }
      return { ok: true, attempt: attempts };
    }, recycle);

    expect(result).toEqual({ ok: true, attempt: 2 });
    expect(recycle).toHaveBeenCalledTimes(1);
  });

  it("does not retry a missing-output failure without host-buffer evidence", async () => {
    const recycle = jest.fn();
    await expect(
      retryAfterComfyRecycle(async () => {
        throw missingOutputError(
          "Comfy finished without an output file.",
          "missing node",
        );
      }, recycle),
    ).rejects.toThrow("without an output file");
    expect(recycle).not.toHaveBeenCalled();
  });
});
