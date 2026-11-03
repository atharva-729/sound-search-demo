"""Pack every hosted clip into a few long Opus files for GitHub Releases. Run with the audio-vocab venv:

    ../audio-vocab/.venv/Scripts/python scripts/pack_audio.py            # both maps -> dist/audio/*.webm + docs/audio_<map>.js

Each pack holds one dataset's clips back to back, with GAP s of silence before, between and after them, so a seek that
lands a second or two early or late still plays the intended clip. The page seeks to a clip's start and stops at its end.
Podcasts are not packed (their audio belongs to the publishers): the page streams them from each episode's own URL in
the feed, seeking to the clip. Then upload dist/audio/*.webm to the release named in --base; see the README.
Run after scripts/build.py: offsets follow data/<map>/items.parquet.
"""
import argparse
import hashlib
import json
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parents[1]
POD = HERE.parent / "podcast-vibe-search"
OUT = HERE / "dist" / "audio"
BASE = "https://github.com/atharva-729/sound-search-demo/releases/download/audio-v1/"
MAPS = ("real", "sounds")
SR, GAP, PACK_S = 48000, 5.0, 1800   # sample rate, silence between clips (s), audio per pack (s)
KBPS = {"music": 48}                 # Opus bitrate per collection; everything else 32 kb/s mono
SKIP = {"podcast"}


def decode(job):
    f, start, dur = job
    r = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-ss", str(start), "-i", f, "-t", str(dur),
                        "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"], capture_output=True)
    return np.frombuffer(r.stdout, np.int16) if r.returncode == 0 else np.zeros(0, np.int16)


def encode(pcm, dst, kbps):
    tmp = dst.with_suffix(".part.webm")
    p = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "-",
                        "-c:a", "libopus", "-b:a", f"{kbps}k", "-vbr", "on", "-application", "audio", "-f", "webm", str(tmp)],
                       input=pcm.tobytes(), capture_output=True)
    if p.returncode:
        raise RuntimeError(p.stderr.decode(errors="ignore")[-400:])
    tmp.replace(dst)


def packs_for(items):
    """[(name, collection, [item index, ...])]: one dataset per pack, about PACK_S s of audio each."""
    out = []
    for (col, ds), g in items.groupby(["collection", "dataset"], sort=False):
        if ds in SKIP:
            continue
        cur, t = [], 0.0
        for i, d in zip(g.index, g.dur):
            if cur and t + d + GAP > PACK_S:
                out.append((col, ds, cur)); cur, t = [], 0.0
            cur.append(i); t += d + GAP
        if cur:
            out.append((col, ds, cur))
    seen = {}
    named = []
    for col, ds, ids in out:
        k = seen[(col, ds)] = seen.get((col, ds), -1) + 1
        named.append((f"{col}-{ds}-{k:02d}.webm", col, ids))
    return named


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=BASE, help="URL the packs are served from (the release's download URL)")
    ap.add_argument("--force", action="store_true", help="re-encode packs that are already up to date")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    gap = np.zeros(int(GAP * SR), np.int16)
    for mp in MAPS:
        items = pd.read_parquet(HERE / "data" / mp / "items.parquet")
        man_p = OUT / f"manifest_{mp}.json"
        manifest = json.loads(man_p.read_text()) if man_p.exists() else {}
        packs, clips, failed = packs_for(items), [0] * len(items), 0
        for name, col, ids in packs:
            dst = OUT / f"{mp}-{name}"
            key = hashlib.sha1(json.dumps([[items.id[i], float(items.start[i]), float(items.dur[i])] for i in ids]).encode()).hexdigest()
            if not a.force and dst.exists() and manifest.get(dst.name, {}).get("key") == key:
                continue
            with ThreadPoolExecutor(12) as ex:
                pcm = list(ex.map(decode, [(items.file[i], items.start[i], items.dur[i]) for i in ids]))
            parts, pos, spans = [gap], len(gap), []
            for x in pcm:   # [start s, duration s] of each clip inside the pack; 0 when it failed to decode
                if len(x) == 0:
                    spans.append(0); continue
                spans.append([round(pos / SR, 3), round(len(x) / SR, 3)])
                parts += [x, gap]; pos += len(x) + len(gap)
            encode(np.concatenate(parts), dst, KBPS.get(col, 32))
            manifest[dst.name] = {"key": key, "spans": spans}
            print(f"  {dst.name}: {sum(1 for c in spans if c)} clips, {pos / SR / 60:.0f} min, {dst.stat().st_size / 1e6:.1f} MB", flush=True)
        names = [f"{mp}-{name}" for name, _, _ in packs]
        for n, (nm, (_, _, ids)) in enumerate(zip(names, packs)):
            for i, c in zip(ids, manifest[nm]["spans"]):
                clips[i] = [n, *c] if c else 0
                failed += not c
        man_p.write_text(json.dumps({k: v for k, v in manifest.items() if k in names}))
        size = sum((OUT / n).stat().st_size for n in names) / 1e6
        n_packs, n_pod = len(names), 0
        # podcasts stream from the publisher's own episode URL: its absolute URL goes in the packs list
        pod = items[items.dataset == "podcast"]
        if len(pod):
            url = pd.read_parquet(POD / "data" / "episodes.parquet").set_index("audio_file").audio_url
            for i, f, s, d in zip(pod.index, pod.file, pod.start, pod.dur):
                u = re.sub(r"^http://", "https://", url[Path(f).name])   # the page is https; plain http would be blocked
                if u not in names:
                    names.append(u)
                clips[i] = [names.index(u), round(float(s), 3), round(float(d), 3)]
                n_pod += 1
        page = {"n": len(items), "base": a.base, "packs": names, "clips": clips}
        (HERE / "docs" / f"audio_{mp}.js").write_text("const AUDIO = " + json.dumps(page, separators=(",", ":")) + ";\n", encoding="utf-8")
        print(f"{mp}: {sum(1 for c in clips if c) - n_pod} of {len(items)} clips in {n_packs} packs, {size:.0f} MB"
              f"{f', {n_pod} podcast clips from {len(names) - n_packs} publisher episodes' if n_pod else ''}"
              f"{f', {failed} failed to decode' if failed else ''}", flush=True)


if __name__ == "__main__":
    main()
