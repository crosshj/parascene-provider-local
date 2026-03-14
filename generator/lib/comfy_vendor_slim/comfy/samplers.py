# Stub: nodes.KSampler.INPUT_TYPES needs SAMPLERS, SCHEDULERS.
# Hot path: flux_comfy_vendored passes sampler_name="euler", scheduler="simple" (payload defaults).

SAMPLER_NAMES = ["euler"]
SCHEDULER_NAMES = ["simple"]


class KSampler:
    SAMPLERS = SAMPLER_NAMES
    SCHEDULERS = SCHEDULER_NAMES

    def __init__(self, model, steps, device, sampler=None, scheduler=None, denoise=None, model_options=None):
        raise NotImplementedError("comfy_vendor_slim: use full comfy_vendor for sampling")
