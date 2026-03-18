#!/usr/bin/env python3
"""
Simple CLI image generator used by Node over stdin/stdout IPC.

Input: JSON from stdin
Output: JSON to stdout
"""

from __future__ import annotations

import argparse
from collections import OrderedDict
import gc
import json
import os
import sys
import time
import traceback
import warnings
from pathlib import Path
from typing import Any, Dict

from lib.utils import (
    can_use_cuda,
    describe_exception,
    log_cuda_fallback_once,
    log_selected_cuda_once,
    to_win_path,
)
import workflows.flux as workflow_flux
import workflows.flux_ccr as workflow_flux_ccr
import workflows.flux_test as workflow_flux_test
import workflows.qwen as workflow_qwen
import workflows.sdxl as workflow_sdxl
import workflows.sd15 as workflow_sd15

# Helps reduce CUDA memory fragmentation on long-lived worker processes.
# Not supported on Windows CUDA allocator in current torch builds.
if os.name != "nt":
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

# Multi-GPU selection.
# Set IMAGE_GPU_INDEX to choose a specific physical GPU from nvidia-smi index.
# Default is 0 (on this box that's the RTX 5090).
os.environ.setdefault("CUDA_DEVICE_ORDER", "PCI_BUS_ID")
os.environ.setdefault("CUDA_VISIBLE_DEVICES", os.environ.get("IMAGE_GPU_INDEX", "0"))

# Triton is typically unavailable on Windows; disable Triton probing in xformers
# to avoid noisy import tracebacks when xformers is enabled.
if os.name == "nt":
    os.environ.setdefault("XFORMERS_FORCE_DISABLE_TRITON", "1")

# Quiet known noisy deprecation warning emitted from diffusers internals.
warnings.filterwarnings(
    "ignore",
    message=r"`upcast_vae` is deprecated.*",
    category=FutureWarning,
)

PIPE_CACHE: OrderedDict[str, Any] = OrderedDict()
CPU_PIPE_CACHE: dict[str, OrderedDict[str, Any]] = {}

# Speed-first defaults for high-VRAM GPUs:
# - keep multiple models resident in VRAM
# - disable CPU warm cache by default to avoid GPU<->CPU transfer churn
MAX_GPU_MODELS_PER_FAMILY = max(1, int(os.environ.get("MAX_GPU_MODELS_PER_FAMILY", "4")))
MAX_GPU_MODELS_FLUX = max(1, int(os.environ.get("MAX_GPU_MODELS_FLUX", "1")))
MAX_CPU_MODELS_PER_FAMILY = max(0, int(os.environ.get("MAX_CPU_MODELS_PER_FAMILY", "0")))
ENABLE_ATTN_SLICING = os.environ.get("ENABLE_ATTN_SLICING", "0") == "1"
FLUX_USE_CPU_OFFLOAD = os.environ.get("FLUX_USE_CPU_OFFLOAD", "0") == "1"
FLUX_ENABLE_XFORMERS = os.environ.get("FLUX_ENABLE_XFORMERS", "0") == "1"
FLUX_DTYPE = (os.environ.get("FLUX_DTYPE", "bf16") or "bf16").strip().lower()
FLUX_WORKFLOW = (os.environ.get("FLUX_WORKFLOW", "flux_ccr") or "flux_ccr").strip().lower()


def _get_flux_workflow_module():
    if FLUX_WORKFLOW == "flux_ccr":
        return workflow_flux_ccr
    if FLUX_WORKFLOW == "flux_test":
        return workflow_flux_test
    return workflow_flux


def _log(msg: str) -> None:
    sys.stderr.write(f"[worker] {msg}\n")
    sys.stderr.flush()


def _is_cuda_oom(exc: Exception) -> bool:
    """Best-effort detection for CUDA out-of-memory exceptions."""
    needles = (
        "cuda out of memory",
        "cuda error: out of memory",
        "cudaerrormemoryallocation",
        "cudamemoryallocation",
        "out of memory",
    )

    seen = set()
    current: BaseException | None = exc
    depth = 0
    while current is not None and depth < 8 and id(current) not in seen:
        seen.add(id(current))
        # Type-based check: torch.cuda.OutOfMemoryError (PyTorch >= 1.12)
        try:
            import torch
            if isinstance(current, torch.cuda.OutOfMemoryError):
                return True
        except Exception:
            pass
        msg = str(current).lower()
        if any(n in msg for n in needles):
            return True
        current = current.__cause__ or current.__context__
        depth += 1

    return False


