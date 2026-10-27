# Movie Shelf

A poster browser for movies on a USB drive, as a widget for Samsung 2013 F-series TVs (Orsay Smart Hub; developed on a UE46F6500). No extra device needed: the built-in player ignores `folder.jpg` and cover art, this widget shows a poster grid and plays the movie full screen.

**Status: v0.2.0.** Browsing, posters, playback with a transport bar, resume, and SRT subtitles have been tried on a UE46F6500. Orsay APIs are poorly documented, so expect differences on other models.

## Layout

```
widget/              the Orsay widget (config.xml, index.html, css/, fonts/, icon/, js/)
  js/main.js         grid, focus, scanning states, key handling, calibration screen
  js/usb.js          find the USB mount, walk folders, pick posters/subtitles, clean titles, sort
  js/player.js       playback, transport bar, resume, subtitles clock
  js/subs.js         SRT parser and loader
  js/info.js         reads the <video>.tmdb.json details file (plot, rating...) for the INFO screen
  js/store.js        resume positions (FileSystem common file MovieShelf/resume.json)
  js/log.js          on-screen log (Blue key)
tools/serve.py       zips widget/, writes widgetlist.xml, serves on port 80 for App Sync
tools/posters.py     shrinks posters to 300x450 poster.jpg (dry run unless --apply; needs Pillow)
tools/tmdb_posters.py downloads posters, backdrops and details from TMDB by id (see Tools)
tools/tmdb_tag.py    adds [tmdbid-N] to folders that lack it (TMDB search, only certain matches; has --undo)
tools/make_icons.py  regenerates widget/icon/*.png (no dependencies)
test/scan.test.js    node: scanning, titles, sorting, subtitles, backdrops/details, SRT parser, version match, ASCII-only scripts
test/info.test.js    node: the details file parser and formatting
test/player.test.js  node: playback logic against a fake TV plugin (shape, keys, resume rules, errors)
test/test_tmdb.py    python: offline tests for both TMDB scripts (fake API)
.github/workflows/   runs all of the above on every push
```

## Install on the TV

