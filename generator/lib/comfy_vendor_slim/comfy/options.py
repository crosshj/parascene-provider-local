# From comfy_vendor: comfy/options.py (hot path only)

args_parsing = False


def enable_args_parsing(enable=True):
    global args_parsing
    args_parsing = enable
