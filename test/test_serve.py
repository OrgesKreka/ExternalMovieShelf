"""Tests for tools/serve.py: the log endpoint the TV posts to (BLUE) and the address written into each build.
Run: python test/test_serve.py"""
import contextlib
import http.client
import io
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))
import serve  # noqa: E402


class LogEndpoint(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.saved = (serve.LOGS, serve.SITE)
        serve.LOGS = os.path.join(self.tmp, "logs")
        serve.SITE = os.path.join(self.tmp, "site")
        os.makedirs(serve.SITE)
        self.httpd = serve.Server(("127.0.0.1", 0), serve.Handler)
        self.url = "http://127.0.0.1:%d" % self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        serve.LOGS, serve.SITE = self.saved

    def post(self, path, data, headers=None):
        req = urllib.request.Request(self.url + path, data=data, method="POST", headers=headers or {"Content-Type": "text/plain"})
        with contextlib.redirect_stdout(io.StringIO()):
            return urllib.request.urlopen(req, timeout=5)

    def saved_logs(self):
        return sorted(os.listdir(serve.LOGS)) if os.path.isdir(serve.LOGS) else []

    def test_a_log_is_saved_and_acknowledged(self):
        r = self.post("/log", "00:01 Movie Shelf 0.2.2 starting\n00:02 café".encode("utf-8"))
        self.assertEqual(r.status, 200)
        self.assertEqual(r.headers["Access-Control-Allow-Origin"], "*")
        names = self.saved_logs()
        self.assertEqual(len(names), 1)
        self.assertTrue(names[0].startswith("tv-") and names[0].endswith(".log"))
        with open(os.path.join(serve.LOGS, names[0]), encoding="utf-8") as f:
            self.assertEqual(f.read(), "00:01 Movie Shelf 0.2.2 starting\n00:02 café")

    def test_bad_utf8_does_not_break_it(self):
        self.assertEqual(self.post("/log", b"ok \xff\xfe bytes").status, 200)

    def test_other_paths_are_refused(self):
        with self.assertRaises(urllib.error.HTTPError) as cm:
            self.post("/elsewhere", b"x")
        self.assertEqual(cm.exception.code, 404)
        self.assertEqual(self.saved_logs(), [])

    def test_a_huge_log_is_refused_before_it_is_read(self):
        # Only the header announces the size; the body is never sent, so the refusal cannot be a read error.
        conn = http.client.HTTPConnection("127.0.0.1", self.httpd.server_address[1], timeout=5)
        conn.putrequest("POST", "/log")
        conn.putheader("Content-Length", str(serve.MAX_LOG_BYTES + 1))
        conn.endheaders()
        self.assertEqual(conn.getresponse().status, 413)
        conn.close()
        self.assertEqual(self.saved_logs(), [])

    def test_the_preflight_request_is_answered(self):
        req = urllib.request.Request(self.url + "/log", method="OPTIONS")
        with urllib.request.urlopen(req, timeout=5) as r:
            self.assertEqual(r.status, 204)
            self.assertEqual(r.headers["Access-Control-Allow-Origin"], "*")


class BuildAddress(unittest.TestCase):
    def test_the_zip_tells_the_widget_where_to_send_its_log(self):
        tmp = tempfile.mkdtemp()
        saved = serve.SITE
        serve.SITE = tmp
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                serve.build("192.168.2.156")
            with zipfile.ZipFile(os.path.join(tmp, serve.zip_name())) as z:
                names = z.namelist()
                self.assertIn("index.html", names)
                build = z.read("js/build.js").decode("ascii")
        finally:
            serve.SITE = saved
        self.assertEqual(build, 'var BUILD = { logUrl: "http://192.168.2.156:%d/log" };\n' % serve.PORT)

    def test_the_page_loads_build_js_before_the_log(self):
        with open(os.path.join(serve.WIDGET, "index.html"), encoding="utf-8") as f:
            html = f.read()
        self.assertLess(html.index("js/build.js"), html.index("js/log.js"))


if __name__ == "__main__":
    unittest.main(verbosity=1)
