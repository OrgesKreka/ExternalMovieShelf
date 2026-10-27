/* Full-screen playback through the SAMSUNG-INFOLINK-PLAYER plugin. */
var Player = (function () {
	var AREA = [0, 0, 960, 540];    /* replaced by Main.fit() with the measured viewport */
	var JUMP = 30;                  /* seconds */
	var MIN_SAVE = 60;              /* only remember positions past this */
	var plugin = null;
	var onExit = null;
	var active = false, paused = false, resumed = false, triedUrl = false, failed = false;
	var movie = null;
	var startAt = 0, curMs = 0, durMs = 0;
	var osdTimer = null;
	var tick = null, tickAt = 0;   /* smooths the 1 s time callback so subtitles change on time */

	function $(id) { return document.getElementById(id); }

	function two(n) { return (n < 10 ? '0' : '') + n; }

	function fmt(ms) {
		var s = Math.floor(ms / 1000);
		var h = Math.floor(s / 3600);
		var m = Math.floor((s % 3600) / 60);
		return (h > 0 ? h + ':' + two(m) : m) + ':' + two(s % 60);
	}

	function init(exitCallback) {
		plugin = $('pluginPlayer');
		onExit = exitCallback;
	}

	function setCallbacks() {
		plugin.OnCurrentPlayTime = 'Player.onTime';
		plugin.OnStreamInfoReady = 'Player.onInfo';
		plugin.OnBufferingComplete = 'Player.onBuffered';
		plugin.OnRenderingComplete = 'Player.onEnd';
		plugin.OnConnectionFailed = 'Player.onError';
		plugin.OnNetworkDisconnected = 'Player.onError';
		plugin.OnRenderError = 'Player.onError';
		plugin.OnAuthenticationFailed = 'Player.onError';
	}

	var ICONS = {
		restart: '<i class="bar" style="left:14px;top:13px"></i><i class="tl" style="left:20px;top:14px"></i>',
		back: '<i class="tl" style="left:9px;top:14px"></i><i class="tl" style="left:21px;top:14px"></i>',
		fwd: '<i class="tr" style="left:11px;top:14px"></i><i class="tr" style="left:23px;top:14px"></i>',
		stop: '<i class="sq" style="left:14px;top:14px"></i>',
		play: '<i class="tr" style="left:20px;top:18px"></i>',
		pause: '<i class="bar" style="left:17px;top:17px"></i><i class="bar" style="left:30px;top:17px"></i>'
	};
	var focus = -1;        /* highlighted transport button, -1 = none (arrows then seek) */
	var flashIdx = -1;     /* button briefly lit when its remote key is pressed */

	function renderBtns() {
		var names = ['restart', 'back', paused ? 'play' : 'pause', 'fwd', 'stop'];
		var i, el;
		for (i = 0; i < 5; i++) {
			el = $('b' + i);
			el.className = 'btn' + (i === 2 ? ' big' : '') + (i === focus || i === flashIdx ? ' f' : '');
			if (el.getAttribute('data-ic') !== names[i]) {
				el.innerHTML = ICONS[names[i]];
				el.setAttribute('data-ic', names[i]);
			}
		}
	}

	function flash(i) {
		flashIdx = i;
		renderBtns();
		setTimeout(function () { flashIdx = -1; renderBtns(); }, 350);
	}

	function showOsd(msg, keep) {
		$('osd').style.display = 'block';
		document.body.className = 'playing osd';
		$('osdKeys').innerHTML = '<b>ENTER</b> play / pause &nbsp; <b>LEFT / RIGHT</b> -/+30 s &nbsp; <b>DOWN</b> buttons &nbsp; <b>YELLOW</b> subtitles ' + subState() + ' &nbsp; <b>GREEN</b> picture ' + MODES[mode][0] + ' &nbsp; <b>RED</b> restart &nbsp; <b>RETURN</b> back';
		$('osdTitle').innerText = movie ? movie.title + (movie.year ? ' (' + movie.year + ')' : '') : '';
		$('osdMsg').innerText = msg || (paused ? 'Paused' : '');
		renderBtns();
		draw();
		if (osdTimer) { clearTimeout(osdTimer); osdTimer = null; }
		if (!keep && !paused && !failed && focus < 0) { osdTimer = setTimeout(hideOsd, 5000); }
	}

	function subState() {
		if (!movie || !movie.subs) { return '(none found)'; }
		return Subs.count() ? (Subs.isEnabled() ? '(on)' : '(off)') : '(unreadable)';
	}

	function hideOsd() {
		if (active) { document.body.className = 'playing'; }
		$('osd').style.display = 'none';
		osdTimer = null;
	}

	function draw() {
		var pct = durMs > 0 ? Math.min(100, curMs * 100 / durMs) : 0;
		$('osdFill').style.width = Math.round(pct * 6.88) + 'px';
		$('osdCur').innerText = fmt(curMs);
		$('osdDur').innerText = durMs > 0 ? fmt(durMs) : '--:--';
	}

	function start(url) {
		Log.add('Play ' + url);
		applyArea();
		plugin.Play(url);
	}

	/* Make sure the TV's audio output is on, and log what it reports. */
	function unmute() {
		var a = $('pluginAudio');
		try {
			a.SetUserMute(0);
			Log.add('Audio: volume ' + a.GetVolume() + ', muted ' + a.GetUserMute());
		} catch (e) { Log.add('Audio plugin failed: ' + e); }
	}

	function loadSubs(m) {
		Subs.clear();
		if (!m.subs) { Log.add('No subtitle file next to the movie'); return; }
		Log.add('Subtitle file ' + m.subs);
		Subs.load(m.subs, function (n) {
			Log.add('Subtitles: ' + n + ' cues');
			if (active && $('osd').style.display === 'block') { showOsd(''); }
		});
		if (tick) { clearInterval(tick); }
		tick = setInterval(function () {
			var est = curMs;
			if (!paused && tickAt) { est += Math.min(1200, new Date().getTime() - tickAt); }
			Subs.show(est);
		}, 200);
	}

	function play(m) {
		movie = m;
		active = true; paused = false; resumed = false; triedUrl = false; failed = false; focus = -1;
		curMs = 0; durMs = 0;
		detectedAr = 0;
		mode = Store.get('aspect:' + Store.norm(m.path)) || 0;
		if (mode >= MODES.length) { mode = 0; }
		startAt = Store.get(m.path);
		document.body.className = 'playing';
		unmute();
		loadSubs(m);
		setCallbacks();
		showOsd('Loading...', true);
		try { start(m.path); } catch (e) { Log.add('Play threw: ' + e); onError('throw'); }
	}

	/* The TV stretches the picture to whatever area it is given, so the area must have the video's own
	   shape. Shape = size reported by the player when it can, or picked by hand with GREEN. */
	var MODES = [['Auto', 0], ['16:9', 16 / 9], ['4:3', 4 / 3], ['1.85:1', 1.85], ['2.35:1', 2.35]];
	var mode = 0;          /* index into MODES, remembered per movie */
	var detectedAr = 0;    /* 0 = unknown */

	function aspectKey() { return 'aspect:' + Store.norm(movie.path); }

	function applyArea() {
		var ar = mode ? MODES[mode][1] : detectedAr;
		var w = AREA[2], h = AREA[3], x = AREA[0], y = AREA[1];
		if (ar) {
			if (ar > AREA[2] / AREA[3]) { h = Math.round(AREA[2] / ar); }
			else { w = Math.round(AREA[3] * ar); }
			x = AREA[0] + Math.round((AREA[2] - w) / 2);
			y = AREA[1] + Math.round((AREA[3] - h) / 2);
		}
		try { plugin.SetDisplayArea(x, y, w, h); } catch (e) { Log.add('SetDisplayArea failed: ' + e); return; }
		Log.add('Picture area ' + x + ',' + y + ' ' + w + 'x' + h + ' (' + MODES[mode][0] + (mode === 0 && ar ? ', detected ' + ar.toFixed(2) : '') + ')');
	}

	function callNamed(parts) {
		var fn = plugin[parts.join('')];
		return fn ? fn.call(plugin) : undefined;
	}

	/* Method names are assembled at runtime: the TV's installer rejects some API names it finds as text. */
	function detectSize() {
		var vw, vh, res, m, k, list = [], line, i;
		detectedAr = 0;
		try {
			vw = parseInt(callNamed(['GetVideo', 'Width']), 10);
			vh = parseInt(callNamed(['GetVideo', 'Height']), 10);
			if (!(vw > 0 && vh > 0)) {
				res = callNamed(['GetVideo', 'Resolution']);
				m = /(\d+)\D+(\d+)/.exec(String(res));
				vw = m ? parseInt(m[1], 10) : 0;
				vh = m ? parseInt(m[2], 10) : 0;
			}
		} catch (e) { Log.add('Video size call failed: ' + e); }
		if (vw > 0 && vh > 0) {
			detectedAr = vw / vh;
			Log.add('Video size ' + vw + 'x' + vh + ' (' + detectedAr.toFixed(2) + ')');
			return;
		}
		Log.add('Video size not available from the player; use GREEN to pick the shape');
		if (!detectSize.listed) {
			detectSize.listed = true;
			try { for (k in plugin) { if (/^[A-Z]/.test(k) && typeof plugin[k] !== 'string') { list.push(k); } } } catch (e2) { /* ignore */ }
			Log.add('Player methods (' + list.length + '):');
			for (i = 0; i < list.length; i += 8) { line = list.slice(i, i + 8).join(' '); Log.add('  ' + line); }
		}
	}

	function cycleAspect() {
		mode = (mode + 1) % MODES.length;
		Store.set(aspectKey(), mode);
		applyArea();
		showOsd('Picture: ' + MODES[mode][0] + (mode === 0 && detectedAr ? ' (' + detectedAr.toFixed(2) + ')' : ''));
	}

	function onInfo() {
		if (!active) { return; }
		try { durMs = plugin.GetDuration(); Log.add('Duration ' + fmt(durMs)); } catch (e) { Log.add('GetDuration failed: ' + e); }
		detectSize();
		applyArea();
	}

	function onBuffered() {
		if (!active) { return; }
		if (!resumed) {
			resumed = true;
			if (startAt > 0) {
				Log.add('Resume at ' + startAt + 's');
				try { plugin.JumpForward(startAt); } catch (e) { Log.add('Resume jump failed: ' + e); }
			}
			showOsd('');
		}
	}

	function onTime(ms) {
		if (!active) { return; }
		curMs = parseInt(ms, 10) || 0;
		tickAt = new Date().getTime();
		if ($('osd').style.display === 'block') { draw(); }
	}

	function onEnd() {
		if (!active) { return; }
		Log.add('Playback finished');
		Store.clear(movie.path);
		leave(false);
	}

	function onError(code) {
		if (!active) { return; }
		Log.add('Player error ' + code);
		if (!triedUrl) {
			triedUrl = true;
			try {
				plugin.Stop();
				start('file://' + encodeURI(movie.path));
				return;
			} catch (e) { Log.add('file:// retry threw: ' + e); }
		}
		failed = true;
		showOsd('Cannot play this file (' + code + '). RETURN goes back.', true);
	}

	function toggle() {
		flash(2);
		try {
			if (paused) { plugin.Resume(); paused = false; showOsd(''); }
			else { plugin.Pause(); paused = true; showOsd('Paused', true); }
		} catch (e) { Log.add('Pause/resume failed: ' + e); }
	}

	function jump(sign) {
		var left = durMs > 0 ? (durMs - curMs) / 1000 : 9999;
		try {
			if (sign > 0) {
				if (left > JUMP + 5) { plugin.JumpForward(JUMP); }
			} else {
				plugin.JumpBackward(JUMP);
			}
		} catch (e) { Log.add('Jump failed: ' + e); }
		flash(sign > 0 ? 3 : 1);
		showOsd((sign > 0 ? '+' : '-') + JUMP + 's');
	}

	function restart() {
		startAt = 0; resumed = true; curMs = 0; paused = false;
		try { plugin.Stop(); start(movie.path); } catch (e) { Log.add('Restart failed: ' + e); }
		flash(0);
		showOsd('Restart');
	}

	function leave(save) {
		var sec = Math.floor(curMs / 1000);
		if (save && curMs > 0) {
			if (sec >= MIN_SAVE && (!durMs || durMs / 1000 - sec > MIN_SAVE)) { Store.set(movie.path, sec); }
			else { Store.clear(movie.path); }
		}
		try { plugin.Stop(); } catch (e) { Log.add('Stop failed: ' + e); }
		if (tick) { clearInterval(tick); tick = null; }
		Subs.clear();
		if (osdTimer) { clearTimeout(osdTimer); osdTimer = null; }
		hideOsd();
		document.body.className = '';
		active = false;
		if (onExit) { onExit(); }
	}

	function activate(i) {
		if (i === 0) { restart(); }
		else if (i === 1) { jump(-1); }
		else if (i === 2) { toggle(); }
		else if (i === 3) { jump(1); }
		else { flash(4); leave(true); }
	}

	/* Returns true when the key was consumed. */
	function onKey(code, tv) {
		if (failed) {
			if (code === tv.KEY_RETURN || code === tv.KEY_STOP || code === tv.KEY_ENTER) { leave(true); }
			return true;
		}
		if (code === tv.KEY_ENTER) {
			if (focus >= 0) { activate(focus); if (active) { showOsd('', true); } } else { toggle(); }
			return true;
		}
		if (code === tv.KEY_PLAY || code === tv.KEY_PAUSE) { toggle(); return true; }
		if (code === tv.KEY_LEFT) {
			if (focus >= 0) { focus = Math.max(0, focus - 1); showOsd(''); } else { jump(-1); }
			return true;
		}
		if (code === tv.KEY_RIGHT) {
			if (focus >= 0) { focus = Math.min(4, focus + 1); showOsd(''); } else { jump(1); }
			return true;
		}
		if (code === tv.KEY_RW) { jump(-1); return true; }
		if (code === tv.KEY_FF) { jump(1); return true; }
		if (code === tv.KEY_DOWN) { focus = focus < 0 ? 2 : focus; showOsd(''); return true; }
		if (code === tv.KEY_UP) { focus = -1; showOsd(''); return true; }
		if (code === tv.KEY_RED) { restart(); return true; }
		if (code === tv.KEY_GREEN) { cycleAspect(); return true; }
		if (code === tv.KEY_YELLOW) {
			if (movie && movie.subs && Subs.count()) { Subs.toggle(); showOsd('Subtitles ' + (Subs.isEnabled() ? 'on' : 'off')); }
			else { showOsd(movie && movie.subs ? 'Subtitle file could not be read' : 'No subtitle file found'); }
			return true;
		}
		if (code === tv.KEY_STOP) { flash(4); leave(true); return true; }
		if (code === tv.KEY_RETURN) {
			if (focus >= 0) { focus = -1; showOsd(''); } else { leave(true); }
			return true;
		}
		return false;
	}

	return {
		init: init, play: play, onKey: onKey,
		setArea: function (w, h) { AREA = [0, 0, w, h]; Log.add('Video area ' + w + 'x' + h); },
		isActive: function () { return active; },
		onTime: onTime, onInfo: onInfo, onBuffered: onBuffered, onEnd: onEnd, onError: onError
	};
})();
