"""Build the demo's data from the sister repos. Run with the audio-vocab venv:

    ../audio-vocab/.venv/Scripts/python scripts/build.py                      # all collections
    ../audio-vocab/.venv/Scripts/python scripts/build.py --drop podcasts      # leave a collection out

Writes data/items.parquet + data/{clap,gemma}.npy (for the server's typed search) and docs/data.js (for the page).
"""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
GH = HERE.parent
AV, POD = GH / "audio-vocab", GH / "podcast-vibe-search"
sys.path.insert(0, str(AV / "src"))

import numpy as np
import pandas as pd

from chips import CHIPS

COLLECTIONS = ["sounds", "emotions", "podcasts"]
CREMA_SENT = {"IEO": "It's eleven o'clock", "TIE": "That is exactly what happened", "IOM": "I'm on my way to the meeting",
              "IWW": "I wonder what this is about", "TAI": "The airplane is almost full",
              "MTI": "Maybe tomorrow it will be cold", "IWL": "I would like a new alarm clock",
              "ITH": "I think I have a doctor's appointment", "DFA": "Don't forget a jacket",
              "ITS": "I think I've seen this before", "TSI": "The surface is slick",
              "WSI": "We'll stop in a couple of minutes"}
EMO = {"ANG": "angry", "DIS": "disgusted", "FEA": "afraid", "HAP": "happy", "SAD": "sad", "NEU": "neutral"}
TOP_CHIP, TOP_NN = 150, 40


def l2(x):
    return x / np.linalg.norm(x, axis=1, keepdims=True).clip(1e-12)


def audio_vocab(cols):
    c = pd.read_parquet(AV / "data" / "clips.parquet")
    emb = {m: dict(zip(json.load(open(AV / "index" / f"{m}_clip_ids.json")), np.load(AV / "index" / f"{m}.npy")))
           for m in ("clap", "gemma")}
    parts = []
    if "sounds" in cols:
        s = c[c.dataset.isin(["vocalsound", "esc50"])].copy()
        s["collection"], s["name"] = "sounds", s.label.str.replace("_", " ").replace({"throatclearing": "throat clearing"})
        parts.append(s)
    if "emotions" in cols:
        e = c[c.dataset == "cremad"].groupby("label").sample(120, random_state=0).copy()
        e["collection"] = "emotions"
        e["name"] = e.label.map(EMO) + ": “" + e.sentence.map(CREMA_SENT) + "”"
        parts.append(e)
    if "sounds" in cols:
        # FSD50K was embedded in Colab (audio-vocab/fsd50k_colab.npz); its audio comes as mp3s in data/fsd50k/.
        z = np.load(AV / "fsd50k_colab.npz")
        for m in emb:
            emb[m].update({f"fsd50k:{i}:0": v for i, v in zip(z["ids"], z[m])})
        f = c[c.dataset == "fsd50k"].copy()
        f["collection"], f["name"] = "sounds", f.label.str.replace("_", " ")
        f["source"] = [str(HERE / "data" / "fsd50k" / f"{s.split(':')[1]}.mp3") for s in f.clip_id]
        parts.append(f)
    if not parts:
        return pd.DataFrame(), {}
    d = pd.concat(parts)
    d = d[d.clip_id.isin(emb["clap"].keys()) & d.clip_id.isin(emb["gemma"].keys())]
    items = pd.DataFrame({"id": d.clip_id.values, "collection": d.collection.values, "dataset": d.dataset.values,
                          "label": d.label.values, "name": d.name.values,
                          "file": [s if Path(s).is_absolute() else str(AV / "data" / "raw" / s) for s in d.source],
                          "start": d.start.values, "dur": d.dur.values.clip(max=10)})
    return items, {m: np.stack([emb[m][i] for i in items.id]) for m in emb}


def podcasts():
    f = HERE / "data" / "podcast_clap.npy"
    if not f.exists():
        print("! podcasts skipped: data/podcast_clap.npy not built yet (scripts/embed_podcasts_clap.py)")
        return pd.DataFrame(), {}
    seg = pd.read_parquet(POD / "index" / "segments.parquet")
    eps = pd.read_parquet(POD / "data" / "episodes.parquet").set_index("episode_id")
    ep = eps.loc[seg.episode_id]
    mmss = lambda t: f"{int(t // 60)}:{int(t % 60):02d}"
    items = pd.DataFrame({"id": seg.segment_id.values, "collection": "podcasts", "dataset": "podcast",
                          "label": ep.vibe.values,
                          "name": [f"{s} @ {mmss(t)}" for s, t in zip(ep.show.values, seg.start_s.values)],
                          "file": [str(POD / "data" / "audio_cache" / a) for a in ep.audio_file.values],
                          "start": seg.start_s.values, "dur": (seg.end_s - seg.start_s).values})
    return items, {"clap": np.load(f), "gemma": np.load(POD / "index" / "audio_emb.npy")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--drop", nargs="*", default=[], choices=COLLECTIONS)
    cols = [c for c in COLLECTIONS if c not in ap.parse_args().drop]

    a_items, a_emb = audio_vocab(cols)
    p_items, p_emb = podcasts() if "podcasts" in cols else (pd.DataFrame(), {})
    items = pd.concat([a_items, p_items], ignore_index=True)
    emb = {m: l2(np.concatenate([x[m] for x in (a_emb, p_emb) if x]).astype(np.float32)) for m in ("clap", "gemma")}
    assert all(len(v) == len(items) for v in emb.values())
    print(items.collection.value_counts().to_dict())

    import umap
    xy = umap.UMAP(n_neighbors=15, min_dist=0.08, metric="cosine", random_state=0).fit_transform(emb["clap"])
    xy = (xy - xy.min(0)) / (xy.max(0) - xy.min(0))

    from audiovocab import embed
    models = {"clap": embed.load("clap"), "gemma": embed.load("gemma", text_only=True)}
    chips = []
    for ch in CHIPS:
        out = dict(ch)
        for m, mod in models.items():
            q = l2(mod.text(ch["texts"]).mean(0, keepdims=True))[0]
            s = emb[m] @ q
            top = np.argsort(-s)[:TOP_CHIP]
            out[m] = [[int(i), round(float(s[i]), 4)] for i in top]
        chips.append(out)

    nn = {}
    for m in ("clap", "gemma"):
        sim = emb[m] @ emb[m].T
        np.fill_diagonal(sim, -1)
        nn[m] = np.argsort(-sim, axis=1)[:, :TOP_NN].tolist()

    (HERE / "data").mkdir(exist_ok=True)
    items.to_parquet(HERE / "data" / "items.parquet")
    for m in emb:
        np.save(HERE / "data" / f"{m}.npy", emb[m])
    page = {"collections": cols,
            "items": [[r.collection, r.label, r.name, round(float(x), 4), round(float(y), 4), round(float(r.dur), 1)]
                      for r, (x, y) in zip(items.itertuples(), xy)],
            "chips": chips, "nn": nn}
    (HERE / "docs" / "data.js").write_text("const DATA = " + json.dumps(page, ensure_ascii=False, separators=(",", ":"))
                                           + ";\n", encoding="utf-8")
    print("wrote", len(items), "items")


if __name__ == "__main__":
    main()
