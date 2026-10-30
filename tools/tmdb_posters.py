r"""Download posters, backdrops and details from TMDB into the movie folders.

Only movie folders whose name carries the TMDB id are processed (Jellyfin style):
  "Heat (1995) [tmdbid-949]"   (also {tmdb-949} and tmdbid=949)
Folders without an id are ignored. Files that already exist are never replaced, except a details file
written by an older version of this script (without director and cast), which is refreshed once.

Per movie, in the movie's folder, named the way Jellyfin names them:
  poster.jpg            the poster
  backdrop.jpg          a 16:9 backdrop picture, used as the shelf and info-screen background
  <video>.tmdb.json     title, year, rating, runtime, genres, director, writers, cast, countries, plot
                        (shown with INFO on the TV; one from an older version is refreshed once)
A folder holding several videos names the pictures after each video instead: <video>.jpg and
<video>.backdrop.jpg. Jellyfin's own fanart.jpg and background.jpg count as an existing backdrop, and a
<video>.backdrop.jpg from an earlier version is renamed to backdrop.jpg.

  python tools/tmdb_posters.py E:\                 dry run: lists what would be downloaded (no key, no network)
  python tools/tmdb_posters.py E:\ --apply         downloads (needs a TMDB key)
  python tools/tmdb_posters.py E:\ --apply --posters-only

The key is read from the TMDB_API_KEY environment variable (or --key). Either a v3 API key (32 hex
characters) or a v4 read access token (starts with "eyJ") works; get one free at
https://www.themoviedb.org/settings/api. Images are shrunk (poster 300x450, backdrop 640x360,
baseline JPEG) when Pillow is installed (pip install pillow), otherwise saved as TMDB delivers them.
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
POSTER_SIZE = (300, 450)
BACKDROP_SIZE = (640, 360)
MAX_OVERVIEW = 1200

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


DETAILS_FORMAT = 2     # 1: title, rating...; 2: adds directors, writers, cast, countries
WRITER_JOBS = ("Screenplay", "Writer", "Story")


def details_current(path):
    """True when the details file exists in the current format. An older one counts as missing, so the
    next run refreshes it once (the file is ours; nobody edits it by hand)."""
    try:
        with open(path, encoding="utf-8") as f:
            return int(json.load(f).get("format", 1)) >= DETAILS_FORMAT
    except (OSError, ValueError, AttributeError, TypeError):
        return False


BACKDROP_NAMES = ("backdrop", "fanart", "background")       # what Jellyfin calls the backdrop picture


class Movie:
    """One movie. `single`: it is the only video in its folder, so its pictures get Jellyfin's plain names
    (poster.jpg, backdrop.jpg); otherwise they are named after the video."""

    def __init__(self, folder, video, target, poster_exists, single=True):
        self.folder = folder
        self.video = video
        self.single = single
        self.target = target                                   # where the poster goes
        stem = os.path.join(folder, base(video))
        self.legacy_backdrop = stem + ".backdrop.jpg"          # the name earlier versions used
        self.backdrop_target = os.path.join(folder, "backdrop.jpg") if single else self.legacy_backdrop
        self.info_target = stem + ".tmdb.json"
        self.poster_exists = poster_exists
        self.legacy_exists = os.path.isfile(self.legacy_backdrop)
        self.backdrop_exists = self.legacy_exists if not single else any(
            os.path.isfile(os.path.join(folder, n + ext)) for n in BACKDROP_NAMES for ext in (".jpg", ".jpeg", ".png", ".JPG"))
        self.info_exists = details_current(self.info_target)


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
            movies.append(Movie(path, v, os.path.join(path, "poster.jpg"), has))
        else:
            for v in videos:
                has = any(base(i).lower() == base(v).lower() for i in images)
                movies.append(Movie(path, v, os.path.join(path, base(v) + ".jpg"), has, single=False))
        if (len(videos) != 1 or top) and depth < MAX_DEPTH:
            for d in dirs:
                walk(os.path.join(path, d), depth + 1, False)

    walk(root, 0, True)
    return movies


def movie_id(m):
    """The id in the movie folder's name, e.g. 'Heat (1995) [tmdbid-949]'."""
    return parse_id(os.path.basename(m.folder))


class Tmdb:
    def __init__(self, key, language="en-US", size="w342", backdrop_size="w780", pause=0.05):
        self.key = key
        self.language = language
        self.size = size
        self.backdrop_size = backdrop_size
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

    def movie(self, tmdb_id):
        """Everything the scripts need about a movie, in one request (the credits ride along)."""
        return self.get_json("/movie/%d" % tmdb_id, {"append_to_response": "credits"})

    def search(self, title, year=""):
        """Top search results for a title (and release year when given)."""
        params = {"query": title}
        if year:
            params["year"] = year
        return self.get_json("/search/movie", params).get("results") or []

    def image(self, image_path, kind="poster"):
        time.sleep(self.pause)
        size = self.backdrop_size if kind == "backdrop" else self.size
        return self._request(IMG + size + image_path, {})


def to_jpeg(data, size=POSTER_SIZE):
    """Baseline JPEG of the given size when Pillow is available (the TV is picky and short on memory)."""
    try:
        from PIL import Image, ImageOps
    except ImportError:
        return data, False
    with Image.open(io.BytesIO(data)) as im:
        out = ImageOps.fit(im.convert("RGB"), size, Image.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, "JPEG", quality=85, optimize=True, progressive=False)
    return buf.getvalue(), True


