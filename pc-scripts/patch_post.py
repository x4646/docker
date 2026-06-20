# -*- coding: utf-8 -*-
import io

FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    lines = f.read().split("\n")

NEW_METHOD = """
    def do_POST(self):
        from urllib.parse import urlparse, unquote
        import json
        parsed = urlparse(self.path)
        path   = unquote(parsed.path)
        length = int(self.headers.get('Content-Length', 0))
        body   = json.loads(self.rfile.read(length)) if length else {}

        if path == '/scan':
            result = handle_scan_and_process(body)
            self._json(result)
        else:
            self._json({"error": "unknown path"}, 404)

    def _json(self, data, code=200):
        import json
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)
"""

changed = False
for i, l in enumerate(lines):
    if "def start_http_server" in l:
        lines.insert(i, NEW_METHOD)
        changed = True
        break

with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(lines))
print("OK" if changed else "NOT FOUND")
