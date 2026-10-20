#!/usr/bin/env python3
import argparse
import json
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent
PHOTO_PATH = re.compile(r"/photos/([\w-]+\.jpg)")


def build_handler(session):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(session), **kwargs)

        def do_GET(self):
            if self.path in ("/", "/index.html"):
                return self.reply(200, "text/html; charset=utf-8", (SKILL_DIR / "presenter.html").read_bytes())
            if self.path == "/board.json" and not (session / "board.json").exists():
                return self.reply(200, "application/json", b"{}")
            super().do_GET()

        def do_PUT(self):
            if self.path != "/board.json":
                return self.reply(404)
            body = self.body()
            try:
                json.loads(body)
            except ValueError:
                return self.reply(400)
            (session / "board.json").write_bytes(body)
            self.reply(204)

        def do_POST(self):
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
    print(f"http://localhost:{args.port}/  ({session})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), build_handler(session)).serve_forever()


if __name__ == "__main__":
    main()
