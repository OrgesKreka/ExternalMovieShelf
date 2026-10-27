r"""Add the TMDB id to movie folders that do not have one: "Heat (1995)" -> "Heat (1995) [tmdbid-949]".

The title and year are read from the folder name and looked up on TMDB. A folder is renamed only
when the match is certain: the title is identical (ignoring case and punctuation) and the year
agrees. Anything less certain is listed with the candidates and left alone, so you can add the id
by hand (the id is the number in themoviedb.org/movie/<id>-title). Folders that already have an id,
and folders holding several videos, are not touched.

  python tools/tmdb_tag.py E:\                  dry run: shows the renames (needs the key, changes nothing)
  python tools/tmdb_tag.py E:\ --apply          rename the folders
  python tools/tmdb_tag.py E:\ --undo           dry run of the undo: shows what would be renamed back
  python tools/tmdb_tag.py E:\ --undo --apply   rename them back

Every applied rename is appended to a hidden log, .tmdb_renames.log, inside the movie folder (Filma).
--undo reads that log, puts the old names back, newest rename first, and then removes the log.

The key comes from the TMDB_API_KEY environment variable (or --key), like tmdb_posters.py.
Run tmdb_posters.py afterwards to download the posters.
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error

import tmdb_posters as tp


def norm(s):
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def year_of(result):
    return (result.get("release_date") or "")[:4]


def choose(results, title, year):
    """(result, why). result is None when nothing is certain."""
    same = [r for r in results if norm(title) in (norm(r.get("title") or ""), norm(r.get("original_title") or ""))]
    if year:
        hit = [r for r in same if year_of(r) == year]
        if hit:
            return hit[0], ""
        return None, "no exact title with year %s" % year
    if len(same) == 1:
        return same[0], ""
    return None, "no year in the name and %d titles match" % len(same)


def candidates(results):
    return ", ".join("%s (%s) id %d" % (r.get("title"), year_of(r), r["id"]) for r in results[:3]) or "nothing found"


LOG_NAME = ".tmdb_renames.log"


def log_path(root):
    return os.path.join(root, LOG_NAME)


def rel(root, path):
    return os.path.relpath(path, root).replace(os.sep, "/")


def run(root, api, apply, out=print):
    stats = {"renamed": 0, "has_id": 0, "uncertain": 0, "failed": 0, "skipped": 0}
    for m in tp.find_movies(root):
        if os.path.basename(m.target) != "poster.jpg":        # several videos in one folder: not one movie
            stats["skipped"] += 1
            continue
        name = os.path.basename(m.folder)
        if tp.parse_id(name):
            stats["has_id"] += 1
            continue
        title, year = tp.clean_title(name)
        try:
            results = api.search(title, year)
            hit, why = choose(results, title, year)
            if hit is None and year:                          # the year in the name may be off: results are still listed
                results = results or api.search(title)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                out("TMDB rejected the key (HTTP %d). Check TMDB_API_KEY." % e.code)
                raise SystemExit(1)
            stats["failed"] += 1
            out("FAILED  %s: HTTP %d" % (name, e.code))
            continue
        except (urllib.error.URLError, ValueError) as e:
            stats["failed"] += 1
            out("FAILED  %s: %s" % (name, e))
            continue
        if hit is None:
            stats["uncertain"] += 1
            out("unsure  %s: %s. Candidates: %s" % (name, why or "nothing found", candidates(results)))
            continue
        new = os.path.join(os.path.dirname(m.folder), "%s [tmdbid-%d]" % (name, hit["id"]))
        label = "%s -> %s  (%s, %s)" % (name, os.path.basename(new), hit.get("title"), year_of(hit))
        if os.path.exists(new):
            stats["failed"] += 1
            out("FAILED  %s: target exists" % label)
        elif not apply:
            stats["renamed"] += 1
            out("would rename  " + label)
        else:
            try:
                os.rename(m.folder, new)
                with open(log_path(root), "a", encoding="utf-8") as f:
                    f.write(json.dumps({"time": time.strftime("%Y-%m-%d %H:%M:%S"), "old": rel(root, m.folder), "new": rel(root, new)}) + "\n")
                stats["renamed"] += 1
                out("renamed  " + label)
            except OSError as e:
                stats["failed"] += 1
                out("FAILED  %s: %s" % (label, e))
    return stats


def undo(root, apply, out=print):
    """Puts back the folder names recorded in the log, newest first. Returns {'restored','skipped'}."""
    stats = {"restored": 0, "skipped": 0}
    path = log_path(root)
    if not os.path.isfile(path):
        out("Nothing to undo: no %s in %s" % (LOG_NAME, root))
        return stats
    with open(path, encoding="utf-8") as f:
        entries = [json.loads(line) for line in f if line.strip()]
    for e in reversed(entries):
        old, new = os.path.join(root, *e["old"].split("/")), os.path.join(root, *e["new"].split("/"))
        label = "%s -> %s" % (e["new"], e["old"])
        if not os.path.isdir(new):
            stats["skipped"] += 1
            out("skipped  %s: the renamed folder is gone" % label)
        elif os.path.exists(old):
            stats["skipped"] += 1
            out("skipped  %s: the old name is taken" % label)
        elif not apply:
            stats["restored"] += 1
            out("would restore  " + label)
        else:
            try:
                os.rename(new, old)
                stats["restored"] += 1
                out("restored  " + label)
            except OSError as ex:
                stats["skipped"] += 1
                out("FAILED  %s: %s" % (label, ex))
    if apply and not stats["skipped"]:
        os.remove(path)
    elif apply:
        out("The log is kept because some entries were skipped.")
    return stats


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("root", help="the drive or the Filma folder")
    ap.add_argument("--apply", action="store_true", help="rename the folders (default only shows what would change)")
    ap.add_argument("--undo", action="store_true", help="put back the names recorded in the log (with --apply; otherwise a dry run)")
    ap.add_argument("--key", help="TMDB v3 key or v4 token (prefer the TMDB_API_KEY environment variable)")
    ap.add_argument("--language", default="en-US", help="search language, e.g. en-US or de-DE")
    args = ap.parse_args()
    if not os.path.isdir(args.root):
        sys.exit("Not a folder: " + args.root)
    if args.undo:
        s = undo(tp.find_movie_dir(args.root) or args.root, args.apply)
        print("%d %s, %d skipped" % (s["restored"], "restored" if args.apply else "to restore", s["skipped"]))
        if not args.apply:
            print("Dry run. Add --apply to rename them back.")
        return
    key = args.key or os.environ.get("TMDB_API_KEY")
    if not key:
        sys.exit("Set the TMDB_API_KEY environment variable (or pass --key). Free key: https://www.themoviedb.org/settings/api")
    root = tp.find_movie_dir(args.root) or args.root
    s = run(root, tp.Tmdb(key.strip(), args.language), args.apply)
    verb = "renamed" if args.apply else "to rename"
    print("%d %s, %d already had an id, %d unsure (left alone), %d failed" % (s["renamed"], verb, s["has_id"], s["uncertain"], s["failed"]))
    if not args.apply:
        print("Dry run. Add --apply to rename.")


if __name__ == "__main__":
    main()