def _clear_cuda_cache(torch_module=None, evict_cache_key: str | None = None) -> None:
    """Release as much cached CUDA memory as possible."""
    # Evict the failing pipeline from PIPE_CACHE so a retry starts fresh.
    if evict_cache_key and evict_cache_key in PIPE_CACHE:
        pipe = PIPE_CACHE.pop(evict_cache_key, None)
        if pipe is not None:
            try:
                pipe.to("cpu")
            except Exception:
                pass
            del pipe

    try:
        gc.collect()
    except Exception:
        pass

    try:
        torch = torch_module or _get_torch()
    except Exception:
        return

    try:
        if torch.cuda.is_available():
            try:
                torch.cuda.synchronize()
            except Exception:
                pass
            torch.cuda.empty_cache()
            try:
                torch.cuda.ipc_collect()
            except Exception:
                pass
    except Exception:
        pass

    # If the Comfy runtime is loaded, ask it to unload models from VRAM too.
    try:
        import comfy.model_management as _cmm
        if hasattr(_cmm, "soft_empty_cache"):
            _cmm.soft_empty_cache()
        elif hasattr(_cmm, "unload_all_models"):
            _cmm.unload_all_models()
    except Exception:
        pass

    # Second gc + empty_cache after Comfy unload.
    try:
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass

# ---------------------------------------------------------------------------
# VRAM / CPU model cache
# ---------------------------------------------------------------------------
def _get_torch():
    try:
        import torch
        return torch
    except Exception as exc:
        raise RuntimeError(
            "Missing Python dependencies. Install: pip install torch diffusers transformers accelerate safetensors pillow"
        ) from exc


def _setup_torch(torch_module) -> bool:
    """Configure CUDA if available and return use_cuda flag."""
    use_cuda = can_use_cuda(torch_module)
    if use_cuda:
        log_selected_cuda_once(torch_module)
        try:
            torch_module.backends.cuda.matmul.allow_tf32 = True
            torch_module.backends.cudnn.allow_tf32 = True
            torch_module.backends.cudnn.benchmark = True
        except Exception:
            pass
    else:
        log_cuda_fallback_once()
    return use_cuda


