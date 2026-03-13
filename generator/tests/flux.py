"""FLUX integration test.

This test exercises the real workflow path:
- `workflows.flux.load_pipeline(...)`
- `workflows.flux.generate(...)`
"""

from __future__ import annotations

import sys
import tempfile
import time
import unittest
from pathlib import Path


# Ensure `workflows` and `lib` resolve exactly like runtime scripts in /generator.
GENERATOR_ROOT = Path(__file__).resolve().parents[1]
if str(GENERATOR_ROOT) not in sys.path:
    sys.path.insert(0, str(GENERATOR_ROOT))

from lib.utils import can_use_cuda, to_win_path
import workflows.flux as flux_workflow


# ---------------------------------------------------------------------------
# Test configuration
# ---------------------------------------------------------------------------

MODEL_PATH = "D:/comfy_models/diffusion_models/flux/STOIQOAfroditeFLUXXL_F1DAlpha.safetensors"
PROMPT = "A cinematic portrait photo of a red fox in soft golden-hour light"
WIDTH = 512
HEIGHT = 512
STEPS = 4
GUIDANCE = 3.5
SEED = 12345
USE_CPU_OFFLOAD = True
ENABLE_XFORMERS = False
FLUX_DTYPE = "fp16"


def _log(message: str) -> None:
    print(f"[flux-test] {message}", flush=True)

class FluxIntegrationTest(unittest.TestCase):
    """Integration coverage for real FLUX pipeline loading and one generation pass."""

    def test_flux_generates_one_image_correctly(self) -> None:
        model_path = Path(to_win_path(MODEL_PATH))
        if not model_path.exists():
            self.skipTest(f"Configured model does not exist: {model_path}")

        _log(f"using model: {model_path}")
        _log("importing torch...")

        try:
            import torch
        except Exception as exc:
            self.fail(f"PyTorch import failed: {exc}")

        _log("torch imported")
        use_cuda = can_use_cuda(torch)
        _log(f"torch version: {getattr(torch, '__version__', 'unknown')}")
        _log(f"cuda available: {use_cuda}")

        flux_dtype_env = (FLUX_DTYPE or "fp16").strip().lower()
        flux_dtype = torch.float16 if use_cuda else torch.float32
        if use_cuda and flux_dtype_env in ("bf16", "bfloat16"):
            flux_dtype = torch.bfloat16

        _log(f"dtype: {flux_dtype}")
        _log(f"options: cpu_offload={USE_CPU_OFFLOAD} xformers={ENABLE_XFORMERS}")

        _log("loading pipeline...")
        load_started = time.time()
        pipe = flux_workflow.load_pipeline(
            model_path=str(model_path),
            configs_dir=GENERATOR_ROOT / "configs",
            torch_module=torch,
            use_cuda=use_cuda,
            flux_dtype=flux_dtype,
            use_cpu_offload=USE_CPU_OFFLOAD,
            enable_xformers=ENABLE_XFORMERS,
        )
        _log(f"pipeline loaded in {time.time() - load_started:.1f}s")

        payload = {
            "prompt": PROMPT,
            "width": WIDTH,
            "height": HEIGHT,
            "steps": STEPS,
            "guidance": GUIDANCE,
            "seed": SEED,
        }
        _log(
            "generating image: "
            f"size={WIDTH}x{HEIGHT} steps={STEPS} guidance={GUIDANCE} seed={SEED}"
        )

        generate_started = time.time()
        image, seed = flux_workflow.generate(pipe, payload, torch)
        _log(f"generation finished in {time.time() - generate_started:.1f}s")

        self.assertIsNotNone(image)
        self.assertEqual(seed, SEED)
        self.assertEqual(image.size, (WIDTH, HEIGHT))

        with tempfile.TemporaryDirectory() as tmpdir:
            out_path = Path(tmpdir) / f"flux-integration-{seed}.png"
            image.save(out_path)
            self.assertTrue(out_path.exists())
            self.assertGreater(out_path.stat().st_size, 0)
            _log(f"saved image bytes: {out_path.stat().st_size}")


if __name__ == "__main__":
    unittest.main()
