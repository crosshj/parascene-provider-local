"""FLUX CCR workflow using vendored Comfy modules from lib."""

from __future__ import annotations

from lib import flux_comfy_vendored as vendored

def resolve_flux_model_path(model_path: str, family: str) -> str:
    return vendored.resolve_flux_model_path(model_path, family)


def load_pipeline(
    model_path: str,
    configs_dir,
    torch_module,
    use_cuda: bool,
    flux_dtype,
    use_cpu_offload: bool,
    enable_xformers: bool,
):
    return vendored.load_pipeline(
        model_path,
        configs_dir,
        torch_module,
        use_cuda,
        flux_dtype,
        use_cpu_offload,
        enable_xformers,
    )


def generate(pipe, payload: dict, torch_module) -> tuple:
    return vendored.generate(pipe, payload, torch_module)