def load_pipeline(family: str, model: str):
    """Load (or return cached) pipeline for the given family and model path."""
    _log(f"load_pipeline:start family={family} model={model}")
    _log("load_pipeline:import torch")
    torch = _get_torch()
    _log("load_pipeline:torch imported")
    _log("load_pipeline:setup cuda")
    use_cuda = _setup_torch(torch)
    _log(f"load_pipeline:cuda={'yes' if use_cuda else 'no'}")

    model_path = to_win_path(model)
    family = (family or "sdxl").lower()

    # FLUX path normalisation lives in the flux workflow.
    if family == "flux":
        model_path = _get_flux_workflow_module().resolve_flux_model_path(
            model_path, family
        )

    cache_key = f"{family}:{model_path}"
    if cache_key in PIPE_CACHE:
        pipe = PIPE_CACHE.pop(cache_key)
        PIPE_CACHE[cache_key] = pipe
        _log("load_pipeline:cache hit (gpu)")
        return pipe, torch

    def cpu_family_cache(target_family: str) -> OrderedDict[str, Any]:
        return CPU_PIPE_CACHE.setdefault(target_family, OrderedDict())

    def park_on_cpu(key: str, pipe_obj: Any) -> None:
        fam = key.split(":", 1)[0]
        try:
            pipe_obj.to("cpu")
        except Exception:
            pass
        if MAX_CPU_MODELS_PER_FAMILY <= 0:
            return
        fam_cache = cpu_family_cache(fam)
        fam_cache[key] = pipe_obj
        fam_cache.move_to_end(key)
        while len(fam_cache) > MAX_CPU_MODELS_PER_FAMILY:
            _, old_pipe = fam_cache.popitem(last=False)
            del old_pipe

    def evict_gpu_family_cache(target_family: str) -> None:
        max_gpu = MAX_GPU_MODELS_FLUX if target_family == "flux" else MAX_GPU_MODELS_PER_FAMILY
        keys = [k for k in PIPE_CACHE.keys() if k.startswith(f"{target_family}:")]
        evicted_any = False
        while len(keys) >= max_gpu and keys:
            evict_key = keys.pop(0)
            evicted = PIPE_CACHE.pop(evict_key, None)
            if evicted is not None:
                park_on_cpu(evict_key, evicted)
                evicted_any = True
        if evicted_any:
            gc.collect()
            if use_cuda:
                try:
                    torch.cuda.empty_cache()
                except Exception:
                    pass

    # Fast-path: revive from CPU cache before touching disk.
    fam_cpu = cpu_family_cache(family)
    revived = fam_cpu.pop(cache_key, None)
    if revived is not None:
        evict_gpu_family_cache(family)
        device = "cuda" if use_cuda else "cpu"
        PIPE_CACHE[cache_key] = revived.to(device)
        _log(f"load_pipeline:cache hit (cpu->{device})")
        return PIPE_CACHE[cache_key], torch

    evict_gpu_family_cache(family)
    configs_dir = Path(__file__).parent / "configs"

    try:
        if family == "flux":
            flux_workflow_module = _get_flux_workflow_module()
            dtype = torch.float16 if use_cuda else torch.float32
            if use_cuda:
                if FLUX_DTYPE in ("bf16", "bfloat16"):
                    dtype = torch.bfloat16
            _log(
                f"load_pipeline:loading flux workflow={FLUX_WORKFLOW} dtype={str(dtype)} cpu_offload={FLUX_USE_CPU_OFFLOAD} xformers={FLUX_ENABLE_XFORMERS}"
            )
            load_started = time.time()
            pipe = flux_workflow_module.load_pipeline(
                model_path, configs_dir, torch, use_cuda, dtype,
                FLUX_USE_CPU_OFFLOAD, FLUX_ENABLE_XFORMERS,
            )
            _log(f"load_pipeline:loaded flux in {int((time.time() - load_started) * 1000)}ms")
        elif family == "z-image":
            import workflows.zimage as workflow_zimage
            _log("load_pipeline:loading z-image")
            load_started = time.time()
            dtype = torch.float16 if use_cuda else torch.float32
            pipe = workflow_zimage.load_pipeline(
                model_path, configs_dir, torch, use_cuda, dtype, False, True,
            )
            _log(f"load_pipeline:loaded z-image in {int((time.time() - load_started) * 1000)}ms")
        elif family == "sdxl":
            _log("load_pipeline:loading sdxl")
            load_started = time.time()
            pipe = workflow_sdxl.load_pipeline(
                model_path, configs_dir, torch, use_cuda,
                ENABLE_ATTN_SLICING, enable_xformers=True,
            )
            _log(f"load_pipeline:loaded sdxl in {int((time.time() - load_started) * 1000)}ms")
        elif family == "sd15":
            _log("load_pipeline:loading sd15")
            load_started = time.time()
            pipe = workflow_sd15.load_pipeline(
                model_path, torch, use_cuda, ENABLE_ATTN_SLICING,
            )
            _log(f"load_pipeline:loaded sd15 in {int((time.time() - load_started) * 1000)}ms")
        elif family == "qwen":
            _log("load_pipeline:loading qwen")
            load_started = time.time()
            dtype = torch.float16 if use_cuda else torch.float32
            pipe = workflow_qwen.load_pipeline(
                model_path, configs_dir, torch, use_cuda, dtype, False, False,
            )
            _log(f"load_pipeline:loaded qwen in {int((time.time() - load_started) * 1000)}ms")
        else:
            raise ValueError(f"Unknown family '{family}'. Supported: flux, sdxl, sd15, qwen")
    except Exception as exc:
        raise RuntimeError(
            f"Could not load model '{model_path}': {describe_exception(exc)}"
        ) from exc

    PIPE_CACHE[cache_key] = pipe
    _log("load_pipeline:done")
    return pipe, torch


