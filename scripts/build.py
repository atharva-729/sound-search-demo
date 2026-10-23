"""Build one of the demo's two maps from the sister repos. Run with the audio-vocab venv:

    ../audio-vocab/.venv/Scripts/python scripts/build.py real      # podcasts, voices, music  (default map)
    ../audio-vocab/.venv/Scripts/python scripts/build.py sounds    # sound effects and birds
    ../audio-vocab/.venv/Scripts/python scripts/build.py real --drop podcasts

Writes data/<map>/items.parquet + {clap,gemma}.npy (for the server's typed search) and docs/data_<map>.js (the page).
"""
import argparse
import ast
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

MAPS = {"real": ["podcasts", "voices", "music"], "sounds": ["sounds"]}
CREMA_SENT = {"IEO": "It's eleven o'clock", "TIE": "That is exactly what happened", "IOM": "I'm on my way to the meeting",
              "IWW": "I wonder what this is about", "TAI": "The airplane is almost full",
              "MTI": "Maybe tomorrow it will be cold", "IWL": "I would like a new alarm clock",
              "ITH": "I think I have a doctor's appointment", "DFA": "Don't forget a jacket",
              "ITS": "I think I've seen this before", "TSI": "The surface is slick",
              "WSI": "We'll stop in a couple of minutes"}
EMO = {"ANG": "angry", "DIS": "disgusted", "FEA": "afraid", "HAP": "happy", "SAD": "sad", "NEU": "neutral"}
# FSD50K classes that are people's voices go on the real-audio map; the rest are sound effects
FSD_VOICE = {"Female_speech_and_woman_speaking", "Male_speech_and_man_speaking", "Child_speech_and_kid_speaking", "Singing",
             "Whispering", "Shout", "Screaming", "Crying_and_sobbing", "Giggle", "Chuckle_and_chortle"}
TOP_CHIP, TOP_NN = 150, 40


def l2(x):
    return x / np.linalg.norm(x, axis=1, keepdims=True).clip(1e-12)


def lst(v):
    try:
        return [str(x) for x in ast.literal_eval(v)] if isinstance(v, str) and v.startswith("[") else []
    except (ValueError, SyntaxError):
        return []


def audio_vocab(cols):
    c = pd.read_parquet(AV / "data" / "clips.parquet")
    emb = {m: dict(zip(json.load(open(AV / "index" / f"{m}_clip_ids.json")), np.load(AV / "index" / f"{m}.npy")))
           for m in ("clap", "gemma")}
    # FSD50K was embedded in Colab (audio-vocab/fsd50k_colab.npz); its audio is the mp3s in data/fsd50k/
    z = np.load(AV / "fsd50k_colab.npz")
    for m in emb:
        emb[m].update({f"fsd50k:{i}:0": v for i, v in zip(z["ids"], z[m])})
    fsd = c.dataset == "fsd50k"
    c.loc[fsd, "source"] = [str(HERE / "data" / "fsd50k" / f"{s.split(':')[1]}.mp3") for s in c[fsd].clip_id]
    c["tags"] = ""
    parts = []
    if "sounds" in cols:
        s = c[c.dataset.isin(["vocalsound", "esc50", "xenocanto"]) | (fsd & ~c.label.isin(FSD_VOICE))].copy()
        s["collection"], s["name"] = "sounds", s.label.str.replace("_", " ").replace({"throatclearing": "throat clearing"})
        parts.append(s)
    if "voices" in cols:
        e = c[c.dataset == "cremad"].groupby("label").sample(120, random_state=0).copy()
        e["name"] = e.label.map(EMO) + ": “" + e.sentence.map(CREMA_SENT) + "”"
        f = c[fsd & c.label.isin(FSD_VOICE)].copy()
        f["name"] = f.label.str.replace("_", " ")
        v = pd.concat([e, f]); v["collection"] = "voices"
        parts.append(v)
    if "music" in cols:
        fma = pd.concat([g.sample(min(len(g), 220), random_state=0) for _, g in c[c.dataset == "fma"].groupby("label")])
        mtg = c[c.dataset == "mtg"].copy()
        g, ins = mtg.mtg_genres.map(lst), mtg.instruments.map(lst)
        mtg["label"] = [x[0] if x else "music" for x in g]
        mtg["tags"] = ["|".join(a + b) for a, b in zip(g, ins)]
        mus = c[c.dataset == "musopen"].copy()
        m = pd.concat([fma, mtg, mus]); m["collection"] = "music"
        m["name"] = [f"{l} · {'FMA' if d == 'fma' else 'Jamendo'}" for l, d in zip(m.label, m.dataset)]
        mo = m.dataset == "musopen"
        m.loc[mo, "name"] = [Path(s).stem.split("__")[0].replace("_", " ")[:60] for s in m[mo].source]
        parts.append(m)
    if not parts:
        return pd.DataFrame(), {}
    d = pd.concat(parts)
    d = d[d.clip_id.isin(emb["clap"].keys()) & d.clip_id.isin(emb["gemma"].keys())]
    items = pd.DataFrame({"id": d.clip_id.values, "collection": d.collection.values, "dataset": d.dataset.values,
                          "label": d.label.values, "name": d.name.values, "tags": d.tags.values,
                          "file": [s if Path(s).is_absolute() else str(AV / "data" / "raw" / s) for s in d.source],
                          "start": d.start.values, "dur": d.dur.values.clip(max=10)})
    return items, {m: np.stack([emb[m][i] for i in items.id]) for m in emb}


