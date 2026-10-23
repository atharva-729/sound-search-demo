# Sound Search

Search audio for the things nobody says: a cough, a sigh, waves, an angry tone. None of these are in a transcript.
One screen: a 2-D map of every clip, ready-made searches that circle their matches, a search box for your own words,
and "sounds like this" for searching by example. Click any dot to hear it.

Built on the embeddings of two sister projects. Nothing is re-trained.
- `../audio-vocab`: VocalSound, ESC-50, FSD50K and CREMA-D clips, embedded with CLAP and EmbeddingGemma 2.
- `../podcast-vibe-search`: 2,808 podcast clips. Gemma embeddings came from the sister project; CLAP was added here
  with `scripts/embed_podcasts_clap.py`, which writes only into this repo.

## Run

```
../audio-vocab/.venv/Scripts/python scripts/serve.py        # http://127.0.0.1:8770/
```

Typed search and audio need the server. The ready-made chips also work from the static page.

## Rebuild

```
../podcast-vibe-search/.venv/Scripts/python scripts/embed_podcasts_clap.py   # once, ~20 min, resumable
../audio-vocab/.venv/Scripts/python scripts/build.py                         # ~2 min
../audio-vocab/.venv/Scripts/python scripts/build.py --drop podcasts         # leave a collection out
```

The layer buttons on the page hide a collection without rebuilding. `--drop` removes it from the map layout too.
Ready-made searches live in `scripts/chips.py`. Restart the server after a rebuild.

## FSD50K audio (from Colab)

FSD50K's embeddings are in `../audio-vocab/fsd50k_colab.npz`, but its audio isn't on this laptop (Zenodo is blocked).
The earlier Colab run left the extracted clips in Google Drive (`MyDrive/audio-vocab-fsd50k/audio/`). A one-cell
Colab notebook converts the first 10 s of each clip (the embedded window) to mp3 and downloads `fsd50k_demo.zip`. Then:

```
../audio-vocab/.venv/Scripts/python scripts/import_fsd.py ~/Downloads/fsd50k_demo.zip
```

## Licences

ESC-50 is CC BY-NC; VocalSound, FSD50K and CREMA-D have their own licences (see `../audio-vocab/data/LICENCES.md`).
Podcast audio belongs to its publishers. Audio is served locally only; don't host it publicly.
