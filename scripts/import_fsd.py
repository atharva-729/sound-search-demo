"""Unpack fsd50k_demo.zip (from the Colab cell in README.md) into data/fsd50k/ and check it covers every FSD50K clip.

    ../audio-vocab/.venv/Scripts/python scripts/import_fsd.py [path/to/fsd50k_demo.zip]
"""
import sys
import zipfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parents[1]
src = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "Downloads" / "fsd50k_demo.zip"
out = HERE / "data" / "fsd50k"
out.mkdir(parents=True, exist_ok=True)
want = {str(i) for i in np.load(HERE.parent / "audio-vocab" / "fsd50k_colab.npz")["ids"]}
with zipfile.ZipFile(src) as z:
    for n in z.namelist():
        stem = Path(n).stem
        if n.endswith(".mp3") and stem in want:   # only the expected file names; nothing else is written
            (out / f"{stem}.mp3").write_bytes(z.read(n))
have = {p.stem for p in out.glob("*.mp3")}
print(f"{len(want & have)} of {len(want)} FSD50K clips present; missing: {sorted(want - have)[:10]}")
