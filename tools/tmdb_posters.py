r"""Download movie posters from TMDB into the movie folders, as poster.jpg.

Only movie folders whose name carries the TMDB id are processed (Jellyfin style):
  "Heat (1995) [tmdbid-949]"   (also {tmdb-949} and tmdbid=949)
Folders without an id are ignored. A poster that already exists is never replaced.
A folder with several videos gets <video name>.jpg per video instead (the widget needs that).

  python tools/tmdb_posters.py E:\                 dry run: lists what would be downloaded (no key, no network)
  python tools/tmdb_posters.py E:\ --apply         downloads (needs a TMDB key)

The key is read from the TMDB_API_KEY environment variable (or --key). Either a v3 API key (32 hex
characters) or a v4 read access token (starts with "eyJ") works; get one free at
https://www.themoviedb.org/settings/api. Posters are saved as 300x450 baseline JPEG when Pillow is
installed (pip install pillow), otherwise exactly as TMDB delivers them.
Uses only the Python standard library otherwise.
"""
import argparse
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

VIDEO = (".mp4", ".m4v", ".mkv", ".avi", ".mov", ".wmv", ".ts", ".mpg", ".mpeg")
IMAGE = (".jpg", ".jpeg", ".png")
POSTER_NAMES = ("poster", "folder", "cover")
MOVIE_DIR = "filma"
MAX_DEPTH = 4
API = "https://api.themoviedb.org/3"
IMG = "https://image.tmdb.org/t/p/"
W, H = 300, 450

ID_RE = re.compile(r"[\[\{(]\s*tmdb(?:id)?\s*[-=:]\s*(\d+)\s*[\]\})]|\btmdbid\s*=\s*(\d+)", re.I)
TAG_RE = re.compile(r"[\[\{(]\s*(?:tmdb|imdb|tvdb)(?:id)?\s*[-=:]\s*[a-z0-9]+\s*[\]\})]", re.I)
RIP_TAGS = re.compile(
    r"\b(2160p|1080p|1080i|720p|576p|480p|4k|uhd|hdr|bluray|blu-ray|brrip|bdrip|webrip|web-dl|webdl|dvdrip|"
    r"dvdscr|hdrip|hdtv|x264|x265|h264|h265|hevc|xvid|divx|aac|ac3|dts|remux|extended|unrated|proper|repack)\b", re.I)


def parse_id(text):
    m = ID_RE.search(text)
    return int(m.group(1) or m.group(2)) if m else None


def clean_title(name):
    """'The.Matrix.1999.1080p [tmdbid-603]' -> ('The Matrix', '1999'). Same rules as widget/js/usb.js."""
    s = TAG_RE.sub(" ", name)
    s = re.sub(r"[._]+", " ", s)
    s = re.sub(r"[\[\](){}]", " ", s)
    years = re.findall(r"\b(?:19|20)\d{2}\b", s)
    year, title = "", s
    if years:
        year = years[-1]
        idx = s.rfind(year)
        if s[:idx].strip():
            title = s[:idx]
        else:
            year = ""
    cut = RIP_TAGS.search(title)
    if cut and cut.start() > 0:
        title = title[:cut.start()]
    title = re.sub(r"\s+", " ", title).strip()
    return (title or name), year


def base(name):
    return os.path.splitext(name)[0]


class Movie:
    def __init__(self, folder, video, target, label, existing):
        self.folder = folder
        self.video = video
        self.target = target       # where the poster goes
        self.label = label         # name the title/id are read from
        self.existing = existing   # a poster is already there


def find_movie_dir(root):
    """The widget scans only a folder named Filma (up to 3 levels down); do the same when it exists."""
    level = [root]
    for _ in range(3):
        nxt = []
        for p in level:
            try:
                names = sorted(os.listdir(p))
            except OSError:
                continue
            for n in names:
                full = os.path.join(p, n)
                if os.path.isdir(full) and not n.startswith((".", "$")):
                    if n.lower() == MOVIE_DIR:
                        return full
                    nxt.append(full)
        level = nxt
    return None


def find_movies(root):
    movies = []

    def walk(path, depth, top):
        try:
            names = sorted(os.listdir(path))
        except OSError:
            return
        visible = [n for n in names if not n.startswith((".", "$"))]
        videos = [n for n in visible if n.lower().endswith(VIDEO) and os.path.isfile(os.path.join(path, n))]
        images = [n for n in visible if n.lower().endswith(IMAGE)]
        dirs = [n for n in visible if os.path.isdir(os.path.join(path, n))]
        if len(videos) == 1 and not top:
            v = videos[0]
            has = any(base(i).lower() in POSTER_NAMES or base(i).lower() == base(v).lower() for i in images)
            movies.append(Movie(path, v, os.path.join(path, "poster.jpg"), os.path.basename(path), has))
        else:
            for v in videos:
                has = any(base(i).lower() == base(v).lower() for i in images)
                movies.append(Movie(path, v, os.path.join(path, base(v) + ".jpg"), base(v), has))
        if (len(videos) != 1 or top) and depth < MAX_DEPTH:
            for d in dirs:
                walk(os.path.join(path, d), depth + 1, False)

    walk(root, 0, True)
    return movies


