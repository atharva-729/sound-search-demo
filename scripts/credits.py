"""Per-clip credits and licences for both maps, from the sister repos' metadata. Run with the audio-vocab venv:

    ../audio-vocab/.venv/Scripts/python scripts/credits.py

Writes docs/credits_<map>.js (the page shows the credit of the clip playing) and credits/clips_<map>.csv (the full list).
Run after scripts/build.py: rows follow data/<map>/items.parquet.
"""
import csv
import io
import json
import re
import zipfile
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parents[1]
AV, POD = HERE.parent / "audio-vocab", HERE.parent / "podcast-vibe-search"
META = AV / "data" / "raw" / "meta"
MAPS = ("real", "sounds")

# dataset-level credit shown after each clip's own credit
DATASET = {"esc50": "ESC-50 (Piczak 2015), CC BY-NC 3.0", "fsd50k": "FSD50K (Fonseca et al. 2022)",
           "vocalsound": "VocalSound (Gong et al. 2022)", "cremad": "CREMA-D (Cao et al. 2014)",
           "xenocanto": "xeno-canto.org", "fma": "Free Music Archive, via FMA (Defferrard et al. 2017)",
           "mtg": "Jamendo, via MTG-Jamendo (Bogdanov et al. 2019), non-commercial research use",
           "musopen": "Musopen, via the Internet Archive", "podcast": "plays from the publisher's feed, not copied"}
CC_DEED = "https://creativecommons.org/licenses/{}/{}/"


def cc_short(text, url=""):
    """'Attribution-Noncommercial-Share Alike 3.0 United States' or a CC URL -> ('CC BY-NC-SA 3.0', deed URL)."""
    t, u = (text or "").strip(), (url or "").strip()
    m = re.search(r"creativecommons\.org/licenses/([a-z+\-]+)/(\d\.\d)", u or t)
    if m:
        code, v = m.groups()
        return ("CC Sampling+ " + v if code == "sampling+" else f"CC {code.upper()} {v}"), u or CC_DEED.format(code, v)
    if "publicdomain/zero" in (u or t) or t.startswith("CC0"):
        return "CC0 1.0", "https://creativecommons.org/publicdomain/zero/1.0/"
    if "publicdomain/mark" in u or t.lower().startswith("public domain"):
        return "Public domain", u or "https://creativecommons.org/publicdomain/mark/1.0/"
    low = t.lower().replace(" ", "").replace("-", "")
    if low.startswith(("attribution", "creativecommonsattribution")):
        parts = ["BY"] + [p for k, p in (("noncommercial", "NC"), ("noderiv", "ND"), ("sharealike", "SA")) if k in low]
        v = re.search(r"(\d\.\d)", t)
        return f"CC {'-'.join(parts)}{' ' + v.group(1) if v else ''}", u
    return t or "unknown", u


def esc50():
    out = {}
    # a few lines have two spaces, a markdown-style title or a typo'd name ("5-141683-Ad"): key on fold-id-take only
    pat = re.compile(r"^- \[(?P<f>\d+-\d+-[A-Z])[^\]]*\.ogg\]:\s+clip derived from (?P<title>.+?) ?\((?P<url>http[^)]+)\) by (?P<user>.+?) \[(?P<lic>[^\]]+)\]$")
    lic = {"CC0": "CC0", "CC-BY": "by/3.0", "CC-BY-NC": "by-nc/3.0", "CC-Sampling+": "sampling+/1.0"}
    for line in (META / "esc50" / "LICENSE").read_text(encoding="utf-8").splitlines():
        m = pat.match(line.strip())
        if m:
            l = lic.get(m["lic"], m["lic"])
            title = m["title"][1:-1] if m["title"].startswith("[") and m["title"].endswith("]") else m["title"]
            out[m["f"]] = (f"“{title}” by {m['user']}, Freesound", *cc_short(l, "" if l == "CC0" else CC_DEED.format(*l.split("/"))),
                           m["url"].replace("http://www.", "https://"))
    return out


def fsd50k():
    z = zipfile.ZipFile(META / "fsd50k" / "FSD50K.metadata.zip")
    out = {}
    for part in ("eval", "dev"):
        for k, v in json.load(z.open(f"FSD50K.metadata/{part}_clips_info_FSD50K.json")).items():
            out[k] = (f"“{v['title']}” by {v['uploader']}, Freesound", *cc_short("", v["license"]),
                      f"https://freesound.org/s/{k}/")
    return out


