"""Offline tests for tools/tmdb_posters.py (no network, no key). Run: python test/test_tmdb.py"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))
import tmdb_posters as t  # noqa: E402
import tmdb_tag as tag  # noqa: E402


class FakeApi:
    def __init__(self):
        self.asked = []

    def poster_path(self, tid):
        self.asked.append(tid)
        return ("/p%d.jpg" % tid if tid != 7 else None), "Title %d" % tid, "1999"

    def image(self, path):
        return b"JPEGDATA" + path.encode()


def slurp(path, mode="rb"):
    with open(path, mode) as f:
        return f.read()


def make(root, tree):
    for rel, content in tree.items():
        p = os.path.join(root, *rel.split("/"))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            f.write(content)


class ParseTests(unittest.TestCase):
    def test_ids(self):
        self.assertEqual(t.parse_id("Heat (1995) [tmdbid-949]"), 949)
        self.assertEqual(t.parse_id("Heat {tmdb-949}"), 949)
        self.assertEqual(t.parse_id("Heat tmdbid=949"), 949)
        self.assertEqual(t.parse_id("Heat (1995)"), None)
        self.assertEqual(t.parse_id("Heat [imdbid-tt0113277]"), None)

    def test_titles_strip_id_tags(self):
        self.assertEqual(t.clean_title("Heat (1995) [tmdbid-949]"), ("Heat", "1995"))
        self.assertEqual(t.clean_title("The.Matrix.1999.1080p.BluRay.x264"), ("The Matrix", "1999"))
        self.assertEqual(t.clean_title("Alien {tmdb-348} [imdbid-tt0078748]"), ("Alien", ""))
        self.assertEqual(t.clean_title("2012"), ("2012", ""))


class RunTests(unittest.TestCase):
    def setUp(self):
        self._to_jpeg = t.to_jpeg
        t.to_jpeg = lambda data: (data, False)    # the fake bytes are not an image; keep Pillow out of it
        self.addCleanup(setattr, t, "to_jpeg", self._to_jpeg)
        self.dir = tempfile.mkdtemp()
        make(self.dir, {
            "Filma/Heat (1995) [tmdbid-949]/heat.mp4": "",
            "Filma/Nopic [tmdbid-7]/n.mp4": "",
            "Filma/Has Poster [tmdbid-5]/h.mp4": "",
            "Filma/Has Poster [tmdbid-5]/poster.jpg": "old",
            "Filma/No Id (2001)/f.mp4": "",
            "Filma/File Id/x [tmdbid-3].mp4": "",
            "Filma/Nfo Film/n.mp4": "",
            "Filma/Nfo Film/movie.nfo": "<movie><tmdbid>321</tmdbid></movie>",
            "Other/Hidden Movie [tmdbid-1]/h.mp4": "",
        })
        self.root = t.find_movie_dir(self.dir)

    def poster(self, name):
        return os.path.join(self.dir, "Filma", name, "poster.jpg")

    def test_finds_filma_and_folder_ids_only(self):
        self.assertEqual(os.path.basename(self.root), "Filma")
        ids = {os.path.basename(m.folder): t.movie_id(m) for m in t.find_movies(self.root)}
        self.assertEqual(ids["Heat (1995) [tmdbid-949]"], 949)
        self.assertIsNone(ids["No Id (2001)"])
        self.assertIsNone(ids["File Id"])     # id only in a file name: ignored
        self.assertIsNone(ids["Nfo Film"])    # id only in an .nfo: ignored
        self.assertEqual(len(ids), 6)

    def test_dry_run_touches_nothing(self):
        lines = []
        stats = t.run(self.root, None, False, out=lines.append)
        self.assertEqual(stats["downloaded"], 0)
        self.assertTrue(any("would download: Heat [tmdbid-949]" in l for l in lines))
        self.assertFalse(os.path.exists(self.poster("Heat (1995) [tmdbid-949]")))

    def test_apply(self):
        api, lines = FakeApi(), []
        stats = t.run(self.root, api, True, out=lines.append)
        heat = self.poster("Heat (1995) [tmdbid-949]")
        self.assertTrue(slurp(heat).startswith(b"JPEGDATA/p949.jpg"))
        self.assertEqual(slurp(self.poster("Has Poster [tmdbid-5]"), "r"), "old")   # never replaced
        self.assertFalse(os.path.exists(self.poster("Nopic [tmdbid-7]")))           # none on TMDB
        self.assertFalse(os.path.exists(self.poster("No Id (2001)")))               # ignored
        self.assertEqual(sorted(api.asked), [7, 949])                               # nothing asked for the rest
        self.assertEqual((stats["downloaded"], stats["no_poster"], stats["skipped"], stats["ignored"]), (1, 1, 1, 3))
        self.assertFalse(any("No Id" in l for l in lines))                          # no noise for ignored ones


class TagApi:
    DB = {
        "Heat": [{"id": 949, "title": "Heat", "release_date": "1995-12-15"}, {"id": 2, "title": "Heat", "release_date": "1986-01-01"}],
        "Rope": [{"id": 12, "title": "Rope", "release_date": "1948-08-26"}],
        "Alien": [{"id": 348, "title": "Alien", "release_date": "1979-05-25"}, {"id": 8077, "title": "Alien 3", "release_date": "1992-05-22"}],
        "Vague": [{"id": 5, "title": "Vague One", "release_date": "2001-01-01"}],
    }

    def search(self, title, year=""):
        return self.DB.get(title, [])


class TagTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        make(self.dir, {
            "Filma/Heat (1995)/h.mp4": "",
            "Filma/Rope/r.mp4": "",                       # no year, one exact title
            "Filma/Alien/a.mp4": "",                      # no year, "Alien 3" is a different title
            "Filma/Vague (2001)/v.mp4": "",               # title differs: unsure
            "Filma/Nothing (1999)/n.mp4": "",             # not found: unsure
            "Filma/Done [tmdbid-1]/d.mp4": "",
            "Filma/Many/a.mp4": "", "Filma/Many/b.mp4": "",
        })
        self.root = t.find_movie_dir(self.dir)

    def names(self):
        return sorted(os.listdir(self.root))

    def test_dry_run_renames_nothing(self):
        before = self.names()
        s = tag.run(self.root, TagApi(), False, out=lambda l: None)
        self.assertEqual(self.names(), before)
        self.assertEqual((s["renamed"], s["has_id"], s["uncertain"]), (3, 1, 2))

    def test_apply_renames_only_certain_matches(self):
        s = tag.run(self.root, TagApi(), True, out=lambda l: None)
        n = self.names()
        self.assertIn("Heat (1995) [tmdbid-949]", n)
        self.assertIn("Rope [tmdbid-12]", n)
        self.assertIn("Alien [tmdbid-348]", n)
        self.assertIn("Vague (2001)", n)
        self.assertIn("Nothing (1999)", n)
        self.assertIn("Done [tmdbid-1]", n)
        self.assertIn("Many", n)
        self.assertEqual(s["renamed"], 3)


if __name__ == "__main__":
    unittest.main(verbosity=1)
