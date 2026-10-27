"""Shrink movie posters to 300x450 baseline JPEG named poster.jpg (the TV has little memory).

    python tools/posters.py E:\\            dry run, shows what would change
    python tools/posters.py E:\\ --apply    write poster.jpg

Needs Pillow:  pip install pillow
An existing poster.jpg that gets replaced is first copied to poster.orig.bak.
"""
import argparse
import os
import shutil
import sys

from PIL import Image, ImageOps

VIDEO = (".mp4", ".m4v", ".mkv", ".avi", ".mov", ".wmv", ".ts", ".mpg", ".mpeg")
IMAGE = (".jpg", ".jpeg", ".png")
W, H = 300, 450


def base(name):
    return os.path.splitext(name)[0].lower()


def pick(images, video):
    for i in sorted(images):
        if base(i) == base(video):
            return i
    for pref in ("poster", "folder", "cover"):
        for i in sorted(images):
            if base(i) == pref:
                return i
    return sorted(images)[0] if images else None


def process(folder, files, apply):
    videos = [f for f in files if f.lower().endswith(VIDEO)]
    images = [f for f in files if f.lower().endswith(IMAGE)]
    if len(videos) != 1 or not images:
        return
    src_name = pick(images, videos[0])
    src = os.path.join(folder, src_name)
    dst = os.path.join(folder, "poster.jpg")
    with Image.open(src) as im:
        done = (src_name == "poster.jpg" and im.size == (W, H) and im.format == "JPEG"
                and not im.info.get("progressive"))
        if done:
            return
        print("%s %s (%dx%d) -> poster.jpg" % ("write" if apply else "would write", src, im.size[0], im.size[1]))
        if not apply:
            return
        out = ImageOps.fit(im.convert("RGB"), (W, H), Image.LANCZOS)
    if os.path.exists(dst):
        shutil.copyfile(dst, os.path.join(folder, "poster.orig.bak"))
    out.save(dst, "JPEG", quality=85, optimize=True, progressive=False)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("root", help="drive or folder with one folder per movie")
    ap.add_argument("--apply", action="store_true", help="actually write files (default is a dry run)")
    args = ap.parse_args()
    if not os.path.isdir(args.root):
        sys.exit("Not a folder: " + args.root)
    for folder, dirs, files in os.walk(args.root):
        dirs[:] = [d for d in dirs if not d.startswith((".", "$"))]
        process(folder, files, args.apply)
    if not args.apply:
        print("Dry run. Add --apply to write.")


if __name__ == "__main__":
    main()