1. PC: `python tools/serve.py` (port 80, may need an administrator terminal; prints the PC's IP and the version).
2. TV: MENU > Smart Features > Samsung Account > Log in, ID `develop`.
3. SMART HUB > More Apps > Options > IP Setting > the PC's IP.
4. Options > Start App Sync. Open the **newest** Movie Shelf entry.

Every start of `serve.py` stamps a new widget id (`MovieShelf_<time>`), because the TV keeps a cached copy of an id it already knows. Delete old entries from More Apps now and then. `--stable-id` keeps the plain id. Restart `serve.py` after every code change. The version shows next to the title; it comes from `<ver>` in `widget/config.xml` and `VERSION` in `js/main.js` (keep them equal).

## Folder rules

- The drive needs a folder named **`Filma`** (searched up to 3 levels down, any capitalisation); only that folder is scanned. Without it the shelf says so.
- Up to 4 levels deep inside it; hidden/system folders are skipped.
- A folder with exactly one video is one movie, titled by the folder name.
- A folder with several videos gives one entry per video.
- Poster: same base name as the video, then `poster.*`, `folder.*`, `cover.*`, then any `.jpg`/`.png`.
- Subtitles: a `.srt` with the video's name (or `Name.xx.srt`); in a one-movie folder any single `.srt`.
- Details and backdrop (both optional, written by `tools/tmdb_posters.py`): `<video name>.tmdb.json` and `<video name>.backdrop.jpg` next to the video. A backdrop is never used as a poster.
- Titles: Jellyfin/Plex id tags such as `[tmdbid-949]` are hidden, dots/underscores become spaces, the last 19xx/20xx year is split out, rip tags (1080p, BluRay, x264...) are cut.
- Sorted by the title as shown (A-Z, accents folded, numbers by value; "The ..." sorts under T).
- No drive: the shelf keeps looking every few seconds. Missing `Filma` or no movies: a message, then GREEN rescans.

## Tools

All scripts live in `tools/`, run from the project folder, and need Python 3. Only `posters.py` and (optionally) `tmdb_posters.py` use Pillow (`pip install pillow`).

### serve.py: install the widget on the TV

```
python tools/serve.py                 build the widget zip and serve it on port 80
python tools/serve.py --stable-id     keep the plain widget id instead of stamping a new one
```

Zips `widget/`, writes `widgetlist.xml` and serves both for the TV's App Sync (see "Install on the TV"). It rebuilds on every start, so restart it after each code change. It prints the PC's IP (enter it on the TV under IP Setting) and the version. Port 80 may need an administrator terminal. Only one copy can run at a time; a second one says the port is in use.

### tmdb_tag.py: add the TMDB id to folder names

```
python tools/tmdb_tag.py E:\                  dry run: shows the renames, changes nothing
python tools/tmdb_tag.py E:\ --apply          rename the folders
python tools/tmdb_tag.py E:\ --undo           dry run of the undo
python tools/tmdb_tag.py E:\ --undo --apply   put the old names back
```

Every applied rename is written to a hidden log, `.tmdb_renames.log`, inside the `Filma` folder. `--undo` reads it, renames the folders back (newest first) and then deletes the log. An entry is skipped, and the log kept, if the renamed folder is gone or the old name is already taken.

For every movie folder without an id, it takes the title and year from the folder name, searches TMDB, and renames `Heat (1995)` to `Heat (1995) [tmdbid-949]`. It renames only when the match is certain: identical title (ignoring case and punctuation) and the same year, or, with no year in the name, exactly one identical title. Anything else is printed as `unsure` with up to three candidates and left alone; add those ids by hand (the id is the number in `themoviedb.org/movie/949-heat`). Folders that already have an id, and folders with several videos, are skipped. Needs the TMDB key (below). The dry run also calls TMDB, since it needs the search results.

### tmdb_posters.py: download posters, backdrops and details

```
python tools/tmdb_posters.py E:\                         dry run: lists what it would download (no key, no network)
python tools/tmdb_posters.py E:\ --apply                 download
python tools/tmdb_posters.py E:\ --apply --posters-only  only the posters, as before
```

For every movie folder whose **folder name carries the TMDB id**, Jellyfin style (`Heat (1995) [tmdbid-949]`, also `{tmdb-949}`), it fetches the movie once from TMDB and saves up to three files next to the video:

| File | What | Used for |
|---|---|---|
| `poster.jpg` (several videos in a folder: `<video name>.jpg`) | poster, 300x450 | the tiles |
| `<video name>.backdrop.jpg` | backdrop picture, 640x360 | the shelf background and the INFO screen |
| `<video name>.tmdb.json` | title, year, tagline, rating, runtime, genres, plot (ASCII-only JSON) | the INFO screen |

Folders without an id are ignored silently (the summary counts them). A file that already exists is never replaced, and each file is checked on its own: a folder that has a poster but no backdrop gets just the backdrop, and a run over a finished drive downloads nothing. Delete a file to fetch it again. Other options: `--size` (TMDB poster size, default `w342`) and `--language` (default `en-US`, also the language of the plot). With Pillow the images are shrunk to the sizes above as baseline JPEG, which suits the TV; without it they are saved as TMDB delivers them (poster 342x513, backdrop 780x439).

Typical order: `tmdb_tag.py` (rename), then `tmdb_posters.py` (download).

**TMDB key.** Both TMDB scripts read it from the `TMDB_API_KEY` environment variable, or `--key`. Get a free key at https://www.themoviedb.org/settings/api; the v3 API key and the long v4 read access token (starts with `eyJ`) both work. Set it permanently with `setx TMDB_API_KEY "your_key"` (new terminals only), or for one PowerShell window with `$env:TMDB_API_KEY = "your_key"`. It is never written to disk; keep it out of the repository. The network parts have only been tested against a fake API, not TMDB itself.

### posters.py: shrink existing posters

```
python tools/posters.py E:\             dry run
python tools/posters.py E:\ --apply     write poster.jpg
```

For posters you already have: converts each movie folder's poster to a 300x450 baseline `poster.jpg` (the TV has little memory and rejects some JPEG types). A `poster.jpg` that gets replaced is first copied to `poster.orig.bak`. Needs Pillow.

### make_icons.py: regenerate the app icons

`python tools/make_icons.py` rewrites `widget/icon/icon_*.png` (the four Smart Hub sizes). No dependencies; edit the colors at the top of the script to restyle.

## Keys

| Where | Key | Action |
|---|---|---|
| Shelf | arrows | move (Left/Right wrap to the next row) |
| Shelf | Enter / Play | play |
| Shelf | Info | details screen: poster, plot, rating, runtime, genres on the movie's backdrop |
| Details | Left / Right | previous / next movie |
| Details | Enter / Play | play |
| Details | Return / Info | back to the shelf |
| Shelf | Yellow | jump to the next letter |
| Shelf | Green | rescan |
| Shelf | Blue | toggle the log |
| Shelf | Red | calibration screen (shows what the TV really displays) |
| Shelf | Return | exit |
| Playing | Enter / Play / Pause | pause / resume |
| Playing | Left, Right / RW, FF | jump 30 s |
| Playing | Down, then Left/Right, Enter | select and press a transport button |
| Playing | Yellow | subtitles on/off |
| Playing | Green | picture shape: Auto / 16:9 / 4:3 / 1.85:1 / 2.35:1 (remembered per movie) |
| Playing | Red | restart |
| Playing | Return / Stop | back to the shelf (saves the position if past 60 s) |

## Known limitations

Scanning
- A folder with exactly one video is treated as one movie and its subfolders are not scanned, so a folder holding a movie plus other movie folders loses the nested ones.
- Extra videos next to a movie (for example `sample.mp4` or a trailer) count as a second video, so the folder is listed per file instead of as one movie.
- Only the `Filma` folder is scanned. Without it the shelf shows a message; there is no fallback to the whole drive.
- Video types: mp4, m4v, mkv, avi, mov, wmv, ts, mpg, mpeg. Whether a file plays still depends on what the TV's decoder supports.
- Unplugging the drive while browsing is not noticed; press GREEN to rescan.

Playback and subtitles
- Only `.srt` subtitles are read (no `.sub`, `.ass`, `.vtt`). Files are decoded as UTF-8, else Windows-1252; other encodings (UTF-16, Windows-1250 letters such as s-cedilla) can show wrong characters.
- Subtitles are drawn by the widget, not by the TV, and follow the player's 1 s time callback smoothed to about 0.2 s, so they can drift by a fraction of a second. There is no subtitle sync adjustment and no choice between several subtitle files.
- The bundled subtitle font covers Western European letters only.
- The picture is fitted to the video's pixel size (checked on a UE46F6500 with a 4:3 movie and a 2.79:1 one: same shape as the TV's own player; the Green key overrides it by hand). Videos with non-square pixels (some DVD rips) report a size that differs from their true shape, so they may look slightly stretched; the TV's own player corrects for that.
- Audio codecs the TV cannot decode (for example some AC3/DTS tracks in MP4) play without sound; the widget cannot work around that.
- The widget cannot hand a file to the TV's built-in media player, so the controls are the widget's own.