def podcasts():
    seg = pd.read_parquet(POD / "index" / "segments.parquet")
    eps = pd.read_parquet(POD / "data" / "episodes.parquet").set_index("episode_id")
    ep = eps.loc[seg.episode_id]
    mmss = lambda t: f"{int(t // 60)}:{int(t % 60):02d}"
    items = pd.DataFrame({"id": seg.segment_id.values, "collection": "podcasts", "dataset": "podcast",
                          "label": ep.vibe.values, "tags": "",
                          "name": [f"{s} @ {mmss(t)}" for s, t in zip(ep.show.values, seg.start_s.values)],
                          "file": [str(POD / "data" / "audio_cache" / "raw" / a) for a in ep.audio_file.values],
                          "start": seg.start_s.values, "dur": (seg.end_s - seg.start_s).values})
    return items, {"clap": np.load(HERE / "data" / "podcast_clap.npy"), "gemma": np.load(POD / "index" / "audio_emb.npy")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("map", nargs="?", default="real", choices=list(MAPS))
    ap.add_argument("--drop", nargs="*", default=[])
    a = ap.parse_args()
    cols = [c for c in MAPS[a.map] if c not in a.drop]

    a_items, a_emb = audio_vocab(cols)
    p_items, p_emb = podcasts() if "podcasts" in cols else (pd.DataFrame(), {})
    items = pd.concat([x for x in (p_items, a_items) if len(x)], ignore_index=True)
    emb = {m: l2(np.concatenate([x[m] for x in (p_emb, a_emb) if x]).astype(np.float32)) for m in ("clap", "gemma")}
    assert all(len(v) == len(items) for v in emb.values())
    print(a.map, items.collection.value_counts().to_dict())

    import umap
    # the layout follows the map's main model: Gemma for real audio (talk), CLAP for sound effects
    lay = "gemma" if a.map == "real" else "clap"
    xy = umap.UMAP(n_neighbors=15, min_dist=0.08, metric="cosine", random_state=0).fit_transform(emb[lay])
    xy = (xy - xy.min(0)) / (xy.max(0) - xy.min(0))

    from audiovocab import embed
    models = {"clap": embed.load("clap"), "gemma": embed.load("gemma", text_only=True)}
    tagsets = [{l} | set(t.split("|")) - {""} for l, t in zip(items.label, items.tags)]
    chips = []
    for ch in CHIPS:
        if ch.get("map", "sounds") != a.map:
            continue
        out = {k: v for k, v in ch.items() if k != "map"}
        scope = items.collection.isin(ch["scope"]).values if ch.get("scope") else np.ones(len(items), bool)
        if not scope.any():
            continue
        for m, mod in models.items():
            q = l2(mod.text(ch["texts"]).mean(0, keepdims=True))[0]
            s = np.where(scope, emb[m] @ q, -9)
            top = np.argsort(-s)[:TOP_CHIP]
            out[m] = [[int(i), round(float(s[i]), 4)] for i in top if s[i] > -9]
        L = set(ch["labels"])
        if L:   # how each model does, to check the default
            p = {m: sum(bool(tagsets[i] & L) for i, _ in out[m][:10]) for m in models}
            print(f"  {ch['title']:34s} clap {p['clap']}/10  gemma {p['gemma']}/10  (default {ch['model']})")
        chips.append(out)

    nn = {}
    for m in ("clap", "gemma"):
        sim = emb[m] @ emb[m].T
        np.fill_diagonal(sim, -1)
        nn[m] = np.argsort(-sim, axis=1)[:, :TOP_NN].tolist()

    out_dir = HERE / "data" / a.map
    out_dir.mkdir(parents=True, exist_ok=True)
    items.to_parquet(out_dir / "items.parquet")
    for m in emb:
        np.save(out_dir / f"{m}.npy", emb[m])
    page = {"map": a.map, "collections": cols,
            "items": [[r.collection, r.label, r.name, round(float(x), 4), round(float(y), 4), round(float(r.dur), 1), r.tags]
                      for r, (x, y) in zip(items.itertuples(), xy)],
            "chips": chips, "nn": nn}
    (HERE / "docs" / f"data_{a.map}.js").write_text("const DATA = " + json.dumps(page, ensure_ascii=False, separators=(",", ":"))
                                                   + ";\n", encoding="utf-8")
    print("wrote", len(items), "items")


if __name__ == "__main__":
    main()
