/* Resume positions (seconds) keyed by video path, kept in the widget's FileSystem common folder. */
var Store = (function () {
	var data = {};
	var fs = null;

	/* Fixed name: the widget id changes on every sync (see tools/serve.py), the resume file must not. */
	function dir() { return 'MovieShelf'; }
	function file() { return 'MovieShelf/resume.json'; }

	function open() {
		if (fs) { return fs; }
		if (typeof FileSystem === 'undefined') { return null; }
		fs = new FileSystem();
		return fs;
	}

	function load() {
		var f, text, h;
		try {
			f = open();
			if (!f) { Log.add('Store: no FileSystem, resume kept in memory only'); return; }
			if (!f.isValidCommonPath(dir())) { f.createCommonDir(dir()); }
			h = f.openCommonFile(file(), 'r');
			if (h) {
				text = h.readAll();
				f.closeCommonFile(h);
				if (text) { data = JSON.parse(text) || {}; }
			}
			dropOldDetails();
			Log.add('Store: loaded ' + countKeys() + ' positions');
		} catch (e) {
			Log.add('Store load failed: ' + e);
			data = {};
		}
	}

	/* Version 0.2.8 briefly kept movie details here ('details:<id>'). They belong on the drive (tools/tmdb_posters.py),
	   not in this small file, so they are removed once. */
	function dropOldDetails() {
		var k, n = 0;
		for (k in data) {
			if (data.hasOwnProperty(k) && k.indexOf('details:') === 0) { delete data[k]; n++; }
		}
		if (n) {
			Log.add('Store: removed ' + n + ' saved details that no longer belong here');
			save();
		}
	}

	function save() {
		var f, h;
		try {
			f = open();
			if (!f) { return; }
			if (!f.isValidCommonPath(dir())) { f.createCommonDir(dir()); }
			h = f.openCommonFile(file(), 'w');
			if (h) {
				h.writeAll(JSON.stringify(data));
				f.closeCommonFile(h);
			}
		} catch (e) {
			Log.add('Store save failed: ' + e);
		}
	}

	function countKeys() {
		var k, n = 0;
		for (k in data) { if (data.hasOwnProperty(k)) { n++; } }
		return n;
	}

	/* "/dtv/usb/sda1/Filma/X/x.mp4" -> "/Filma/X/x.mp4" (the drive may mount under another name next time) */
	function norm(key) { return key.replace(/^(\/dtv\/usb|\$USB_DIR)\/[^\/]+/, ''); }

	function get(key) {
		var n = norm(key);
		if (data.hasOwnProperty(n)) { return data[n]; }
		return data.hasOwnProperty(key) ? data[key] : 0;
	}

	function set(key, seconds) {
		delete data[key];
		data[norm(key)] = seconds;
		save();
	}

	function clear(key) {
		var n = norm(key), had = data.hasOwnProperty(n) || data.hasOwnProperty(key);
		delete data[n];
		delete data[key];
		if (had) { save(); }
	}

	/* "Watched to the end" marks live in the same file, as 'watched:<path without the mount name>' = 1. */
	function watchedKey(path) { return 'watched:' + norm(path); }
	function isWatched(path) { return get(watchedKey(path)) > 0; }
	function setWatched(path, on) {
		if (on) { set(watchedKey(path), 1); } else { clear(watchedKey(path)); }
	}

	return { load: load, get: get, set: set, clear: clear, norm: norm, isWatched: isWatched, setWatched: setWatched };
})();
