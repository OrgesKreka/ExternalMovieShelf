/* Poster grid, focus, lazy poster loading, key handling. */
var widgetAPI, tvKey;
try {
	widgetAPI = new Common.API.Widget();
	tvKey = new Common.API.TVKeyValue();
} catch (e) {
	/* Common API missing: keep the stubs so the page still paints and the error shows in #boot. */
	widgetAPI = { sendReadyEvent: function () {}, sendReturnEvent: function () {}, blockNavigation: function () {} };
	tvKey = { KEY_LEFT: 4, KEY_RIGHT: 5, KEY_UP: 29460, KEY_DOWN: 29461, KEY_ENTER: 29443, KEY_PLAY: 71,
		KEY_PAUSE: 74, KEY_STOP: 70, KEY_RW: 69, KEY_FF: 72, KEY_RED: 108, KEY_GREEN: 20, KEY_BLUE: 22, KEY_YELLOW: 21, KEY_RETURN: 88, KEY_INFO: 31 };
	window.bootErrors = (window.bootErrors || []).concat('Common API missing: ' + e);
}

var Main = (function () {
	var COLS = 7, VIS_ROWS = 2;
	var COL_W = 124, ROW_H = 220, LEFT = 36, TOP = 60;   /* 960x540 coordinate space */
	var movies = [];
	var cells = [];
	var sel = 0, scroll = 0;
	var scanning = false;
	var retryTimer = null;
	var RETRY_MS = 4000;   /* re-check for the drive while none is plugged in */
	var problem = '';      /* '', 'nousb', 'nodir', 'empty' */

	function $(id) { return document.getElementById(id); }

	/* title: headline, sub: smaller explanation underneath */
	function setStatus(title, sub) {
		$('status').innerHTML = title ? '<div class="st"></div><div class="ss"></div>' : '';
		if (title) {
			$('status').firstChild.innerText = title;
			$('status').lastChild.innerText = sub || '';
		}
	}

	function minutes(sec) { return Math.floor(sec / 60) + ' min'; }

	/* The page is laid out for 960x540. This TV reports window.innerWidth/Height from config.xml
	   (1280x720 in the first builds) while actually displaying only the top-left 960x540, so scaling
	   by the reported size made the page too big. The reported size is logged, not used. */
	var BASE_W = 960, BASE_H = 540;
	var VERSION = '0.2.0';   /* keep in step with <ver> in config.xml (serve.py reads that one) */

	function fit() {
		var w = window.innerWidth || document.documentElement.clientWidth || 0;
		var h = window.innerHeight || document.documentElement.clientHeight || 0;
		Log.add('Viewport reports ' + w + 'x' + h + ', screen ' + (window.screen ? screen.width + 'x' + screen.height : '?'));
		Player.setArea(BASE_W, BASE_H);
		lastFit = 'layout ' + BASE_W + 'x' + BASE_H + ', browser reports ' + w + 'x' + h;
		Log.add(lastFit);
		$('dbg').innerText = lastFit + '  v' + VERSION;
	}

	/* Calibration screen (Red on the shelf): outlines 960x540, 1280x720 and 1920x1080 in unscaled
	   page pixels and prints what the browser reports, so a photo shows what the TV really displays. */
	var calEl = null, calSaved = null, lastFit = '';

	function calibrate() {
		var b = document.body, h = document.documentElement, i, t, r, html = '';
		var sizes = [[960, 540, '#4aa3ff'], [1280, 720, '#4cd964'], [1920, 1080, '#ff5252']];
		if (calEl) {
			calEl.parentNode.removeChild(calEl);
			calEl = null;
			b.style.webkitTransform = calSaved.tr; b.style.zoom = calSaved.zoom;
			b.style.width = calSaved.bw; b.style.height = calSaved.bh; b.style.overflow = calSaved.bo;
			h.style.width = calSaved.hw; h.style.height = calSaved.hh; h.style.overflow = calSaved.ho;
			return;
		}
		calSaved = { tr: b.style.webkitTransform, zoom: b.style.zoom, bw: b.style.width, bh: b.style.height, bo: b.style.overflow,
			hw: h.style.width, hh: h.style.height, ho: h.style.overflow };
		b.style.webkitTransform = ''; b.style.zoom = '';
		b.style.width = '1920px'; b.style.height = '1080px'; b.style.overflow = 'visible';
		h.style.width = '1920px'; h.style.height = '1080px'; h.style.overflow = 'visible';
		for (i = 0; i < sizes.length; i++) {
			r = sizes[i];
			html += '<div style="position:absolute;left:0px;top:0px;width:' + (r[0] - 6) + 'px;height:' + (r[1] - 6) + 'px;border:3px solid ' + r[2] + ';"></div>' +
				'<div style="position:absolute;left:' + (r[0] - 150) + 'px;top:' + (r[1] - 30) + 'px;color:' + r[2] + ';font-size:20px;font-weight:bold;">' + r[0] + 'x' + r[1] + '</div>';
		}
		for (t = 100; t < 1920; t += 100) {
			html += '<div style="position:absolute;left:' + t + 'px;top:8px;color:#ffffff;font-size:12px;">' + t + '</div>';
			if (t < 1080) { html += '<div style="position:absolute;left:8px;top:' + t + 'px;color:#ffffff;font-size:12px;">' + t + '</div>'; }
		}
		html += '<div style="position:absolute;left:120px;top:60px;width:700px;color:#ffffff;font-size:18px;line-height:24px;background:rgba(0,0,0,0.7);">' +
			'CALIBRATION v' + VERSION + '<br>inner ' + window.innerWidth + 'x' + window.innerHeight +
			'<br>client ' + document.documentElement.clientWidth + 'x' + document.documentElement.clientHeight +
			'<br>screen ' + (window.screen ? screen.width + 'x' + screen.height : '?') + ', ratio ' + (window.devicePixelRatio || '?') +
			'<br>' + lastFit + '<br>Take a photo, then press RED again.</div>';
		calEl = document.createElement('div');
		calEl.style.cssText = 'position:absolute;left:0px;top:0px;width:1920px;height:1080px;background:rgba(0,0,0,0.55);';
		calEl.innerHTML = html;
		b.appendChild(calEl);
		Log.add('Calibration shown; ' + lastFit);
	}

	/* Logs whether the bundled subtitle font really loaded: a span set in it is wider than the same
	   text in the plain monospace fallback only when the font file was applied. */
	function checkFont() {
		var probe = document.createElement('span');
		var fallback = document.createElement('span');
		var style = 'position:absolute;left:-2000px;top:0;font-size:40px;white-space:nowrap;';
		probe.style.cssText = style + "font-family:'SubFont',monospace;";
		fallback.style.cssText = style + 'font-family:monospace;';
		probe.innerText = fallback.innerText = 'Subtitle font mmmmmmmWWWilli';
		document.body.appendChild(probe);
		document.body.appendChild(fallback);
		setTimeout(function () {
			var a = probe.offsetWidth, b = fallback.offsetWidth;
			Log.add('Subtitle font: ' + (a !== b ? 'loaded' : 'NOT loaded, fallback in use') + ' (' + a + ' vs ' + b + ')');
			document.body.removeChild(probe);
			document.body.removeChild(fallback);
		}, 2500);
	}

	/* Hand the volume keys back to the TV so it shows its own volume bar and mute icon,
	   and ask for the INFO key, which the TV only delivers to widgets that register it. */
	function setupSound() {
		var api;
		try {
			api = new Common.API.Plugin();
			api.unregistKey(tvKey.KEY_VOL_UP);
			api.unregistKey(tvKey.KEY_VOL_DOWN);
			api.unregistKey(tvKey.KEY_MUTE);
			Log.add('Volume keys released to the TV');
		} catch (e) { Log.add('Volume key setup failed: ' + e); }
		try {
			api.registKey(tvKey.KEY_INFO);
			Log.add('INFO key registered');
		} catch (e3) { Log.add('INFO key not registered: ' + e3); }
		try { $('pluginNavi').SetBannerState(1); } catch (e2) { Log.add('SetBannerState failed: ' + e2); }
	}

	function onLoad() {
		var boot = $('boot');
		var errs = window.bootErrors || [];
		try { widgetAPI.sendReadyEvent(); } catch (e0) { errs.push('sendReadyEvent: ' + e0); }
		Log.add('Movie Shelf ' + VERSION + ' starting');
		$('hVer').innerText = 'v' + VERSION;
		try { $('anchor').focus(); } catch (e1) { errs.push('focus: ' + e1); }
		try { Store.load(); } catch (e2) { errs.push('Store: ' + e2); }
		setupSound();
		checkFont();
		try { Player.init(showShelf); fit(); } catch (e3) { errs.push('Player/fit: ' + e3); }
		if (errs.length) {
			boot.innerHTML = 'Movie Shelf started with errors:<br>' + errs.join('<br>') + '<br><br>Press BLUE for the log.';
		} else {
			boot.style.display = 'none';
		}
		rescan();
	}

	function showShelf() {
		updateResume();
		$('anchor').focus();
	}

	/* silent: automatic re-check while no drive is plugged in; keeps the message instead of flashing "Scanning". */
	function rescan(silent) {
		if (scanning) { return; }
		scanning = true;
		if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
		problem = '';
		if (!silent) {
			clearGrid();
			setStatus('Scanning USB drive...');
		}
		setTimeout(function () {
			var fs, reader, roots;
			try {
				fs = new FileSystem();
				reader = Usb.makeReader(fs);
				roots = Usb.findRoots($('pluginStorage'), reader);
				if (!roots.length) { movies = []; problem = 'nousb'; }
				else {
					movies = Usb.scan(reader, roots, true);
					if (movies.noMovieDir) { problem = 'nodir'; }
					else if (!movies.length) { problem = 'empty'; }
				}
			} catch (e) {
				Log.add('Scan failed: ' + e);
				movies = [];
				problem = 'error';
			}
			Log.add('Found ' + movies.length + ' movies' + (problem ? ' (' + problem + ')' : ''));
			scanning = false;
			build();
		}, 50);
	}

	function clearGrid() {
		var i, g = $('grid');
		for (i = 0; i < cells.length; i++) { unloadPoster(cells[i]); }
		while (g.firstChild) { g.removeChild(g.firstChild); }
		cells = [];
		movies = [];
		$('hCount').innerText = '';
	}

	/* Explains an empty shelf. A missing drive is re-checked automatically; the other cases need GREEN. */
	function showProblem() {
		var d = Usb.MOVIE_DIR_NAME;
		if (!problem) { setStatus(''); return; }
		if (problem === 'nousb') {
			setStatus('No USB drive found', 'Plug the drive into the TV. Looking again every few seconds, or press GREEN to rescan.');
			retryTimer = setTimeout(function () { retryTimer = null; if (!Player.isActive()) { rescan(true); } }, RETRY_MS);
		} else if (problem === 'nodir') {
			setStatus('Folder "' + d + '" not found on the USB drive', 'Create a folder named ' + d + ' with one folder per movie inside, then press GREEN to rescan.');
		} else if (problem === 'empty') {
			setStatus('No movies in "' + d + '"', 'Each movie needs its own folder with a video file (mp4, mkv, avi...). Press GREEN to rescan.');
		} else {
			setStatus('Could not read the USB drive', 'Press BLUE for the log, GREEN to try again.');
		}
	}

	function build() {
		var i, c, g = $('grid');
		sel = 0; scroll = 0;
		for (i = 0; i < movies.length; i++) {
			c = makeCell(movies[i]);
			g.appendChild(c.el);
			cells.push(c);
		}
		$('hCount').innerText = problem ? '' : movies.length + ' movies';
		showProblem();
		updateResume();
		layout();
	}

	function hash(str) {
		var h = 0, i;
		for (i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) % 100003; }
		return h;
	}

	function makeCell(m) {
		var el = document.createElement('div');
		var poster = document.createElement('div');
		var ph = document.createElement('div');
		var title = document.createElement('div');
		var year = document.createElement('div');
		var res = document.createElement('div');
		var dim = document.createElement('div');

		el.className = 'cell';
		poster.className = 'poster';
		ph.className = 'ph p' + (hash(m.title) % 8);
		ph.innerHTML = '<div class="ini"></div><div class="nm"></div>';
		ph.firstChild.innerText = m.title.charAt(0).toUpperCase();
		ph.lastChild.innerText = m.title;
		title.className = 'ctitle';
		title.innerText = m.title;
		year.className = 'cyear';
		year.innerText = m.year;
		res.className = 'cres';
		dim.className = 'dim';
		poster.appendChild(ph);
		poster.appendChild(dim);
		poster.appendChild(res);
		el.appendChild(poster);
		el.appendChild(title);
		el.appendChild(year);
		return { el: el, poster: poster, res: res, movie: m, img: null, failed: false };
	}

	function updateResume() {
		var i, s;
		for (i = 0; i < cells.length; i++) {
			s = Store.get(cells[i].movie.path);
			cells[i].res.style.display = s > 0 ? 'block' : 'none';
			if (s > 0) { cells[i].res.innerText = minutes(s); }
		}
	}

	function loadPoster(c) {
		var img;
		if (c.img || c.failed || !c.movie.poster) { return; }
		img = document.createElement('img');
		img.onload = function () { c.rgb = null; c.rgbTried = false; if (cells[sel] === c) { tint(); } };
		img.onerror = function () {
			Log.add('Poster failed: ' + c.movie.poster);
			c.failed = true;
			unloadPoster(c);
		};
		c.img = img;
		c.poster.insertBefore(img, c.poster.lastChild.previousSibling);
		img.src = 'file://' + encodeURI(c.movie.poster);
	}

	function unloadPoster(c) {
		if (!c.img) { return; }
		c.img.onerror = null;
		c.img.src = '';
		if (c.img.parentNode) { c.img.parentNode.removeChild(c.img); }
		c.img = null;
	}

	/* Positions visible rows, loads posters for visible rows +-1, unloads the rest. */
	function layout() {
		var i, row, col, c, visible, near;
		for (i = 0; i < cells.length; i++) {
			c = cells[i];
			row = Math.floor(i / COLS);
			col = i % COLS;
			visible = row >= scroll && row < scroll + VIS_ROWS;
			near = row >= scroll - 1 && row <= scroll + VIS_ROWS;
			if (visible) {
				c.el.style.left = (LEFT + col * COL_W) + 'px';
				c.el.style.top = (TOP + (row - scroll) * ROW_H) + 'px';
				c.el.style.display = 'block';
			} else {
				c.el.style.display = 'none';
			}
			if (near) { loadPoster(c); } else { unloadPoster(c); }
			c.el.className = i === sel ? 'cell sel' : 'cell';
		}
		drawScroll();
		tint();
	}

	function drawScroll() {
		var rows = Math.max(1, Math.ceil(cells.length / COLS));
		var track = 440;
		var th = Math.max(40, Math.round(track * Math.min(1, VIS_ROWS / rows)));
		var room = track - th;
		$('track').style.display = rows > VIS_ROWS ? 'block' : 'none';
		$('thumb').style.height = th + 'px';
		$('thumb').style.top = (rows > VIS_ROWS ? Math.round(room * scroll / (rows - VIS_ROWS)) : 0) + 'px';
		$('pos').innerText = cells.length ? (sel + 1) + ' / ' + cells.length : '';
		$('letter').innerText = cells.length ? Usb.sortKey(cells[sel].movie.title).charAt(0).toUpperCase() : '';
	}

	function nextLetter() {
		var i, cur;
		if (!cells.length) { return; }
		cur = Usb.sortKey(cells[sel].movie.title).charAt(0);
		for (i = sel + 1; i < cells.length; i++) {
			if (Usb.sortKey(cells[i].movie.title).charAt(0) !== cur) { select(i); return; }
		}
		select(0);
	}

	/* Palette colors of the placeholder classes p0..p7 (top color of each gradient). */
	var PAL = [[76, 102, 184], [163, 79, 143], [63, 162, 141], [184, 122, 58], [148, 79, 79], [99, 145, 64], [79, 147, 189], [123, 79, 192]];

	/* Average color of a loaded poster; null when the canvas is tainted or unsupported. */
	function avgColor(img) {
		var cv, g, d, i, r = 0, gr = 0, b = 0, n = 0;
		try {
			cv = document.createElement('canvas');
			cv.width = 8; cv.height = 12;
			g = cv.getContext('2d');
			g.drawImage(img, 0, 0, 8, 12);
			d = g.getImageData(0, 0, 8, 12).data;
			for (i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; n++; }
			return n ? [Math.round(r / n), Math.round(gr / n), Math.round(b / n)] : null;
		} catch (e) {
			return null;
		}
	}

	/* The shelf's own background: a gradient in the movie's color and, when the movie has a backdrop
	   picture, that picture under a translucent version of the gradient. It stays the element's own
	   background (no extra layer: separate backdrop layers misstack on this browser). */
	var shelfPic = '';       /* backdrop path currently painted */
	var picTimer = null;
	var PIC_DELAY = 150;     /* ms without key presses before a new backdrop is loaded */

	function paintShelf(rgb, pic) {
		var k = 0.62, r = Math.round(rgb[0] * k), g = Math.round(rgb[1] * k), b = Math.round(rgb[2] * k);
		var st = $('shelf').style;
		if (pic) {
			st.backgroundImage = '-webkit-linear-gradient(top, rgba(' + r + ',' + g + ',' + b + ',0.78) 0%, rgba(11,14,20,0.94) 85%), url("file://' + encodeURI(pic) + '")';
			st.webkitBackgroundSize = 'auto, 960px 540px';
			st.backgroundRepeat = 'no-repeat';
		} else {
			st.backgroundImage = '-webkit-linear-gradient(top, rgb(' + r + ',' + g + ',' + b + ') 0%, #0b0e14 85%)';
			st.webkitBackgroundSize = 'auto';
		}
	}

	/* Tints the backdrop with the selected movie: poster average if readable, else its placeholder color.
	   A movie with a backdrop picture gets it a moment after the selection settles. */
	function tint() {
		var c, rgb, want;
		if (!cells.length) { shelfPic = ''; paintShelf([20, 26, 38], ''); return; }
		c = cells[sel];
		if (!c.rgb && !c.rgbTried && c.img && c.img.complete) { c.rgbTried = true; c.rgb = avgColor(c.img); }   /* tried once: a tainted canvas would throw on every key press */
		rgb = c.rgb || PAL[hash(c.movie.title) % 8];
		want = c.movie.backdrop || '';
		if (picTimer) { clearTimeout(picTimer); picTimer = null; }
		if (!want) { shelfPic = ''; }
		paintShelf(rgb, shelfPic);                       /* the new color now, over the previous picture if any */
		if (want && want !== shelfPic) {
			picTimer = setTimeout(function () { picTimer = null; shelfPic = want; tint(); }, PIC_DELAY);
		}
	}

	/* ---- details screen (INFO) ---- */
	var infoOpen = false;
	var MAX_TEXT = 700;

	function setPicture(el, pic) {
		el.style.backgroundImage = pic
			? '-webkit-linear-gradient(top, rgba(8,10,16,0.80), rgba(8,10,16,0.95)), url("file://' + encodeURI(pic) + '")'
			: 'none';
		el.style.webkitBackgroundSize = pic ? 'auto, 960px 540px' : 'auto';
		el.style.backgroundRepeat = 'no-repeat';
	}

	function renderInfo() {
		var m = cells[sel].movie, d = m.details, img = $('infoPoster'), text, plain = m.title + (m.year ? ' (' + m.year + ')' : '');
		setPicture($('info'), m.backdrop);
		img.style.display = m.poster ? 'block' : 'none';
		img.onerror = function () { img.style.display = 'none'; };
		img.src = m.poster ? 'file://' + encodeURI(m.poster) : '';
		$('infoTitle').innerText = d && d.title ? d.title : plain;
		$('infoTag').innerText = d && d.tagline ? d.tagline : '';
		$('infoMeta').innerText = d ? Info.meta(d) : (m.year || '');
		if (d && d.overview) {
			text = d.overview.length > MAX_TEXT ? d.overview.substring(0, MAX_TEXT).replace(/\s+\S*$/, '') + '...' : d.overview;
		} else if (d === undefined) {
			text = 'Loading...';
		} else {
			text = 'No details for this movie yet. Run tools/tmdb_posters.py on the drive (see the README).';
		}
		$('infoText').innerText = text;
	}

	/* Shows the selected movie; its details file is read once (m.details: undefined = not yet, null = none). */
	function refreshInfo() {
		var m = cells[sel].movie;
		if (m.details === undefined) {
			if (m.info) {
				Info.load(m.info, function (d) {
					m.details = d;
					if (infoOpen && cells[sel].movie === m) { renderInfo(); }
				});
			} else {
				m.details = null;
			}
		}
		renderInfo();
	}

	function openInfo() {
		if (!cells.length) { return; }
		infoOpen = true;
		$('info').style.display = 'block';
		refreshInfo();
	}

	function closeInfo() {
		infoOpen = false;
		$('info').style.display = 'none';
		$('infoPoster').src = '';
	}

	function select(i) {
		var row;
		if (i < 0 || i >= cells.length) { return; }
		sel = i;
		row = Math.floor(sel / COLS);
		if (row < scroll) { scroll = row; }
		else if (row >= scroll + VIS_ROWS) { scroll = row - VIS_ROWS + 1; }
		layout();
	}

	function move(key) {
		var n = cells.length;
		if (!n) { return; }
		if (key === tvKey.KEY_LEFT) { select(sel > 0 ? sel - 1 : n - 1); }
		else if (key === tvKey.KEY_RIGHT) { select(sel < n - 1 ? sel + 1 : 0); }
		else if (key === tvKey.KEY_UP) { if (sel - COLS >= 0) { select(sel - COLS); } }
		else if (key === tvKey.KEY_DOWN) {
			if (sel + COLS < n) { select(sel + COLS); }
			else if (Math.floor(sel / COLS) < Math.floor((n - 1) / COLS)) { select(n - 1); }
		}
	}

	function onKeyDown(event) {
		var code = event.keyCode;

		if (calEl) {
			if (code === tvKey.KEY_RED || code === tvKey.KEY_RETURN) { calibrate(); widgetAPI.blockNavigation(event); }
			return;
		}

		if (Player.isActive()) {
			if (Player.onKey(code, tvKey)) { widgetAPI.blockNavigation(event); }
			return;
		}

		if (infoOpen) {
			if (code === tvKey.KEY_RETURN || code === tvKey.KEY_INFO) { closeInfo(); }
			else if (code === tvKey.KEY_ENTER || code === tvKey.KEY_PLAY) { closeInfo(); Player.play(cells[sel].movie); }
			else if (code === tvKey.KEY_LEFT) { select(sel > 0 ? sel - 1 : cells.length - 1); refreshInfo(); }
			else if (code === tvKey.KEY_RIGHT) { select(sel < cells.length - 1 ? sel + 1 : 0); refreshInfo(); }
			widgetAPI.blockNavigation(event);
			return;
		}

		switch (code) {
		case tvKey.KEY_LEFT:
		case tvKey.KEY_RIGHT:
		case tvKey.KEY_UP:
		case tvKey.KEY_DOWN:
			move(code);
			break;
		case tvKey.KEY_ENTER:
		case tvKey.KEY_PLAY:
			if (cells.length) { Player.play(cells[sel].movie); }
			break;
		case tvKey.KEY_INFO:
			openInfo();
			break;
		case tvKey.KEY_RED:
			calibrate();
			break;
		case tvKey.KEY_YELLOW:
			nextLetter();
			break;
		case tvKey.KEY_GREEN:
			rescan();
			break;
		case tvKey.KEY_BLUE:
			Log.toggle();
			break;
		case tvKey.KEY_RETURN:
			widgetAPI.sendReturnEvent();
			break;
		default:
			Log.add('Unhandled key ' + code);   /* shows which code a remote key sends, e.g. if INFO never arrives */
		}
	}

	return { onLoad: onLoad, onKeyDown: onKeyDown };
})();
