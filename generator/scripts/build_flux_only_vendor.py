#!/usr/bin/env python3
"""
Build a FLUX-only subset of the ComfyUI vendor.

Goal: trim everything that isn't used when running FLUX CCR (load_pipeline + generate)
so you can see "just the flux call" and compare to workflows/flux.py.

Strategy:
  1. Run the Comfy FLUX path (init_comfy_runtime) so that all code used by nodes/sd/samplers
     gets imported. Collect every module in sys.modules that lives under the ComfyUI vendor.
  2. Copy only those files from comfy_vendor/ComfyUI into a target dir, preserving layout.
  3. Optionally list what was kept (--trace-only).

Usage (from repo root):
  cd generator
  FLUX_CCR_USE_SLIM_VENDOR=0 python -m scripts.build_flux_only_vendor [--out-dir lib/comfy_vendor_flux_only] [--trace-only]

  --out-dir    Where to write the flux-only tree (default: lib/comfy_vendor_flux_only)
  --trace-only Only print the set of loaded modules and files; do not copy.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
GENERATOR = _SCRIPT_DIR.parent  # generator/
COMFYUI_FULL = GENERATOR / "lib" / "comfy_vendor" / "ComfyUI"


def run_init_and_collect_loaded():
    """Run _init_comfy_runtime() with full vendor; return set of (module_name, file_path) for vendor modules."""
    os.environ["FLUX_CCR_USE_SLIM_VENDOR"] = "0"
    os.environ.pop("COMFYUI_ROOT", None)

    sys.path.insert(0, str(GENERATOR))
    comfy_str = str(COMFYUI_FULL)
    if comfy_str not in sys.path:
        sys.path.insert(0, comfy_str)

    before = set(sys.modules.keys())

    try:
        from lib import flux_comfy_vendored

        flux_comfy_vendored._init_comfy_runtime()
    except Exception as e:
        sys.stderr.write(f"Init failed (expected in some envs): {e}\n")

    out = []
    for name in sys.modules:
        if name in before:
            continue
        mod = sys.modules[name]
        try:
            origin = getattr(mod, "__file__", None)
        except Exception:
            origin = None
        if not origin or "comfy_vendor" not in origin:
            continue
        path = Path(origin).resolve()
        try:
            path.relative_to(COMFYUI_FULL)
        except ValueError:
            continue
        if path.suffix not in (".py", ".pyc") or ".pyc" in path.name:
            if path.suffix == ".pyc":
                py = path.with_suffix(".py")
                if py.exists():
                    path = py
                else:
                    continue
            else:
                continue
        out.append((name, path))

    return out


def collect_files(loaded: list[tuple[str, Path]], root: Path) -> set[Path]:
    """Deduplicate by path and keep only paths under root."""
    out = set()
    for _name, path in loaded:
        try:
            path.resolve().relative_to(root)
        except ValueError:
            continue
        if path.exists() and path.suffix == ".py":
            out.add(path.resolve())
    return out


def copy_tree(files: set[Path], dest: Path, root: Path) -> None:
    """Copy files into dest preserving relative path; add empty __init__.py for packages."""
    dest.mkdir(parents=True, exist_ok=True)
    for f in sorted(files):
        try:
            rel = f.relative_to(root)
        except ValueError:
            continue
        target = dest / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.copy2(f, target)
        except (FileNotFoundError, OSError):
            shutil.copy(f, target)
    # Ensure every directory that has a .py has __init__.py so the tree is importable
    for d in sorted(dest.rglob("*")):
        if d.is_dir():
            has_py = any(d.glob("*.py"))
            if has_py:
                init = d / "__init__.py"
                if not init.exists():
                    init.touch()


def main():
    ap = argparse.ArgumentParser(description="Build FLUX-only vendor subset")
    ap.add_argument("--out-dir", type=Path, default=GENERATOR / "lib" / "comfy_vendor_flux_only", help="Output directory")
    ap.add_argument("--trace-only", action="store_true", help="Only print loaded modules and files; do not copy")
    args = ap.parse_args()

    log_path = GENERATOR / "_docs" / "build_flux_only_vendor.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with open(log_path, "w", encoding="utf-8") as f:
        f.write("script started\n")

    os.chdir(GENERATOR)
    sys.path.insert(0, str(GENERATOR))

    if not COMFYUI_FULL.exists():
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"Full vendor not found at {COMFYUI_FULL}\n")
        return 1

    def log(msg):
        print(msg, flush=True)
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(msg + "\n")

    log("Running init_comfy_runtime (full vendor) to collect loaded modules...")
    loaded = run_init_and_collect_loaded()
    log(f"Collected {len(loaded)} modules from vendor.")

    files = collect_files(loaded, COMFYUI_FULL)
    log(f"Resolved to {len(files)} .py files.")

    if args.trace_only:
        for name, _ in sorted(loaded, key=lambda x: x[0]):
            log(name)
        log("--- files ---")
        for f in sorted(files):
            try:
                log(str(f.relative_to(COMFYUI_FULL)))
            except ValueError:
                pass
        log(f"Log written to {log_path}")
        return 0

    args.out_dir = args.out_dir.resolve()
    if args.out_dir.exists():
        shutil.rmtree(args.out_dir)
    copy_tree(files, args.out_dir, COMFYUI_FULL)
    log(f"Wrote flux-only tree to {args.out_dir}.")
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
