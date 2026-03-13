"""Shared helpers used by workflow modules and generate.py."""

from __future__ import annotations

import sys
import warnings
from typing import Any


# ---------------------------------------------------------------------------
# CUDA state (module-level so callers can import and mutate)
# ---------------------------------------------------------------------------

_CUDA_OK: bool | None = None
_CUDA_REASON: str = ""
_CUDA_WARNED: bool = False
_CUDA_DEVICE_LOGGED: bool = False


def can_use_cuda(torch_module) -> bool:
    """Best-effort CUDA capability check, cached for the worker lifetime."""
    global _CUDA_OK, _CUDA_REASON
    if _CUDA_OK is not None:
        return _CUDA_OK

    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            available = bool(torch_module.cuda.is_available())

        if not available:
            _CUDA_REASON = (
                str(caught[-1].message)
                if caught
                else "CUDA unavailable in this PyTorch environment."
            )
            _CUDA_OK = False
            return False

        cap = torch_module.cuda.get_device_capability(0)
        sm = f"sm_{cap[0]}{cap[1]}"
        try:
            arch_list = torch_module.cuda.get_arch_list()
        except Exception:
            arch_list = []

        if arch_list and sm not in arch_list:
            _CUDA_REASON = (
                f"GPU arch {sm} is not supported by installed PyTorch "
                f"(supports: {', '.join(arch_list)})."
            )
            _CUDA_OK = False
            return False

        _CUDA_REASON = ""
        _CUDA_OK = True
        return True
    except Exception as exc:
        _CUDA_REASON = f"CUDA check failed: {exc}"
        _CUDA_OK = False
        return False


def log_cuda_fallback_once() -> None:
    global _CUDA_WARNED
    if _CUDA_WARNED:
        return
    _CUDA_WARNED = True
    msg = _CUDA_REASON or "CUDA unavailable in this environment."
    sys.stderr.write(f"[worker] CUDA disabled, using CPU: {msg}\n")
    sys.stderr.flush()


def log_selected_cuda_once(torch_module) -> None:
    global _CUDA_DEVICE_LOGGED
    if _CUDA_DEVICE_LOGGED:
        return
    _CUDA_DEVICE_LOGGED = True
    try:
        name = torch_module.cuda.get_device_name(0)
        sys.stderr.write(
            f"[worker] CUDA device selected: cuda:0 ({name}) "
            f"via CUDA_VISIBLE_DEVICES={__import__('os').environ.get('CUDA_VISIBLE_DEVICES', '')}\n"
        )
        sys.stderr.flush()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------

def to_win_path(path_value: str) -> str:
    """Normalise POSIX-style /d/foo/bar paths to D:\\foo\\bar on Windows."""
    p = path_value.strip()
    if len(p) >= 3 and p[0] == "/" and p[2] == "/" and p[1].isalpha():
        drive = p[1].upper()
        rest = p[2:].replace("/", "\\")
        return f"{drive}:{rest}"
    return p


# ---------------------------------------------------------------------------
# Guidance / negative-prompt helpers
# ---------------------------------------------------------------------------

def apply_family_guidance_kwargs(
    family: str,
    kwargs: dict,
    cfg: float,
    guidance: float,
    negative_prompt: str,
) -> None:
    if family in ("sd15", "sdxl"):
        kwargs["guidance_scale"] = cfg
        if negative_prompt:
            kwargs["negative_prompt"] = negative_prompt
    elif family == "flux":
        kwargs["guidance_scale"] = guidance


# ---------------------------------------------------------------------------
# Misc
# ---------------------------------------------------------------------------

def describe_exception(exc: Exception) -> str:
    msg = str(exc).strip()
    if msg:
        return msg
    return f"{exc.__class__.__name__} (no message)"
