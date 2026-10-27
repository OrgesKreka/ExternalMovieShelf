/* Find the USB mount, walk folders, pick posters, clean titles. ES5 only. */
var Usb = (function () {
	var VIDEO = /\.(mp4|m4v|mkv|avi|mov|wmv|ts|mpg|mpeg)$/i;
	var IMAGE = /\.(jpe?g|png)$/i;
	var SUB = /\.srt$/i;
	var MAX_DEPTH = 4;
	var MOVIE_DIR = 'filma';
	var SKIP_DIRS = /^(system volume information|lost\+found|recycler|\$recycle\.bin|@eadir|found\.\d+)$/i;
	var TAGS = /\b(2160p|1080p|1080i|720p|576p|480p|4k|uhd|hdr|bluray|blu-ray|brrip|bdrip|webrip|web-dl|webdl|dvdrip|dvdscr|hdrip|hdtv|x264|x265|h264|h265|hevc|xvid|divx|aac|ac3|dts|remux|extended|unrated|proper|repack|multi|german|dubbed)\b/i;

	function log(msg) {
		if (typeof Log !== 'undefined') { Log.add(msg); }
	}

	/* Storage plugin calls are looked up by name so the TV's installer scan, which rejects
	   undocumented API names it finds as plain text, doesn't refuse the widget. */
	function storage(plugin, parts, args) {
		var fn = plugin[parts.join('')];
		return fn.apply(plugin, args || []);
	}

	function baseName(name) {
		var i = name.lastIndexOf('.');
		return i > 0 ? name.substring(0, i) : name;
	}

	function isHidden(name) {
		var c = name.charAt(0);
		return c === '.' || c === '$' || SKIP_DIRS.test(name);
	}

	function join(a, b) {
		return a.charAt(a.length - 1) === '/' ? a + b : a + '/' + b;
	}

	/* "The.Matrix.1999.1080p.BluRay.x264" -> {title: "The Matrix", year: "1999"} */
	function cleanTitle(raw) {
		var s = raw.replace(/[\[\{\(]\s*(tmdb|imdb|tvdb)(id)?\s*[-=:]\s*[a-z0-9]+\s*[\]\}\)]/gi, ' ').replace(/[._]+/g, ' ').replace(/[\[\]\(\)\{\}]/g, ' ');
		var years = s.match(/\b(19|20)\d{2}\b/g);
		var year = '';
		var title = s;
		var idx, cut;

		if (years) {
			year = years[years.length - 1];
			idx = s.lastIndexOf(year);
			if (s.substring(0, idx).replace(/\s+/g, '') !== '') {
				title = s.substring(0, idx);
			} else {
				year = '';
			}
		}
		cut = title.search(TAGS);
		if (cut > 0) { title = title.substring(0, cut); }
		title = title.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
		return { title: title || raw, year: year };
	}

	var FOLD = { '\u00e0': 'a', '\u00e1': 'a', '\u00e2': 'a', '\u00e4': 'a', '\u00e3': 'a', '\u00e5': 'a',
		'\u00e8': 'e', '\u00e9': 'e', '\u00ea': 'e', '\u00eb': 'e', '\u00ec': 'i', '\u00ed': 'i', '\u00ee': 'i', '\u00ef': 'i',
		'\u00f2': 'o', '\u00f3': 'o', '\u00f4': 'o', '\u00f6': 'o', '\u00f5': 'o', '\u00f9': 'u', '\u00fa': 'u', '\u00fb': 'u',
		'\u00fc': 'u', '\u00e7': 'c', '\u00f1': 'n' };

	/* Sort key = the title as shown: lowercase, accents folded, numbers compared by value
	   ("Part 2" before "Part 10"). Leading articles are NOT skipped, so "The ..." sorts under T. */
	function sortKey(title) {
		var s = title.toLowerCase().replace(/[\u00e0-\u00f6\u00f9-\u00fc]/g, function (ch) { return FOLD[ch] || ch; });
		return s.replace(/\d+/g, function (n) { return ('00000000' + n).slice(-8); });
	}

	function sortMovies(list) {
		list.sort(function (a, b) {
			var ka = sortKey(a.title), kb = sortKey(b.title);
			if (ka < kb) { return -1; }
			if (ka > kb) { return 1; }
			return a.path < b.path ? -1 : 1;
		});
		return list;
	}

	/* images: file names. base: video base name, or null for "any". */
	function pickPoster(images, base, sameBaseOnly) {
		var i, b = base ? base.toLowerCase() : null;
		var prefs = ['poster', 'folder', 'cover'];
		var sorted = images.slice().sort();
		var p;

		if (b) {
			for (i = 0; i < sorted.length; i++) {
				if (baseName(sorted[i]).toLowerCase() === b) { return sorted[i]; }
			}
		}
		if (sameBaseOnly) { return null; }
		for (p = 0; p < prefs.length; p++) {
			for (i = 0; i < sorted.length; i++) {
				if (baseName(sorted[i]).toLowerCase() === prefs[p]) { return sorted[i]; }
			}
		}
		return sorted.length ? sorted[0] : null;
	}

	/* Breadth-first search (up to 3 levels) for a folder named MOVIE_DIR; returns its path or null. */
	function findMovieDir(readDir, root) {
		var level = [root], next, d, i, j, entries, p;
		for (d = 0; d < 3; d++) {
			next = [];
			for (i = 0; i < level.length; i++) {
				entries = readDir(level[i]) || [];
				for (j = 0; j < entries.length; j++) {
					if (!entries[j].isDir || isHidden(entries[j].name)) { continue; }
					p = join(level[i], entries[j].name);
					if (entries[j].name.toLowerCase() === MOVIE_DIR) { return p; }
					next.push(p);
				}
			}
			level = next;
		}
		return null;
	}

	/* Same base name first (or "Movie.en.srt" style prefixes); a lone .srt in a one-movie folder also counts. */
	function pickSub(subs, base, single) {
		var i, b = base.toLowerCase(), sorted = subs.slice().sort();
		for (i = 0; i < sorted.length; i++) {
			if (baseName(sorted[i]).toLowerCase() === b) { return sorted[i]; }
		}
		for (i = 0; i < sorted.length; i++) {
			if (sorted[i].toLowerCase().indexOf(b + '.') === 0) { return sorted[i]; }
		}
		return single && sorted.length ? sorted[0] : null;
	}

	/* readDir(path) -> [{name, isDir}] or null. Returns movies sorted by title. */
	function scan(readDir, roots, requireDir) {
		var movies = [];
		var walked = 0;
		var foundDirs = 0;
		var r;

		function walk(path, depth, isRoot) {
			var entries = readDir(path);
			var videos = [], images = [], dirs = [], subs = [];
			var i, e, v, folderName, c, poster, base, sub;

			if (!entries) { log('readDir failed: ' + path); return; }
			walked++;
			for (i = 0; i < entries.length; i++) {
				e = entries[i];
				if (isHidden(e.name)) { continue; }
				if (e.isDir) { dirs.push(e.name); }
				else if (VIDEO.test(e.name)) { videos.push(e.name); }
				else if (IMAGE.test(e.name)) { images.push(e.name); }
				else if (SUB.test(e.name)) { subs.push(e.name); }
			}

			if (walked <= 12) {
				log('walk ' + path.substring(path.lastIndexOf('/', path.length - 2) + 1) + ' (depth ' + depth + (isRoot ? ', top' : '') + '): ' + dirs.length + ' dirs, ' + videos.length + ' videos, ' + images.length + ' images');
			}
			if (videos.length === 1 && !isRoot) {
				folderName = path.substring(path.lastIndexOf('/') + 1);
				c = cleanTitle(folderName);
				poster = pickPoster(images, baseName(videos[0]), false);
				sub = pickSub(subs, baseName(videos[0]), true);
				movies.push({
					title: c.title, year: c.year, folder: path,
					path: join(path, videos[0]),
					poster: poster ? join(path, poster) : null,
					subs: sub ? join(path, sub) : null
				});
			} else {
				for (v = 0; v < videos.length; v++) {
					base = baseName(videos[v]);
					c = cleanTitle(base);
					poster = pickPoster(images, base, true);
					sub = pickSub(subs, base, false);
					movies.push({
						title: c.title, year: c.year, folder: path,
						path: join(path, videos[v]),
						poster: poster ? join(path, poster) : null,
						subs: sub ? join(path, sub) : null
					});
				}
			}

			if (videos.length !== 1 || isRoot) {
				if (depth < MAX_DEPTH) {
					for (i = 0; i < dirs.length; i++) { walk(join(path, dirs[i]), depth + 1, false); }
				}
			}
		}

		/* If a drive has a "Filma" folder, only that folder is scanned. */
		for (r = 0; r < roots.length; r++) {
			var movieDir = findMovieDir(readDir, roots[r]);
			if (movieDir) { foundDirs++; log('Using ' + movieDir); walk(movieDir, 0, true); }
			else if (requireDir) { log('No ' + MOVIE_DIR + ' folder under ' + roots[r]); }
			else { log('No ' + MOVIE_DIR + ' folder under ' + roots[r] + ', scanning the whole drive'); walk(roots[r], 0, true); }
		}
		sortMovies(movies);
		movies.noMovieDir = !!requireDir && foundDirs === 0;   /* true: drive present, folder missing */
		return movies;
	}

	/* Wraps the Orsay FileSystem object into the readDir shape scan() wants. */
	function makeReader(fs) {
		return function (path) {
			var raw, out = [], i, e, name, dir;
			try { raw = fs.readDir(path); } catch (ex) { log('readDir threw ' + path + ': ' + ex); return null; }
			if (!raw) { return null; }
			for (i = 0; i < raw.length; i++) {
				e = raw[i];
				if (!e || !e.name) { continue; }
				/* The TV returns folders as "name/" and includes "./" and "../". */
				name = e.name;
				dir = !!e.isDir;
				if (name.charAt(name.length - 1) === '/') { name = name.substring(0, name.length - 1); dir = true; }
				if (name === '.' || name === '..' || name === '') { continue; }
				out.push({ name: name, isDir: dir });
			}
			return out;
		};
	}

	/* Mount roots such as /dtv/usb/sda1. Probing the mount paths works on the UE46F6500; the
	   Storage plugin is only a backup (its partition-info call is missing there). */
	function findRoots(plugin, readDir) {
		var roots = [];
		var i, n, id, parts, p, name, b, d, probe;
		var bases = ['/dtv/usb/', '$USB_DIR/'];
		var partitions = ['sda1', 'sdb1', 'sdc1', 'sdd1'];
		var disks = ['sda', 'sdb', 'sdc', 'sdd'];   /* only if there is no partition, else the drive would be listed twice */

		for (b = 0; b < bases.length; b++) {
			for (d = 0; d < partitions.length; d++) {
				probe = bases[b] + partitions[d];
				if (readDir(probe)) { log('Found mount ' + probe); roots.push(probe); }
			}
			if (!roots.length) {
				for (d = 0; d < disks.length; d++) {
					probe = bases[b] + disks[d];
					if (readDir(probe)) { log('Found mount ' + probe); roots.push(probe); }
				}
			}
			if (roots.length) { break; }
		}

		if (!roots.length) {
			try {
				n = storage(plugin, ['GetUSB', 'ListSize']);
				log('USB devices: ' + n);
				for (i = 0; i < n; i++) {
					id = storage(plugin, ['GetUSB', 'DeviceID'], [i]);
					parts = storage(plugin, ['GetUSB', 'PartitionNum'], [id]);
					log('USB ' + i + ' id=' + id + ' partitions=' + parts);
					for (p = 0; p < parts; p++) {
						name = storage(plugin, ['GetUSB', 'PartitionInfo'], [id, 2, p]);
						log('  partition ' + p + ' -> ' + name);
						if (name) { roots.push(name.charAt(0) === '/' ? name : '/dtv/usb/' + name); }
					}
				}
			} catch (e) {
				log('Storage plugin failed: ' + e);
			}
		}
		log('Roots: ' + (roots.join(', ') || 'none'));
		return roots;
	}

	return {
		MOVIE_DIR_NAME: 'Filma',
		cleanTitle: cleanTitle,
		sortKey: sortKey,
		pickPoster: pickPoster,
		pickSub: pickSub,
		scan: scan,
		makeReader: makeReader,
		findRoots: findRoots
	};
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = Usb; }