Platform
- Developed and tried on one TV (UE46F6500). Other Orsay models may report different screen sizes, lack the Storage/Audio plugin calls used here, or reject the install.
- Resume positions are saved only when you leave past 60 s and more than 60 s remain, and are kept in a file on the TV, not on the drive.
- The TV keeps a cached copy per widget id, so each `serve.py` start installs a new entry; old entries must be deleted by hand.
- The INFO screen, the backdrop pictures and the INFO key work on the UE46F6500 (v0.2.0). Other models may not deliver the INFO key to widgets; see Troubleshooting.
- The details text is cut at about 700 characters, and the plot is in the language chosen with `--language` when it was downloaded.
- The poster backdrop color needs canvas access to the poster file; where the TV blocks it, a color from the title is used instead.

## Lessons from the TV

- Widgets are laid out in a **960x540** space. `window.innerWidth` reports whatever `config.xml` declares, so it is logged but not trusted.
- The TV's installer rejects pages that contain undocumented API names as plain text (`GetUSB...`); `usb.js` builds those names at runtime.
- `readDir` returns folders as `name/` and includes `./` and `../`.
- Script files must be ASCII-only (use `\uXXXX`), the TV may decode them with the wrong charset; the test enforces this.
- Avoid `opacity` on many absolutely positioned elements and separate full-screen backdrop layers; they misstack on this browser.
- The TV caches widgets by id, hence the stamped id.

