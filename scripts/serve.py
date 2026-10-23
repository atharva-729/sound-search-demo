"""Local server for the demo: the page, audio cut on demand, and typed searches embedded with CLAP or Gemma.

    ../audio-vocab/.venv/Scripts/python scripts/serve.py      # then open http://127.0.0.1:8770/
"""
import json
import subprocess
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE.parent / "audio-vocab" / "src"))

import numpy as np
import pandas as pd

from audiovocab import embed

PORT = 8770
ITEMS = pd.read_parquet(HERE / "data" / "items.parquet")
EMB = {m: np.load(HERE / "data" / f"{m}.npy") for m in ("clap", "gemma")}
MODELS, LOCK = {}, threading.Lock()


def model(name):
    with LOCK:
        if name not in MODELS:
            MODELS[name] = embed.load("clap") if name == "clap" else embed.load("gemma", text_only=True)
        return MODELS[name]


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(HERE / "docs"), **kw)

    def _send(self, body, ctype, code=200):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store" if ctype.startswith("application/json") else "max-age=3600")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path.startswith("/audio/"):
            return self._audio(int(u.path.rsplit("/", 1)[-1]))
        if u.path == "/search":
            q = parse_qs(u.query)
            text, m = q.get("q", [""])[0].strip(), q.get("model", ["clap"])[0]
            if not text or m not in EMB:
                return self._send(b'{"error":"bad query"}', "application/json", 400)
            v = model(m).text([text])[0]
            s = EMB[m] @ v
            return self._send(json.dumps({"scores": np.round(s, 4).tolist()}).encode(), "application/json")
        return super().do_GET()

    def _audio(self, i):
        if not 0 <= i < len(ITEMS) or not Path(ITEMS.file[i]).exists():
            return self._send(b"audio not available", "text/plain", 404)
        r = ITEMS.iloc[i]
        mp3 = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-ss", str(r.start), "-i", r.file, "-t", str(r.dur),
                              "-ac", "1", "-b:a", "96k", "-f", "mp3", "-"], capture_output=True).stdout
        self._send(mp3, "audio/mpeg") if mp3 else self._send(b"decode failed", "text/plain", 500)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    threading.Thread(target=lambda: [model("clap"), model("gemma")], daemon=True).start()
    print(f"http://127.0.0.1:{PORT}/", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
