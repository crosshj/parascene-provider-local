import logging

logger = logging.getLogger("console_log")


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
                        "tooltip": "Printed to the Comfy server log when this node runs.",
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
        "Write text to the Comfy server log. Always executes (not cached). "
        "Also returns the same string so it can sit in a data path."
    )

    @classmethod
    def IS_CHANGED(cls, **_kwargs):
        return float("nan")

    def log(self, text):
        logger.info("%s", text)
        return (text,)


NODE_CLASS_MAPPINGS = {
    "ConsoleLog": ConsoleLog,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ConsoleLog": "Console Log",
}
