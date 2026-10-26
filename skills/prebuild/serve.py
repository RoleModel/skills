#!/usr/bin/env python3
import argparse
import json
import re
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

SKILL_DIR = Path(__file__).resolve().parent
WRITE_LOCK = threading.Lock()
PHOTO_PATH = re.compile(r"/photos/([\w-]+\.jpg)")
BOARD_PATH = re.compile(r"/whiteboards/([\w-]+(?:\.seed)?\.excalidraw)")
SKILL_SCRIPTS = {"/diagrams.js", "/whiteboard.js"}
MAX_BOARD_BYTES = 5_000_000


def build_handler(session, port):
    hosts = {f"localhost:{port}", f"127.0.0.1:{port}"}
    origins = {f"http://{host}" for host in hosts}

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(session), **kwargs)

        def refused(self, writing=False):
            # Loopback binding alone doesn't stop DNS rebinding or a foreign page posting here.
            origin = self.headers.get("Origin")
            if self.headers.get("Host") not in hosts or (writing and origin is not None and origin not in origins):
                self.reply(403)
                return True
            return False

        def do_HEAD(self):
            if self.refused():
                return
            super().do_HEAD()

        def do_GET(self):
            if self.refused():
                return
            self.path = urlsplit(self.path).path
            if self.path in ("/", "/index.html"):
                return self.reply(200, "text/html; charset=utf-8", (SKILL_DIR / "presenter.html").read_bytes())
            if self.path in SKILL_SCRIPTS:
                return self.reply(200, "text/javascript; charset=utf-8", (SKILL_DIR / self.path[1:]).read_bytes())
            if self.path == "/board.json" and not (session / "board.json").exists():
                return self.reply(200, "application/json", b"{}")
            super().do_GET()

        def do_PUT(self):
            if self.refused(writing=True):
                return
            if self.path != "/board.json":
                return self.reply(404)
            body = self.body()
            try:
                incoming = json.loads(body)
            except ValueError:
                return self.reply(400)
            with WRITE_LOCK:
                current = session / "board.json"
                if current.exists():
                    stored_rev = json.loads(current.read_bytes() or b"{}").get("rev", 0)
                    # A slower, older save must never overwrite a newer one.
                    if incoming.get("rev", 0) <= stored_rev:
                        return self.reply(409)
                current.write_bytes(body)
            self.reply(204)

        def do_POST(self):
            if self.refused(writing=True):
                return
            board = BOARD_PATH.fullmatch(self.path)
            if board:
                body = self.body()
                if len(body) > MAX_BOARD_BYTES:
                    return self.reply(413)
                try:
                    json.loads(body)
                except ValueError:
                    return self.reply(400)
                (session / "whiteboards" / board.group(1)).write_bytes(body)
                return self.reply(204)
            match = PHOTO_PATH.fullmatch(self.path)
            if not match:
                return self.reply(404)
            (session / "photos" / match.group(1)).write_bytes(self.body())
            self.reply(204)

        def body(self):
            return self.rfile.read(int(self.headers.get("Content-Length", 0)))

        def reply(self, code, content_type=None, payload=b""):
            self.send_response(code)
            if content_type:
                self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def log_message(self, *args):
            pass

    return Handler


def main():
    parser = argparse.ArgumentParser(description="Serve a prebuild session: deck.json in, board.json and photos/ out.")
    parser.add_argument("session_dir")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    session = Path(args.session_dir).expanduser().resolve()
    (session / "photos").mkdir(parents=True, exist_ok=True)
    (session / "whiteboards").mkdir(exist_ok=True)
    print(f"http://localhost:{args.port}/  ({session})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), build_handler(session, args.port)).serve_forever()


if __name__ == "__main__":
    main()
