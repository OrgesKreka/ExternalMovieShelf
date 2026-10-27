/* SRT subtitles drawn by the widget itself (the TV's own subtitle API is poorly documented). */
var Subs = (function () {
	var cues = [];
	var enabled = true;
	var shown = null;

	function el() { return document.getElementById('sub'); }

	function parseTime(s) {
		var m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(s);
		var ms;
		if (!m) { return -1; }
		ms = m[4];
		while (ms.length < 3) { ms += '0'; }
		return ((parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 60 + parseInt(m[3], 10)) * 1000 + parseInt(ms.substring(0, 3), 10);
	}

	/* "00:01:02,345 --> 00:01:04,000" blocks -> [{start, end, text}] sorted by start. */
	function parse(text) {
		var blocks = text.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
		var out = [], b, lines, i, k, parts, start, end, body;
		for (b = 0; b < blocks.length; b++) {
			lines = blocks[b].split('\n');
			k = -1;
			for (i = 0; i < lines.length; i++) { if (lines[i].indexOf('-->') >= 0) { k = i; break; } }
			if (k < 0) { continue; }
			parts = lines[k].split('-->');
			start = parseTime(parts[0]);
			end = parseTime(parts[1]);
			if (start < 0 || end < 0) { continue; }
			body = lines.slice(k + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').replace(/^\s+|\s+$/g, '');
			if (body) { out.push({ start: start, end: end, text: body }); }
		}
		out.sort(function (x, y) { return x.start - y.start; });
		return out;
	}

	function fetchText(url, charset, cb) {
		var x = new XMLHttpRequest();
		try {
			x.open('GET', url, true);
			if (x.overrideMimeType) { x.overrideMimeType('text/plain; charset=' + charset); }
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

	function log(msg) {
		if (typeof Log !== 'undefined') { Log.add(msg); }
	}

	/* Loads and parses the file; done(count) is called with 0 when nothing could be read. */
	function load(path, done) {
		var url = 'file://' + encodeURI(path);
		cues = [];
		clear();
		if (!path) { done(0); return; }
		fetchText(url, 'utf-8', function (text) {
			var fsText;
			if (!text) {
				fsText = viaFileSystem(path);
				if (!fsText) { log('Subtitles unreadable: ' + path); done(0); return; }
				log('Subtitles read via FileSystem');
				cues = parse(fsText);
				done(cues.length);
				return;
			}
			if (text.indexOf('\ufffd') >= 0) {
				/* not UTF-8: most SRTs from older rips are Windows-1252 */
				fetchText(url, 'windows-1252', function (t2) {
					cues = parse(t2 || text);
					log('Subtitles read as windows-1252');
					done(cues.length);
				});
				return;
			}
			cues = parse(text);
			log('Subtitles read as utf-8');
			done(cues.length);
		});
	}

	function find(ms) {
		var lo = 0, hi = cues.length - 1, mid, i;
		while (lo <= hi) {
			mid = (lo + hi) >> 1;
			if (cues[mid].start <= ms) { lo = mid + 1; } else { hi = mid - 1; }
		}
		for (i = hi; i >= 0 && i > hi - 3; i--) {
			if (ms >= cues[i].start && ms <= cues[i].end) { return cues[i]; }
		}
		return null;
	}

	function show(ms) {
		var e = el(), cue;
		if (!e) { return; }
		cue = enabled && cues.length ? find(ms) : null;
		if (cue === shown) { return; }
		shown = cue;
		e.innerText = cue ? cue.text : '';
		e.style.display = cue ? 'block' : 'none';
	}

	function clear() {
		var e = el();
		shown = null;
		if (e) { e.innerText = ''; e.style.display = 'none'; }
	}

	function toggle() {
		enabled = !enabled;
		if (!enabled) { clear(); }
		return enabled;
	}

	return {
		parse: parse, load: load, show: show, clear: clear, toggle: toggle,
		count: function () { return cues.length; },
		isEnabled: function () { return enabled; }
	};
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = Subs; }
