/* Details of a movie (title, rating, plot...) from the <video>.tmdb.json that tools/tmdb_posters.py writes. ES5 only. */
var Info = (function () {
	var SEP = '  ' + String.fromCharCode(183) + '  ';   /* middle dot; built at runtime, scripts stay ASCII */

	function log(msg) {
		if (typeof Log !== 'undefined') { Log.add(msg); }
	}

	/* JSON text -> object, or null when it is not usable. */
	function parse(text) {
		var d;
		var t = String(text);
		if (t.charCodeAt(0) === 65279) { t = t.substring(1); }   /* byte order mark */
		try { d = JSON.parse(t); } catch (e) { return null; }
		return d && typeof d === 'object' ? d : null;
	}

	function fetchText(url, cb) {
		var x = new XMLHttpRequest();
		try {
			x.open('GET', url, true);
			if (x.overrideMimeType) { x.overrideMimeType('text/plain; charset=utf-8'); }
			x.onreadystatechange = function () {
				if (x.readyState === 4) { cb((x.status === 200 || x.status === 0) && x.responseText ? x.responseText : null); }
			};
			x.send(null);
		} catch (e) {
			cb(null);
		}
	}

	function viaFileSystem(path) {
		var fs, h, t = null;
		try {
			fs = new FileSystem();
			h = fs.openCommonFile(path, 'r');
			if (h) { t = h.readAll(); fs.closeCommonFile(h); }
		} catch (e) { /* not readable this way */ }
		return t;
	}

	/* done(object) or done(null). */
	function load(path, done) {
		if (!path) { done(null); return; }
		fetchText('file://' + encodeURI(path), function (text) {
			var d = parse(text || viaFileSystem(path) || '');
			if (!d) { log('Details unreadable: ' + path); }
			done(d);
		});
	}

	function runtime(min) {
		var m = parseInt(min, 10) || 0;
		if (m <= 0) { return ''; }
		return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm';
	}

	/* "1995  .  2h 50m  .  8.2/10  .  Crime, Drama" (parts that are missing are left out). */
	function meta(d) {
		var parts = [], rt;
		if (!d) { return ''; }
		if (d.year) { parts.push(d.year); }
		rt = runtime(d.runtime);
		if (rt) { parts.push(rt); }
		if (d.rating > 0) { parts.push(d.rating.toFixed(1) + '/10'); }
		if (d.genres && d.genres.length) { parts.push(d.genres.join(', ')); }
		return parts.join(SEP);
	}

	return { load: load, parse: parse, runtime: runtime, meta: meta };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = Info; }
