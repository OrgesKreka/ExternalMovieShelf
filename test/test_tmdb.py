"""Offline tests for tools/tmdb_posters.py (no network, no key). Run: python test/test_tmdb.py"""
import json
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
        self.images = []

    def movie(self, tid):
        self.asked.append(tid)
        return {"id": tid, "title": "Title %d é" % tid, "release_date": "1999-03-31", "vote_average": 8.2345,
                "runtime": 136, "genres": [{"name": "Action"}, {"name": "Sci-Fi"}], "overview": "Plot of %d." % tid,
                "poster_path": "/p%d.jpg" % tid if tid != 7 else None, "backdrop_path": "/b%d.jpg" % tid,
                "production_countries": [{"name": "United States of America"}, {"name": "Germany"}],
                "credits": {
                    "cast": [{"name": "Third Actor", "order": 2}, {"name": "First Actor", "order": 0}, {"name": "Second Actor", "order": 1}],
                    "crew": [{"name": "Some Producer", "job": "Producer"}, {"name": "Main Director", "job": "Director"},
                             {"name": "Co Director", "job": "Director"}, {"name": "Screen Writer", "job": "Screenplay"},
                             {"name": "Screen Writer", "job": "Writer"}, {"name": "Story Teller", "job": "Story"}]}}

    def image(self, path, kind="poster"):
        self.images.append((kind, path))
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
        t.to_jpeg = lambda data, size=None: (data, False)    # the fake bytes are not an image; keep Pillow out of it
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
        self.assertEqual(sorted(api.asked), [5, 7, 949])                            # one request per folder with an id
        self.assertEqual((stats["downloaded"], stats["no_poster"], stats["ignored"]), (1, 1, 3))
        self.assertFalse(any("No Id" in l for l in lines))                          # no noise for ignored ones

    def test_backdrop_and_details(self):
        api = FakeApi()
        stats = t.run(self.root, api, True, out=lambda l: None)
        folder = os.path.join(self.dir, "Filma", "Heat (1995) [tmdbid-949]")
        self.assertTrue(slurp(os.path.join(folder, "backdrop.jpg")).startswith(b"JPEGDATA/b949.jpg"))
        self.assertIn(("backdrop", "/b949.jpg"), api.images)
        raw = slurp(os.path.join(folder, "heat.tmdb.json"), "r")
        raw.encode("ascii")                                                         # ASCII-only file
        info = json.loads(raw)
        self.assertEqual((info["id"], info["year"], info["rating"], info["runtime"]), (949, "1999", 8.2, 136))
        self.assertEqual(info["genres"], ["Action", "Sci-Fi"])
        self.assertEqual(info["directors"], ["Main Director", "Co Director"])
        self.assertEqual(info["writers"], ["Screen Writer", "Story Teller"])          # no duplicates, producers left out
        self.assertEqual(info["cast"], ["First Actor", "Second Actor", "Third Actor"])   # in billing order
        self.assertEqual(info["countries"], ["United States of America", "Germany"])
        self.assertEqual(info["format"], t.DETAILS_FORMAT)
        self.assertEqual(info["title"], "Title 949 é")                      # escaped in the file, decoded by JSON
        self.assertIn("\\u00e9", raw)
        # the folder that already had a poster still gets its missing backdrop and details
        self.assertTrue(os.path.isfile(os.path.join(self.dir, "Filma", "Has Poster [tmdbid-5]", "backdrop.jpg")))
        self.assertEqual(slurp(self.poster("Has Poster [tmdbid-5]"), "r"), "old")
        self.assertEqual((stats["backdrops"], stats["details"]), (3, 3))

    def test_jellyfin_backdrop_names_count_as_existing(self):
        make(self.dir, {"Filma/Fan [tmdbid-8]/f.mp4": "", "Filma/Fan [tmdbid-8]/fanart.jpg": "x", "Filma/Fan [tmdbid-8]/poster.jpg": "p",
                        "Filma/Fan [tmdbid-8]/f.tmdb.json": '{"format": 2}'})
        api = FakeApi()
        t.run(self.root, api, True, out=lambda l: None)
        self.assertNotIn(8, api.asked)                              # complete: poster, fanart.jpg as backdrop, details
        self.assertFalse(os.path.exists(os.path.join(self.dir, "Filma", "Fan [tmdbid-8]", "backdrop.jpg")))

    def test_old_backdrop_name_is_moved_to_the_jellyfin_name(self):
        folder = os.path.join(self.dir, "Filma", "Old [tmdbid-9]")
        make(self.dir, {"Filma/Old [tmdbid-9]/o.mp4": "", "Filma/Old [tmdbid-9]/poster.jpg": "p",
                        "Filma/Old [tmdbid-9]/o.backdrop.jpg": "old", "Filma/Old [tmdbid-9]/o.tmdb.json": '{"format": 2}'})
        lines = []
        t.run(self.root, None, False, out=lines.append)             # dry run: announces it, changes nothing
        self.assertTrue(any("would rename o.backdrop.jpg" in l for l in lines))
        self.assertTrue(os.path.exists(os.path.join(folder, "o.backdrop.jpg")))
        api = FakeApi()
        stats = t.run(self.root, api, True, out=lambda l: None)
        self.assertEqual(slurp(os.path.join(folder, "backdrop.jpg"), "r"), "old")   # same file, new name
        self.assertFalse(os.path.exists(os.path.join(folder, "o.backdrop.jpg")))
        self.assertNotIn(9, api.asked)                              # nothing left to download for it
        self.assertEqual(stats["migrated"], 1)

    def test_several_videos_keep_names_after_the_video(self):
        make(self.dir, {"Filma/Pair [tmdbid-6]/a.mp4": "", "Filma/Pair [tmdbid-6]/b.mp4": ""})
        t.run(self.root, FakeApi(), True, out=lambda l: None)
        folder = os.path.join(self.dir, "Filma", "Pair [tmdbid-6]")
        self.assertTrue(os.path.isfile(os.path.join(folder, "a.backdrop.jpg")))
        self.assertTrue(os.path.isfile(os.path.join(folder, "b.backdrop.jpg")))
        self.assertTrue(os.path.isfile(os.path.join(folder, "a.jpg")))
        self.assertFalse(os.path.exists(os.path.join(folder, "backdrop.jpg")))

    def test_details_from_an_older_version_are_refreshed_once(self):
        folder = os.path.join(self.dir, "Filma", "Older [tmdbid-11]")
        make(self.dir, {"Filma/Older [tmdbid-11]/o.mp4": "", "Filma/Older [tmdbid-11]/poster.jpg": "p",
                        "Filma/Older [tmdbid-11]/backdrop.jpg": "b", "Filma/Older [tmdbid-11]/o.tmdb.json": '{"title": "Old"}'})
        lines = []
        t.run(self.root, None, False, out=lines.append)
        self.assertTrue(any("Older" in l and "details" in l for l in lines))
        api = FakeApi()
        stats = t.run(self.root, api, True, out=lambda l: None)
        self.assertIn(11, api.asked)
        self.assertEqual(json.loads(slurp(os.path.join(folder, "o.tmdb.json"), "r"))["format"], t.DETAILS_FORMAT)
        self.assertEqual(slurp(os.path.join(folder, "poster.jpg"), "r"), "p")      # only the details were redone
        api2 = FakeApi()
        t.run(self.root, api2, True, out=lambda l: None)
        self.assertNotIn(11, api2.asked)                                           # now current: left alone

    def test_a_broken_details_file_is_rewritten(self):
        make(self.dir, {"Filma/Broken [tmdbid-12]/b.mp4": "", "Filma/Broken [tmdbid-12]/poster.jpg": "p",
                        "Filma/Broken [tmdbid-12]/backdrop.jpg": "b", "Filma/Broken [tmdbid-12]/b.tmdb.json": "not json"})
        api = FakeApi()
        t.run(self.root, api, True, out=lambda l: None)
        self.assertIn(12, api.asked)

    def test_the_credits_are_asked_for_in_the_same_request(self):
        captured = {}

        class Probe(t.Tmdb):
            def get_json(self, path, params=None):
                captured.update(path=path, params=params)
                return {}

        Probe("k").movie(949)
        self.assertEqual(captured["path"], "/movie/949")
        self.assertEqual(captured["params"], {"append_to_response": "credits"})

    def test_second_run_downloads_nothing(self):
        t.run(self.root, FakeApi(), True, out=lambda l: None)
        api = FakeApi()
        stats = t.run(self.root, api, True, out=lambda l: None)
        self.assertEqual(api.asked, [7])        # Nopic has no poster on TMDB, so it is asked again; the rest is complete
        self.assertEqual(stats["downloaded"] + stats["backdrops"] + stats["details"], 0)

    def test_posters_only(self):
        api = FakeApi()
        t.run(self.root, api, True, extras=False, out=lambda l: None)
        folder = os.path.join(self.dir, "Filma", "Heat (1995) [tmdbid-949]")
        self.assertTrue(os.path.isfile(os.path.join(folder, "poster.jpg")))
        self.assertFalse(os.path.exists(os.path.join(folder, "backdrop.jpg")))
        self.assertFalse(os.path.exists(os.path.join(folder, "heat.tmdb.json")))
        self.assertEqual(sorted(api.asked), [7, 949])      # Has Poster is already complete in this mode


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

    def test_undo_restores_names_and_removes_the_log(self):
        before = self.names()
        tag.run(self.root, TagApi(), True, out=lambda l: None)
        log = os.path.join(self.root, ".tmdb_renames.log")
        self.assertTrue(os.path.isfile(log))
        s = tag.undo(self.root, False, out=lambda l: None)           # dry run: nothing changes
        self.assertEqual(s["restored"], 3)
        self.assertIn("Rope [tmdbid-12]", self.names())
        s = tag.undo(self.root, True, out=lambda l: None)
        self.assertEqual((s["restored"], s["skipped"]), (3, 0))
        self.assertEqual(self.names(), before)
        self.assertFalse(os.path.exists(log))

    def test_undo_skips_when_the_old_name_is_taken_and_keeps_the_log(self):
        tag.run(self.root, TagApi(), True, out=lambda l: None)
        os.makedirs(os.path.join(self.root, "Rope"))                  # someone made a folder with the old name
        s = tag.undo(self.root, True, out=lambda l: None)
        self.assertEqual((s["restored"], s["skipped"]), (2, 1))
        self.assertIn("Rope [tmdbid-12]", self.names())
        self.assertTrue(os.path.isfile(os.path.join(self.root, ".tmdb_renames.log")))

    def test_undo_without_a_log(self):
        lines = []
        self.assertEqual(tag.undo(self.root, True, out=lines.append), {"restored": 0, "skipped": 0})
        self.assertTrue(any("Nothing to undo" in l for l in lines))


if __name__ == "__main__":
    unittest.main(verbosity=1)
