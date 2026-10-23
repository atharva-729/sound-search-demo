"""CLAP embeddings for the podcast-vibe-search clips, written to THIS repo (never to the sister's index).

Run with the podcast venv:  ../podcast-vibe-search/.venv/Scripts/python scripts/embed_podcasts_clap.py
Resumable per episode under runs/pod_clap/. Output: data/podcast_clap.npy (row order = sister segments.parquet).
"""
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
POD = HERE.parent / "podcast-vibe-search"
sys.path.insert(0, str(POD / "src"))

import numpy as np
import pandas as pd

from vibe import embed

parts = HERE / "runs" / "pod_clap"
parts.mkdir(parents=True, exist_ok=True)
seg = pd.read_parquet(POD / "index" / "segments.parquet")
model = embed.load("clap")
t0 = time.time()
groups = list(seg.groupby("episode_id", sort=False))
for n, (ep, g) in enumerate(groups):
    f = parts / f"{ep}.npy"
    if not f.exists():
        e, _ = embed.embed_segments(model, g, log_every=0)
        np.save(f, e)
    print(f"[{n + 1}/{len(groups)}] {ep}: {len(g)} segs, {(time.time() - t0) / 60:.1f} min", flush=True)
emb = np.concatenate([np.load(parts / f"{ep}.npy") for ep, _ in groups])
assert len(emb) == len(seg)
np.save(HERE / "data" / "podcast_clap.npy", emb)
seg[["segment_id"]].to_parquet(HERE / "data" / "podcast_clap_ids.parquet")
print("done", emb.shape, f"{(time.time() - t0) / 60:.1f} min", flush=True)