def fma(ids):
    z = zipfile.ZipFile(META / "fma" / "fma_metadata.zip")
    out = {}
    with z.open("fma_metadata/raw_tracks.csv") as f:
        for r in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8")):
            if r["track_id"] in ids:
                out[r["track_id"]] = (f"“{r['track_title']}” by {r['artist_name']}", *cc_short(r["license_title"], r["license_url"]),
                                      r["track_url"])
    return out


def xenocanto():
    out = {}
    for p in (META / "xenocanto").glob("*.json"):
        for r in json.loads(p.read_text(encoding="utf-8")).get("recordings", []):
            out["XC" + r["id"]] = (f"{r['en']}, recorded by {r['rec']} ({r.get('cnt', '')})", *cc_short("", r["lic"]),
                                   r["url"] if r["url"].startswith("http") else "https:" + r["url"])
    return out


def podcasts():
    eps = pd.read_parquet(POD / "data" / "episodes.parquet")
    return {r.audio_file: (f"{r.show}: “{r.title}”", "© the publisher", "", r.show_link or "") for r in eps.itertuples()}


def main():
    clips = pd.read_parquet(AV / "data" / "clips.parquet").set_index("clip_id")
    fma_ids = set(clips[clips.dataset == "fma"].item_id.astype(str).str.lstrip("0"))
    src = {"esc50": esc50(), "fsd50k": fsd50k(), "fma": fma(fma_ids), "xenocanto": xenocanto(), "podcast": podcasts()}
    (HERE / "credits").mkdir(exist_ok=True)
    for mp in MAPS:
        items = pd.read_parquet(HERE / "data" / mp / "items.parquet")
        rows, missing = [], {}
        for it in items.itertuples():
            d = it.dataset
            c = clips.loc[it.id] if it.id in clips.index else None
            if d == "esc50":
                cr = src[d].get(c.item_id.rsplit("-", 1)[0])
            elif d == "fsd50k":
                cr = src[d].get(str(c.item_id))
            elif d == "fma":
                cr = src[d].get(str(c.item_id).lstrip("0"))
            elif d == "xenocanto":
                cr = src[d].get(c.item_id)
            elif d == "podcast":
                cr = src[d].get(Path(it.file).name)
            elif d == "mtg":
                n = c.item_id.split("_")[-1].lstrip("0")
                cr = (f"Jamendo track {n}", "CC (per track)", "", f"https://www.jamendo.com/track/{n}")
            elif d == "musopen":
                cr = (f"{c.composer}: {it.name}", "Public domain", "https://creativecommons.org/publicdomain/mark/1.0/",
                      "https://archive.org/details/MusopenCollectionAsFlac")
            elif d == "vocalsound":
                cr = (f"Speaker {c.item_id.split('_')[0]}", "CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/",
                      "https://github.com/YuanGongND/vocalsound")
            elif d == "cremad":
                cr = (f"Actor {c.item_id.split('_')[0]}", "ODbL 1.0 / DbCL 1.0", "https://opendatacommons.org/licenses/dbcl/1-0/",
                      "https://github.com/CheyneyComputerScience/CREMA-D")
            else:
                cr = None
            if cr is None:   # fall back to the dataset licence on file
                missing[d] = missing.get(d, 0) + 1
                cr = (it.name, *cc_short(c.licence if c is not None else ""), "")
            rows.append((d, it.name, *cr, DATASET.get(d, d)))

        lic = sorted({(r[3], r[4]) for r in rows})
        li = {l: n for n, l in enumerate(lic)}
        page = {"lic": lic, "ds": DATASET, "c": [[r[2], li[(r[3], r[4])], r[5], r[0]] for r in rows]}
        (HERE / "docs" / f"credits_{mp}.js").write_text("const CREDITS = " + json.dumps(page, ensure_ascii=False, separators=(",", ":"))
                                                        + ";\n", encoding="utf-8")
        with open(HERE / "credits" / f"clips_{mp}.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["index", "dataset", "clip", "credit", "licence", "licence_url", "source_url", "dataset_credit"])
            w.writerows([i, *r] for i, r in enumerate(rows))
        counts = pd.Series([r[3] for r in rows]).value_counts()
        print(f"{mp}: {len(rows)} clips, {len(lic)} licences, no per-clip credit found: {missing or 'none'}")
        print("  ", counts.head(12).to_dict())


if __name__ == "__main__":
    main()
