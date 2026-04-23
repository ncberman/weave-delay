#!/usr/bin/env python3
import argparse
import http.server
import urllib.error
import urllib.request


UPSTREAM_BASE = "https://www.warcraftlogs.com/"
API_PREFIX = "/api/wcl/"
JSON_CONTENT_TYPE = "application/json"


class LocalHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith(API_PREFIX):
            self.handle_wcl_proxy()
            return
        super().do_GET()

    def handle_wcl_proxy(self):
        upstream_path = self.path[len(API_PREFIX):]
        if not upstream_path:
            self.send_error(400, "Missing upstream path")
            return

        upstream_url = UPSTREAM_BASE + upstream_path
        headers = {
            "Accept": JSON_CONTENT_TYPE,
        }
        auth_header = self.headers.get("Authorization")
        if auth_header:
            headers["Authorization"] = auth_header

        request = urllib.request.Request(upstream_url, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read()
                content_type = response.headers.get("Content-Type", JSON_CONTENT_TYPE)
                self.send_response(response.status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except urllib.error.HTTPError as error:
            body = error.read()
            content_type = error.headers.get("Content-Type", JSON_CONTENT_TYPE)
            self.send_response(error.code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if body:
                self.wfile.write(body)
        except Exception as error:  # pragma: no cover - defensive fallback
            self.send_error(502, f"Proxy failure: {error}")


def main():
    parser = argparse.ArgumentParser(description="Serve local files and proxy Warcraft Logs API requests.")
    parser.add_argument("--host", default="127.0.0.1", help="Host interface to bind")
    parser.add_argument("--port", type=int, default=5500, help="Port to listen on")
    args = parser.parse_args()

    server = http.server.ThreadingHTTPServer((args.host, args.port), LocalHandler)
    print(f"Serving on http://{args.host}:{args.port}")
    print(f"Proxying {API_PREFIX}* -> {UPSTREAM_BASE}*")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
