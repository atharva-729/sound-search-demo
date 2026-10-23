# Sound Search: hand-off bundle

A finished demo: search ~12,500 audio clips by how they sound (podcasts, voices, music, sound effects). The user's
goal is to **run it and present it**, not to change it. Read `START HERE.txt` for the demo script.

## Getting it running (do this, in order)

1. **Quick check, no setup:** open `web/index.html` in Chrome or Edge. Everything works except typing a custom search.
   If the user only needs that, stop here.
2. **Full version (adds typed search):**
   - Windows: run `start.bat` (from Explorer, or `cmd /c start.bat` in this folder).
   - Mac/Linux: `chmod +x start.command && ./start.command`.
   - The first run creates `search/.venv` with Python 3.12 and the packages in `search/requirements.txt`
     (~1 GB download, 5–10 min). It then serves `web/` at http://127.0.0.1:8770/ and opens the browser.
     Typed search works once the console prints "Models ready" (~30 s after start).
3. Share on the local network: `start.bat --lan` (or `./start.command --lan`); it prints the address for others.

## If something fails

- **Package or Python download fails behind a corporate proxy:** `UV_NATIVE_TLS=1` is already set (uses the system
  certificate store). If it still fails, try `HTTPS_PROXY`, or fall back to step 1: the demo works without typed search.
- **Port 8770 in use:** change `PORT` at the top of `search/server.py`.
- **Mac without `uv`:** `start.command` installs it from astral.sh; or `brew install uv`.
- **Linux:** `pip install torch` from PyPI pulls CUDA builds (large). Use
  `uv pip install --index-url https://download.pytorch.org/whl/cpu torch==2.14.1 torchvision==0.29.1` first.
- **Don't** rebuild data, retrain or re-embed anything: the embeddings (`search/*/*.npy`), the page data
  (`web/data_*.js`) and the clips (`web/clips/`) are final. Models are in `search/models/` and load offline.

## Layout

- `web/`: the page (`index.html`, `app.js`, `data_real.js`, `data_sounds.js`) and every clip as an mp3 (`clips/<map>/<i>.mp3`).
- `search/`: `server.py` (static files + `/search?map=&model=clap|gemma&q=`), the clip embeddings per map, the CLAP
  and EmbeddingGemma 2 text encoders, `requirements.txt`, and `uv.exe` (Windows).

The audio comes from podcasts and research datasets with their own licences: internal demo use only, don't publish
the clips.