def names(people, limit):
    """The first `limit` different names."""
    out = []
    for p in people:
        n = (p.get("name") or "").strip()
        if n and n not in out:
            out.append(n)
        if len(out) >= limit:
            break
    return out


def make_details(info):
    """The small JSON the widget shows. ASCII-only (\\uXXXX escapes): the TV may misread other charsets."""
    overview = (info.get("overview") or "").strip()
    if len(overview) > MAX_OVERVIEW:
        overview = overview[:MAX_OVERVIEW].rsplit(" ", 1)[0] + "..."
    credits = info.get("credits") or {}
    crew = credits.get("crew") or []
    cast = sorted(credits.get("cast") or [], key=lambda p: p.get("order", 999))
    details = {
        "id": info.get("id"),
        "title": info.get("title") or "",
        "year": (info.get("release_date") or "")[:4],
        "tagline": (info.get("tagline") or "").strip(),
        "rating": round(float(info.get("vote_average") or 0), 1),
        "runtime": int(info.get("runtime") or 0),
        "genres": [g.get("name") for g in info.get("genres") or [] if g.get("name")],
        "directors": names([p for p in crew if p.get("job") == "Director"], 3),
        "writers": names([p for p in crew if p.get("job") in WRITER_JOBS], 3),
        "cast": names(cast, 8),
        "countries": [c.get("name") for c in info.get("production_countries") or [] if c.get("name")][:3],
        "overview": overview,
        "format": DETAILS_FORMAT,
    }
    return json.dumps(details, ensure_ascii=True, indent=1)


def run(root, api, apply, extras=True, out=print):
    """Only folders whose name carries a TMDB id are touched; the rest are ignored. Existing files are
    never replaced. `api` may be None for a dry run. Returns a dict of counters."""
    stats = {"downloaded": 0, "backdrops": 0, "details": 0, "skipped": 0, "ignored": 0,
             "no_poster": 0, "failed": 0, "shrunk": 0, "migrated": 0}
    for m in find_movies(root):
        tid = movie_id(m)
        if tid is None:
            stats["ignored"] += 1
            continue
        shown = "%s [tmdbid-%d]" % (clean_title(os.path.basename(m.folder))[0], tid)
        if m.single and m.legacy_exists and not m.backdrop_exists:     # an earlier version's name: move it to Jellyfin's
            if apply:
                try:
                    os.rename(m.legacy_backdrop, m.backdrop_target)
                    stats["migrated"] += 1
                    out("renamed %s -> backdrop.jpg" % os.path.basename(m.legacy_backdrop))
                    m.backdrop_exists = True
                except OSError as e:
                    out("FAILED  %s: %s" % (shown, e))
            else:
                out("would rename %s -> backdrop.jpg in %s" % (os.path.basename(m.legacy_backdrop), m.folder))
                m.backdrop_exists = True
        need = []
        if not m.poster_exists:
            need.append("poster")
        if extras and not m.backdrop_exists:
            need.append("backdrop")
        if extras and not m.info_exists:
            need.append("details")
        if not need:
            stats["skipped"] += 1
            continue
        if not apply:
            out("would download: %s (%s) -> %s" % (shown, ", ".join(need), m.folder))
            continue
        try:
            info = api.movie(tid)
            if "poster" in need:
                if info.get("poster_path"):
                    data, shrunk = to_jpeg(api.image(info["poster_path"]))
                    with open(m.target, "wb") as f:
                        f.write(data)
                    stats["downloaded"] += 1
                    stats["shrunk"] += 1 if shrunk else 0
                    out("saved   %s  <- %s" % (m.target, info.get("title") or shown))
                else:
                    stats["no_poster"] += 1
                    out("no poster on TMDB: %s" % shown)
            if "backdrop" in need and info.get("backdrop_path"):
                data, _ = to_jpeg(api.image(info["backdrop_path"], "backdrop"), BACKDROP_SIZE)
                with open(m.backdrop_target, "wb") as f:
                    f.write(data)
                stats["backdrops"] += 1
                out("saved   %s" % m.backdrop_target)
            if "details" in need:
                with open(m.info_target, "w", encoding="ascii") as f:
                    f.write(make_details(info))
                stats["details"] += 1
                out("saved   %s" % m.info_target)
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
    ap.add_argument("--posters-only", action="store_true", help="skip the backdrops and the details files")
    ap.add_argument("--key", help="TMDB v3 key or v4 token (prefer the TMDB_API_KEY environment variable)")
    ap.add_argument("--size", default="w342", help="TMDB poster size: w185, w342 (default), w500, original")
    ap.add_argument("--language", default="en-US", help="language of the details, e.g. en-US or de-DE")
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
    stats = run(root, api, args.apply, extras=not args.posters_only)
    if args.apply:
        print("done: %(downloaded)d posters, %(backdrops)d backdrops, %(details)d details files; %(skipped)d movies already complete, "
              "%(migrated)d backdrops renamed, %(ignored)d ignored (no id), %(no_poster)d without poster on TMDB, %(failed)d failed" % stats)
        try:
            import PIL  # noqa: F401
        except ImportError:
            print("Pillow is not installed: images were saved as delivered. pip install pillow to shrink them for the TV.")
    else:
        print("Dry run. Add --apply to download.")


if __name__ == "__main__":
    main()
