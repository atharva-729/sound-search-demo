"""Build a self-contained folder (and zip) to hand the demo to someone else. Run with the audio-vocab venv:

    ../audio-vocab/.venv/Scripts/python scripts/make_bundle.py [OUT_DIR]      # default ~/Documents/SoundSearch

Inside: web/ (page + every clip as a small mp3, works by double-clicking index.html), search/ (the two text
encoders and the clip embeddings for typed search), start.bat / start.command (one-time automatic setup with uv).
"""
import shutil
import subprocess
import sys
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parents[1]
MODELS = HERE.parent / "podcast-vibe-search" / "models"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "Documents" / "SoundSearch"
MAPS = ("real", "sounds")


def cut(job):
    src, start, dur, dst = job
    if dst.exists() and dst.stat().st_size > 0:
        return True
    r = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-ss", str(start), "-i", src, "-t", str(dur),
                        "-ac", "1", "-b:a", "56k", str(dst)], capture_output=True)
    return r.returncode == 0 and dst.exists()


def main():
    web, srch = OUT / "web", OUT / "search"
    for d in (web, srch):
        d.mkdir(parents=True, exist_ok=True)

    # 1. every clip as a static mp3: web/clips/<map>/<i>.mp3
    for m in MAPS:
        items = pd.read_parquet(HERE / "data" / m / "items.parquet")
        (web / "clips" / m).mkdir(parents=True, exist_ok=True)
        jobs = [(r.file, r.start, r.dur, web / "clips" / m / f"{i}.mp3") for i, r in enumerate(items.itertuples())]
        with ThreadPoolExecutor(10) as ex:
            ok = list(ex.map(cut, jobs))
        print(f"{m}: {sum(ok)} of {len(ok)} clips", flush=True)

    # 2. the page, told to play the static clips
    for f in ("app.js", "data_real.js", "data_sounds.js"):
        shutil.copy2(HERE / "docs" / f, web / f)
    html = (HERE / "docs" / "index.html").read_text(encoding="utf-8")
    html = html.replace("<title>Sound Search</title>", "<title>Sound Search</title>\n<script>window.BUNDLE = true;</script>", 1)
    (web / "index.html").write_text(html, encoding="utf-8")

    # 3. typed search: embeddings + the two text encoders + a small server
    for m in MAPS:
        (srch / m).mkdir(exist_ok=True)
        for k in ("clap", "gemma"):
            shutil.copy2(HERE / "data" / m / f"{k}.npy", srch / m / f"{k}.npy")
    for name in ("laion--clap-htsat-unfused", "google--embeddinggemma-2"):
        if not (srch / "models" / name).exists():
            shutil.copytree(MODELS / name, srch / "models" / name)
    shutil.copy2(HERE / "scripts" / "bundle_server.py", srch / "server.py")
    shutil.copy2(HERE / "scripts" / "bundle_files" / "requirements.txt", srch / "requirements.txt")
    for f in ("start.bat", "start.command", "START HERE.txt"):
        shutil.copy2(HERE / "scripts" / "bundle_files" / f, OUT / f)
    uv = HERE / "scripts" / "bundle_files" / "uv.exe"
    if uv.exists():
        shutil.copy2(uv, srch / "uv.exe")
    print("folder ready:", OUT, flush=True)

    # 4. zip (stored: mp3 and model weights don't compress)
    z = OUT.parent / (OUT.name + ".zip")
    with zipfile.ZipFile(z, "w", zipfile.ZIP_STORED, allowZip64=True) as zf:
        for p in sorted(OUT.rglob("*")):
            if p.is_file() and ".venv" not in p.parts and "__pycache__" not in p.parts:
                zf.write(p, Path(OUT.name) / p.relative_to(OUT))
    print("zip ready:", z, round(z.stat().st_size / 1e9, 2), "GB", flush=True)


if __name__ == "__main__":
    main()