def movie_id(m):
    """The id in the movie folder's name, e.g. 'Heat (1995) [tmdbid-949]'."""
    return parse_id(os.path.basename(m.folder))


class Tmdb:
    def __init__(self, key, language="en-US", size="w342", pause=0.05):
        self.key = key
        self.language = language
        self.size = size
        self.pause = pause

    def _request(self, url, headers):
        req = urllib.request.Request(url, headers=dict(headers, **{"User-Agent": "MovieShelf-posters/1.0"}))
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    return r.read()
            except urllib.error.HTTPError as e:
                if e.code == 429 and attempt < 3:       # rate limited: wait as long as TMDB asks
                    time.sleep(float(e.headers.get("Retry-After", "2")) + 0.5)
                    continue
                raise
        raise RuntimeError("unreachable")

    def get_json(self, path, params=None):
        params = dict(params or {})
        headers = {"Accept": "application/json"}
        if len(self.key) > 40:                           # v4 read access token
            headers["Authorization"] = "Bearer " + self.key
        else:                                            # v3 API key
            params["api_key"] = self.key
        params["language"] = self.language
        time.sleep(self.pause)
        return json.loads(self._request(API + path + "?" + urllib.parse.urlencode(params), headers))

    def poster_path(self, tmdb_id):
        info = self.get_json("/movie/%d" % tmdb_id)
        return info.get("poster_path"), info.get("title") or "", (info.get("release_date") or "")[:4]

    def search(self, title, year=""):
        """Top search results for a title (and release year when given)."""
        params = {"query": title}
        if year:
            params["year"] = year
        return self.get_json("/search/movie", params).get("results") or []

    def image(self, poster_path):
        time.sleep(self.pause)
        return self._request(IMG + self.size + poster_path, {})


def to_jpeg(data):
    """300x450 baseline JPEG when Pillow is available (the TV is picky and short on memory)."""
    try:
        from PIL import Image, ImageOps
    except ImportError:
        return data, False
    with Image.open(io.BytesIO(data)) as im:
        out = ImageOps.fit(im.convert("RGB"), (W, H), Image.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, "JPEG", quality=85, optimize=True, progressive=False)
    return buf.getvalue(), True


def run(root, api, apply, out=print):
    """Only folders whose name carries a TMDB id are touched; the rest are ignored.
    A poster that is already there is never replaced. `api` may be None for a dry run."""
    stats = {"downloaded": 0, "skipped": 0, "ignored": 0, "no_poster": 0, "failed": 0, "shrunk": 0}
    for m in find_movies(root):
        tid = movie_id(m)
        if tid is None:
            stats["ignored"] += 1
            continue
        shown = "%s [tmdbid-%d]" % (clean_title(m.label)[0], tid)
        if m.existing:
            stats["skipped"] += 1
            continue
        if not apply:
            out("would download: %s -> %s" % (shown, m.target))
            continue
        try:
            path, tmdb_title, _ = api.poster_path(tid)
            if not path:
                stats["no_poster"] += 1
                out("no poster on TMDB: %s" % shown)
                continue
            data, shrunk = to_jpeg(api.image(path))
            with open(m.target, "wb") as f:
                f.write(data)
            stats["downloaded"] += 1
            stats["shrunk"] += 1 if shrunk else 0
            out("saved   %s  <- %s" % (m.target, tmdb_title))
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                out("TMDB rejected the key (HTTP %d). Check TMDB_API_KEY." % e.code)
                raise SystemExit(1)
            stats["failed"] += 1
            out("FAILED  %s: HTTP %d" % (shown, e.code))
        except (urllib.error.URLError, OSError, ValueError) as e:
            stats["failed"] += 1
            out("FAILED  %s: %s" % (shown, e))
    return stats


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("root", help="the drive or the Filma folder")
    ap.add_argument("--apply", action="store_true", help="download (default is a dry run without network)")
    ap.add_argument("--key", help="TMDB v3 key or v4 token (prefer the TMDB_API_KEY environment variable)")
    ap.add_argument("--size", default="w342", help="TMDB image size: w185, w342 (default), w500, original")
    ap.add_argument("--language", default="en-US", help="poster language, e.g. en-US or de-DE")
    args = ap.parse_args()

    root = args.root
    if not os.path.isdir(root):
        sys.exit("Not a folder: " + root)
    movie_dir = find_movie_dir(root)
    if movie_dir:
        root = movie_dir
    api = None
    if args.apply:
        key = args.key or os.environ.get("TMDB_API_KEY")
        if not key:
            sys.exit("Set the TMDB_API_KEY environment variable (or pass --key). Free key: https://www.themoviedb.org/settings/api")
        api = Tmdb(key.strip(), args.language, args.size)
    stats = run(root, api, args.apply)
    if args.apply:
        print("done: %(downloaded)d downloaded, %(skipped)d already had a poster, %(ignored)d ignored (no id), "
              "%(no_poster)d without poster on TMDB, %(failed)d failed" % stats)
        try:
            import PIL  # noqa: F401
        except ImportError:
            print("Pillow is not installed: posters were saved as delivered (342x513). pip install pillow to shrink them to 300x450.")
    else:
        print("Dry run. Add --apply to download.")


if __name__ == "__main__":
    main()
