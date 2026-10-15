#!/usr/bin/env python3
"""Local static preview with the cross-origin isolation headers WebAssembly needs."""

from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

WASM_PIECES = {f".wasm{index}": "application/wasm" for index in range(10)}


class CoopCoepHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        **WASM_PIECES,
        ".wasm": "application/wasm",
        ".dll": "application/octet-stream",
        ".dat": "application/octet-stream",
    }

    def end_headers(self) -> None:
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        super().end_headers()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8031)
    parser.add_argument("--directory", default="dist")
    args = parser.parse_args()
    handler = partial(CoopCoepHandler, directory=args.directory)
    server = ThreadingHTTPServer(("0.0.0.0", args.port), handler)
    print(f"Serving static files from {args.directory} on http://localhost:{args.port}")
    print("No private archive or game-file endpoints are enabled.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
