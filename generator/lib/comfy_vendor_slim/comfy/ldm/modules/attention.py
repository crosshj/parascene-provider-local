# Stub: comfy.ldm.modules.attention (flux_comfy_vendored slim)

def optimized_attention(*args, **kwargs):
    raise NotImplementedError("comfy_vendor_slim: stub only")

# Used when disable_xformers: flux_comfy_vendored assigns optimized_attention = attention_pytorch
attention_pytorch = optimized_attention
