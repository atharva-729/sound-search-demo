"""Sound Search, hand-off version: serves ../web and answers typed searches with the CLAP and Gemma text encoders.
Started by start.bat / start.command. Add --lan to let others on the same network open it."""
import json
import os
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import numpy as np
import torch

HERE = Path(__file__).resolve().parent
WEB = HERE.parent / "web"
PORT = 8770
EMB = {m: {k: np.load(HERE / m / f"{k}.npy") for k in ("clap", "gemma")} for m in ("real", "sounds")}
MODELS, LOCK = {}, threading.Lock()


def l2(x):
    x = np.asarray(x, dtype=np.float32)
    return x / np.linalg.norm(x, axis=-1, keepdims=True).clip(1e-12)


class Clap:
    def __init__(self):
        from transformers import ClapModel, ClapProcessor
        p = HERE / "models" / "laion--clap-htsat-unfused"
        self.m, self.p = ClapModel.from_pretrained(p).eval(), ClapProcessor.from_pretrained(p)

    @torch.inference_mode()
    def text(self, t):
        out = self.m.get_text_features(**self.p(text=[t], return_tensors="pt", padding=True))
        return l2((out.pooler_output if hasattr(out, "pooler_output") else out).numpy())[0]


class Gemma:
    def __init__(self):
        from sentence_transformers import SentenceTransformer
        # float32 on CPU (bf16 is ~12x slower, fp16 gives NaNs); text-only
        self.m = SentenceTransformer(str(HERE / "models" / "google--embeddinggemma-2"), device="cpu",
                                     config_kwargs={"vision_config": None, "audio_config": None},
                                     model_kwargs={"dtype": torch.float32})

    def text(self, t):
        return l2(self.m.encode([t], prompt_name="SearchQuery"))[0]


def model(name):
    with LOCK:
        if name not in MODELS:
            MODELS[name] = Clap() if name == "clap" else Gemma()
        return MODELS[name]


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(WEB), **kw)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path != "/search":
            return super().do_GET()
        q = parse_qs(u.query)
        text, m, mp = q.get("q", [""])[0].strip(), q.get("model", ["clap"])[0], q.get("map", ["real"])[0]
        if not text or mp not in EMB or m not in EMB[mp]:
            body, code = b'{"error":"bad query"}', 400
        else:
            body, code = json.dumps({"scores": np.round(EMB[mp][m] @ model(m).text(text), 4).tolist()}).encode(), 200
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    host = "0.0.0.0" if "--lan" in sys.argv else "127.0.0.1"
    srv = ThreadingHTTPServer((host, PORT), H)
    print(f"\n  Sound Search is running:  http://127.0.0.1:{PORT}/")
    if host == "0.0.0.0":
        import socket
        print(f"  Others on this network:   http://{socket.gethostbyname(socket.gethostname())}:{PORT}/")
    print("  Loading the two search models in the background (about 30 s)... keep this window open.\n")
    threading.Thread(target=lambda: (model("clap"), model("gemma"), print("  Models ready: typed search is live.\n")),
                     daemon=True).start()
    webbrowser.open(f"http://127.0.0.1:{PORT}/")
    srv.serve_forever()
