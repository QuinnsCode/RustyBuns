# ACE-Step 1.5 on a home GPU

Research, October 2026: can [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5) (an open music
generator, MIT licence) run locally on an RTX 3070 box with 16GB of RAM, or 32GB after a RAM upgrade?

## First, which card is it?

Every RTX 3070 has **8GB** of VRAM, the EVGA FTW3 included. The 24GB FTW3 is the **RTX 3090** (or the
3090 Ti). The two cards get very different answers, so check the box or run `nvidia-smi` (it shows the
name and memory, e.g. `24576MiB`).

## What the model is

Two parts: a language model (0.6B, 1.7B or 4B) plans the song (lyrics, captions, metadata), then a
diffusion transformer (DiT) renders the audio. The DiT comes in 2B (turbo, sft, base, about 4.7GB in
bf16) and XL 4B (about 9GB). It does text-to-music, covers, repainting, stem separation and LoRA
training. The upstream readme says a full song takes under 10 seconds on a 3090. The UI picks settings
from the VRAM it detects.

## The upstream tiers ([GPU_COMPATIBILITY.md](https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/GPU_COMPATIBILITY.md))

| VRAM | DiT | LM | Offload / quant | Max length | Batch |
|---|---|---|---|---|---|
| 6-8GB | 2B turbo | 0.6B, `pt` backend | CPU offload, INT8 | — | 2 |
| 8-12GB | 2B turbo/sft | 0.6B only, vLLM | CPU + DiT offload, INT8 | 8 min (10 without LM) | 2 (4 without LM) |
| 20-24GB | XL turbo/sft | 1.7B | none | 8 min | 8 |
| ≥24GB | XL sft/base | 4B | none | 10 min | 8 |

## Verdict

**RTX 3070 (8GB): works, but it's the budget tier.** 2B turbo with the 0.6B LM, INT8 and CPU offload.
No XL models, and the bigger LMs are out. Weights get moved between the GPU and system RAM on every
run, which costs time. One third-party desktop build warns it's "extremely slow on 8GB". Expect it to
be fine for trying it out, and a lot slower than the "seconds per song" headline.

**RTX 3090 (24GB): the sweet spot.** It sits right on the "everything fits, no offload" line: XL
models, 4B LM, batch 8, 10-minute songs. It's also the card behind the upstream speed claim.

**System RAM: 32GB if you can.** Upstream doesn't give a RAM figure, so this is my estimate from the
model sizes:

- 3070 + offload: the parked weights (2B DiT, 0.6B LM, text encoder, VAE) are roughly 7-8GB, held in
  RAM next to Windows, the browser UI and Python. 16GB should run, but tightly. Close other apps, and
  keep the page file on. 32GB takes away the squeeze.
- 3090: everything lives on the GPU, but the XL DiT plus the 4B LM (around 17GB) loads through RAM
  first. 16GB will lean on swap at load time. 32GB is comfortable.

Disk: the first run downloads about 10GB of models, more if you add the XL and 4B variants.

## Try it

Python 3.11-3.12 and [uv](https://docs.astral.sh/uv/), then:

```sh
git clone https://github.com/ace-step/ACE-Step-1.5
cd ACE-Step-1.5
uv sync
uv run acestep        # Gradio UI on :7860  (uv run acestep-api for the REST API on :8001)
```

There's a portable Windows package with the dependencies bundled, and ComfyUI has
[native support](https://comfyui-wiki.com/en/news/2026-01-23-ace-step-1-5-music-generation).
To get real numbers for your card, the repo's
[BENCHMARK.md](https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/BENCHMARK.md) has
`python profile_inference.py --mode benchmark` (timing) and `--mode tier-test --tiers 8` (peak VRAM).
Watch RAM in Task Manager while it runs. `ACESTEP_VAE_ON_CPU` trades VAE decode speed for VRAM.

## Sources

- [ACE-Step 1.5 repo and readme](https://github.com/ace-step/ACE-Step-1.5)
- [GPU_COMPATIBILITY.md](https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/GPU_COMPATIBILITY.md), [GPU_TROUBLESHOOTING.md](https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/GPU_TROUBLESHOOTING.md), [BENCHMARK.md](https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/BENCHMARK.md)
- [Unraid app (about 10GB first download, 1.7B LM for 12-16GB cards)](https://ca.unraid.net/apps/ace-step-1ahnkdm1flur5q)
- [ExpSoft desktop build, "extremely slow on 8GB VRAM"](https://www.patreon.com/posts/157516177)
- [ComfyUI support](https://comfyui-wiki.com/en/news/2026-01-23-ace-step-1-5-music-generation)
