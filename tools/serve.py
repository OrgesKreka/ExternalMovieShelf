"""Zip widget/, write widgetlist.xml, and serve both on port 80 for Samsung App Sync.
The TV can also POST its on-screen log (BLUE) to /log; it is saved under tools/_logs/.

Run from anywhere:  python tools/serve.py
Port 80 may need an elevated terminal on Windows; allow it through the firewall on private networks.
"""
import http.server
import os
import re
import socket
import socketserver
import sys
import time
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WIDGET = os.path.join(ROOT, "widget")
SITE = os.path.join(ROOT, "tools", "_site")
NAME = "MovieShelf"
WIDGET_ID = NAME  # set in main(): stamped per start so the TV never reuses a cached install
PORT = 80
LOGS = os.path.join(ROOT, "tools", "_logs")   # logs sent from the TV (BLUE key)
MAX_LOG_BYTES = 512 * 1024


def widget_version():
    with open(os.path.join(WIDGET, "config.xml"), encoding="utf-8") as f:
        m = re.search(r"<ver[^>]*>([^<]+)</ver>", f.read())
    return m.group(1).strip() if m else "0"


def zip_name():
    """Version and stamp in the file name, so each GET line in the log shows which build the TV fetched."""
    return WIDGET_ID.replace(NAME, "%s_v%s" % (NAME, widget_version()), 1) + ".zip"


def local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def build(ip):
    os.makedirs(SITE, exist_ok=True)
    for old in os.listdir(SITE):
        os.remove(os.path.join(SITE, old))
    zip_path = os.path.join(SITE, zip_name())
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for folder, _, files in os.walk(WIDGET):
            for f in files:
                full = os.path.join(folder, f)
                rel = os.path.relpath(full, WIDGET).replace(os.sep, "/")
                z.write(full, rel)
        # Where the widget sends its log (BLUE). Written per build because the PC's address is not known earlier.
        z.writestr("js/build.js", 'var BUILD = { logUrl: "http://%s:%d/log" };\n' % (ip, PORT))
    size = os.path.getsize(zip_path)
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rsp stat="ok"><list>\n'
        '<widget id="%s">\n'
        '<title>%s</title>\n'
        '<compression size="%d" type="zip"/>\n'
        '<description>Poster shelf for movies on a USB drive</description>\n'
        '<download>http://%s/%s</download>\n'
        '</widget>\n'
        '</list></rsp>\n' % (WIDGET_ID, WIDGET_ID, size, ip, zip_name())
    )
    with open(os.path.join(SITE, "widgetlist.xml"), "w", encoding="utf-8") as f:
        f.write(xml)
    return size


class Server(socketserver.ThreadingTCPServer):
    daemon_threads = True
    # On Windows SO_REUSEADDR lets a second server bind the same port while an old one keeps answering,
    # so the TV could silently get a stale zip. Take the port exclusively there.
    allow_reuse_address = os.name != "nt"

    def server_bind(self):
        if os.name == "nt":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class Handler(http.server.SimpleHTTPRequestHandler):
    # Orsay's App Sync is picky about content types (same as the Jellyfin Orsay installer).
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
    extensions_map.update({".xml": "text/xml; charset=utf-8", ".zip": "application/zip"})

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=SITE, **kwargs)

    def _reply(self, code, text="", content_type="text/plain; charset=utf-8"):
        body = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin", "*")      # the widget's page is not served from here
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body and self.command != "HEAD":
            self.wfile.write(body)

    def do_OPTIONS(self):
        self._reply(204)

    def do_POST(self):
        """The widget's on-screen log (BLUE on the TV) arrives here and is saved under tools/_logs/."""
        if self.path.split("?")[0] != "/log":
            self._reply(404, "not found")
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = -1
        if size < 0 or size > MAX_LOG_BYTES:
            self._reply(413, "log too large")
            return
        text = self.rfile.read(size).decode("utf-8", errors="replace")
        os.makedirs(LOGS, exist_ok=True)
        path = os.path.join(LOGS, "tv-%s.log" % time.strftime("%Y%m%d-%H%M%S"))
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        print("--- TV log from %s: %d lines, saved to %s ---" % (self.client_address[0], text.count("\n") + 1, path))
        print(text)
        self._reply(200, "ok")


def main():
    global WIDGET_ID
    args = sys.argv[1:]
    if "--stable-id" not in args:
        WIDGET_ID = NAME + "_" + time.strftime("%Y%m%d%H%M%S")
    ip = local_ip()
    size = build(ip)
    print("Movie Shelf v%s" % widget_version())
    print("Built %s (%d bytes), widget id %s" % (zip_name(), size, WIDGET_ID))
    print("PC IP: %s   (enter this in the TV under IP Setting)" % ip)
    print("Serving on port %d. Rebuilt on every start; restart after code changes." % PORT)
    try:
        with Server(("", PORT), Handler) as httpd:
            httpd.serve_forever()
    except PermissionError:
        sys.exit("Port %d needs elevated rights. Run the terminal as administrator." % PORT)
    except OSError as e:
        sys.exit("Cannot use port %d (%s). Is another serve.py still running? Stop it first." % (PORT, e))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