## Constraints

Orsay's browser is old WebKit: ES5 only (no `let`/`const`, arrows, template literals), no flexbox, partial CSS3. Video draws on a plane behind the page; the page goes transparent (`body.playing`) during playback. Posters load only for visible rows +-1.

## Tests

```
node test/scan.test.js
node test/info.test.js
node test/player.test.js
python test/test_tmdb.py
```

None of them needs a TV, a key or the network. The player test runs the real `player.js` against a fake plugin and fake timers. GitHub Actions runs all four on every push (`.github/workflows/tests.yml`). They cannot tell how the old TV browser renders something; that still needs a look at the TV.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The TV keeps showing an old version | It caches a widget by id. Restart `serve.py` (it stamps a new id), run App Sync again, open the newest entry, and compare the version next to the title with the one `serve.py` printed. Delete old entries from More Apps. |
| Install fails with `UndocumentedAPI '...'` | The TV's installer found an API name it does not know in the page text. Build such names at runtime, as `usb.js` does. |
| Black screen, no keys | Check `config.xml` (Samsung format, `<type>user</type>`, 960x540). A page that never calls `sendReadyEvent` stays on "Loading". |
| Tiles or text cut off at the right or bottom | The widget space is 960x540 whatever the browser reports. Press RED on the shelf for the calibration screen. |
| "No USB drive found" | Plug it in (the shelf looks again every few seconds), or press GREEN. Mounts are probed at `/dtv/usb/sda1` and similar. |
| "Folder Filma not found" | Create a folder named `Filma` on the drive (any capitalisation, up to 3 levels down) with one folder per movie. |
| A movie has no poster | Add `poster.jpg`, or run the TMDB tools. Large or progressive JPEGs may fail on the TV; Pillow converts them to 300x450 baseline. |
| INFO does nothing | Press BLUE for the log: `INFO key registered` should appear at start, and `Unhandled key N` shows what the remote sent. Without that line the TV does not deliver the key to widgets. |
| INFO says "No details" | Run `tmdb_posters.py --apply` on the drive. The folder name needs `[tmdbid-N]`; `tmdb_tag.py` adds it. |
| Subtitles look different from the TV player | BLUE log: `Subtitle font: loaded` or `NOT loaded`. They are drawn by the widget (Open Sans SemiBold), not by the TV. |
| The picture is the wrong shape | The log shows `Video size WxH` and `Picture area`. GREEN while playing cycles Auto / 16:9 / 4:3 / 1.85:1 / 2.35:1 and remembers it per movie. |
| `serve.py` says the port is in use | Another copy is still running. Stop it first. |
| `tmdb_*.py`: "Set the TMDB_API_KEY" | Open a new terminal after setting it, or use `$env:TMDB_API_KEY = "..."` in the same window. |
| `tmdb_*.py`: "TMDB rejected the key (HTTP 401)" | Wrong or copied-with-a-space key. The v3 key (32 characters) and the v4 token (`eyJ...`) both work. |

The BLUE log is the first thing to look at for anything else; it is cleared on every start of the widget.

## Ideas

A "continue watching" row, other subtitle formats, subtitle sync adjustment, collections (folders of related movies) as one tile.

The bundled subtitle font is Open Sans SemiBold (SIL Open Font License, `widget/fonts/OpenSans-OFL.txt`).
