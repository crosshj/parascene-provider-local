import sys


class ConsoleLog:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": True,
                        "tooltip": "Shown on the node. Also written to stdout as complete lines.",
                    },
                ),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "log"
    CATEGORY = "debug"
    OUTPUT_NODE = True
    DESCRIPTION = (
        "Preview text on the node (same pattern as PreviewAny). "
        "Also writes newline-terminated stdout for the server log; "
        "a failed write is ignored so sampling progress bars can still run."
    )

    @classmethod
    def IS_CHANGED(cls, **_kwargs):
        return float("nan")

    def log(self, text):
        value = str(text or "")
        try:
            msg = value.replace("\r", "")
            if msg and not msg.endswith("\n"):
                msg += "\n"
            if msg:
                sys.stdout.write(msg)
                sys.stdout.flush()
        except OSError:
            pass
        return {"ui": {"text": (value,)}, "result": (value,)}


NODE_CLASS_MAPPINGS = {
    "ConsoleLog": ConsoleLog,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ConsoleLog": "Console Log",
}
