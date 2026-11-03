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

The local server runs typed search and plays every clip, podcasts included. The public page
(https://atharva-729.github.io/sound-search-demo/) has the ready-made searches and "sounds like this", and plays every clip:
podcasts straight from the publishers' servers, the rest from GitHub Releases. It has no typed search. Add `?hosted` to the local URL to see the public version.

## Two maps

- **Real audio** (`?map=real`, the default): podcasts, voices (CREMA-D moods + FSD50K speech, whispers, shouts) and music
  (FMA, MTG-Jamendo, Musopen). The layout follows Gemma, which hears how people talk.
- **Sound effects** (`?map=sounds`): VocalSound, ESC-50, the rest of FSD50K and Xeno-canto birds, all labelled. The layout follows CLAP.

The model toggle defaults to **Auto** (averages standardised CLAP and Gemma scores for typed searches); each chip uses
the model that scored better for it in the build log.

## Rebuild

```
../podcast-vibe-search/.venv/Scripts/python scripts/embed_podcasts_clap.py   # once, ~20 min, resumable
../audio-vocab/.venv/Scripts/python scripts/build.py real                    # ~2 min each
../audio-vocab/.venv/Scripts/python scripts/build.py sounds
../audio-vocab/.venv/Scripts/python scripts/build.py real --drop podcasts    # leave a collection out
```

Ready-made searches live in `scripts/chips.py`. Restart the server after a rebuild, then refresh the credits and the
public page's audio (both follow the clip order in `data/<map>/items.parquet`):

```
../audio-vocab/.venv/Scripts/python scripts/credits.py       # docs/credits_<map>.js + credits/clips_<map>.csv, seconds
../audio-vocab/.venv/Scripts/python scripts/pack_audio.py    # dist/audio/*.webm + docs/audio_<map>.js, ~15 min
``` The single-map version is git tag
`v1-single-map`.

## FSD50K audio (from Colab)

FSD50K's embeddings are in `../audio-vocab/fsd50k_colab.npz`, but its audio isn't on this laptop (Zenodo is blocked).
The earlier Colab run left the extracted clips in Google Drive (`MyDrive/audio-vocab-fsd50k/audio/`). A one-cell
Colab notebook converts the first 10 s of each clip (the embedded window) to mp3 and downloads `fsd50k_demo.zip`. Then:

```
../audio-vocab/.venv/Scripts/python scripts/import_fsd.py ~/Downloads/fsd50k_demo.zip
```

## Audio on the public page (GitHub Releases)

`scripts/pack_audio.py` joins each dataset's clips into ~30-minute Opus files (`dist/audio/`, ~300 MB in all, 70 files),
with 5 s of silence around every clip so a seek a second or two off still plays the right one. `docs/audio_<map>.js`
records where each clip sits; the page seeks there and stops at the clip's end. Podcasts aren't packed: the page
streams each clip from the episode's URL in the publisher's feed (`podcast-vibe-search/data/episodes.parquet`), so
inserted ads can shift a clip by a few seconds, and an episode the publisher takes down stops playing.

To publish, on GitHub: **Releases → Draft a new release**, tag `audio-v1`, drag in every `dist/audio/*.webm`, publish.
The page reads them from `https://github.com/atharva-729/sound-search-demo/releases/download/audio-v1/`. If you re-pack,
replace the changed files in that release (same names) and push the new `docs/audio_<map>.js`.

GitHub sends these files without CORS headers, so the page plays them through a plain `<audio>` element and skips Web
Audio there (the visualiser animates instead of following the sound). Seeking needs HTTP range requests, which GitHub
supports.

## Licences

Code: [MIT](LICENSE). Audio: every clip keeps its own licence, much of it non-commercial; see [credits/](credits/)
for each dataset's citation and a per-clip list. The page shows the credit of the clip that's playing.
Podcast audio belongs to its publishers and isn't copied: the public page streams it from their servers.
