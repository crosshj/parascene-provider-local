from .basic_types import ImageInput, AudioInput, MaskInput, LatentInput
try:
    from .video_types import VideoInput
except ImportError:
    VideoInput = None  # optional when PyAV (av) is not installed

__all__ = [
    "ImageInput",
    "AudioInput",
    "VideoInput",
    "MaskInput",
    "LatentInput",
]
