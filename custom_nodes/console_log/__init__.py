import os

# Piped Windows stdio + ComfyUI-Manager tqdm `\r` bars raise OSError 22
# and abort MiniMax euler sampling. Set before the first sampler runs.
os.environ["TQDM_DISABLE"] = "1"

from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