def run_generation(pipe, family: str, payload: Dict[str, Any], torch_module):
    """Delegate inference to the appropriate workflow module."""
    if family == "flux":
        return _get_flux_workflow_module().generate(pipe, payload, torch_module)
    elif family == "sdxl":
        return workflow_sdxl.generate(pipe, payload, torch_module)
    elif family == "sd15":
        return workflow_sd15.generate(pipe, payload, torch_module)
    elif family == "qwen":
        return workflow_qwen.generate(pipe, payload, torch_module)
    else:
        raise ValueError(f"Unknown family '{family}'")


def _process_one(payload: Dict[str, Any], out_dir: Path) -> Dict[str, Any]:
    """Run a single generation job and return a result dict (never raises)."""
    try:
        if not isinstance(payload, dict):
            raise ValueError("Input must be a JSON object.")

        family = str(payload.get("family", "flux") or "flux").lower()
        model = str(payload.get("model", "")).strip()
        if not model:
            raise ValueError("Missing required field: model")

        started = time.time()
        torch_module = None
        image = None
        seed = None
        _cache_key = f"{family}:{model}"

        for attempt in (1, 2):
            try:
                _log(f"loading family={family} model={model}")
                pipe, torch_module = load_pipeline(family, model)
                _log("running inference")
                image, seed = run_generation(pipe, family, payload, torch_module)
                break
            except Exception as exc:
                if attempt == 1 and _is_cuda_oom(exc):
                    _log("CUDA OOM detected; evicting pipeline cache and retrying once")
                    _clear_cuda_cache(torch_module, evict_cache_key=_cache_key)
                    continue
                raise

        if image is None or seed is None:
            raise RuntimeError("Generation failed after retry.")

        stamp = time.strftime("%Y%m%d-%H%M%S")
        file_name = f"img-{stamp}-{seed}.png"
        out_path = out_dir / file_name
        _log(f"saving {file_name}")
        image.save(out_path)

        return {
            "ok": True,
            "file_name": file_name,
            "file_path": str(out_path),
            "family": family,
            "model": to_win_path(model),
            "seed": seed,
            "elapsed_ms": int((time.time() - started) * 1000),
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": describe_exception(exc),
            "trace": traceback.format_exc(limit=1),
        }


def worker_loop(out_dir_str: str) -> int:
    """
    Persistent worker mode.

    Reads newline-delimited JSON requests from stdin, processes each one, and
    writes a newline-delimited JSON response to stdout.  The process stays alive
    so loaded models remain in VRAM across requests.
    """
    out_dir = Path(out_dir_str)
    out_dir.mkdir(parents=True, exist_ok=True)

    _log(
        "ready "
        f"(flux_cpu_offload={FLUX_USE_CPU_OFFLOAD} "
        f"flux_xformers={FLUX_ENABLE_XFORMERS} flux_dtype={FLUX_DTYPE})"
    )

    while True:
        try:
            line = sys.stdin.readline()
        except (EOFError, KeyboardInterrupt):
            break
        if not line:          # stdin closed — Node shut down
            break
        line = line.strip()
        if not line:
            continue

        try:
            payload = json.loads(line)
        except json.JSONDecodeError as exc:
            result = {"ok": False, "error": f"Invalid JSON: {exc}"}
        else:
            _log("request received")
            result = _process_one(payload, out_dir)

        sys.stdout.write(json.dumps(result) + "\n")
        sys.stdout.flush()
        _log(f"response sent ok={result.get('ok', False)}")

    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default="outputs")
    parser.add_argument(
        "--worker",
        action="store_true",
        help="Run as persistent worker (reads newline-delimited JSON from stdin, "
             "keeps models loaded in VRAM between requests)",
    )
    args = parser.parse_args()

    if args.worker:
        return worker_loop(args.out_dir)

    # ── One-shot mode (for testing / direct CLI use) ──────────────────────
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        out_dir = Path(args.out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        result = _process_one(payload, out_dir)
        if result.get("ok"):
            sys.stdout.write(json.dumps(result))
            return 0
        else:
            sys.stderr.write(json.dumps(result))
            return 1
    except Exception as exc:
        sys.stderr.write(json.dumps({"ok": False, "error": str(exc), "trace": traceback.format_exc(limit=1)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
