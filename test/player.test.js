/* Tests for the playback logic. The real store.js, subs.js and player.js run in a sandbox with a fake
   TV plugin, fake DOM elements and fake timers, so no TV is needed. Run: node test/player.test.js */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var JS = path.join(__dirname, '..', 'widget', 'js');
var TV = { KEY_LEFT: 4, KEY_RIGHT: 5, KEY_UP: 29460, KEY_DOWN: 29461, KEY_ENTER: 29443, KEY_PLAY: 71, KEY_PAUSE: 74,
	KEY_STOP: 70, KEY_RW: 69, KEY_FF: 72, KEY_RED: 108, KEY_GREEN: 20, KEY_YELLOW: 21, KEY_RETURN: 88 };
var MOVIE = { title: 'Rope', year: '1948', path: '/dtv/usb/sda1/Filma/Rope/rope.mp4', subs: null };

function fakeTimers() {
	var now = 0, id = 0, list = [];
	return {
		setTimeout: function (fn, ms) { list.push({ id: ++id, at: now + ms, fn: fn }); return id; },
		setInterval: function (fn, ms) { list.push({ id: ++id, at: now + ms, fn: fn, every: ms }); return id; },
		clear: function (i) { list = list.filter(function (t) { return t.id !== i; }); },
		advance: function (ms) {
			var end = now + ms, t, i;
			for (;;) {
				t = null;
				for (i = 0; i < list.length; i++) { if (list[i].at <= end && (!t || list[i].at < t.at)) { t = list[i]; } }
				if (!t) { break; }
				now = t.at;
				if (t.every) { t.at += t.every; } else { list = list.filter(function (x) { return x !== t; }); }
				t.fn();
			}
			now = end;
		}
	};
}

/* A new sandbox with the three scripts loaded; `opts.size` is the [w, h] the fake player reports (none: it can't). */
function fresh(opts) {
	opts = opts || {};
	var els = {}, calls = [], logs = [], timers = fakeTimers(), exits = 0;
	function el(id) {
		if (!els[id]) {
			els[id] = { id: id, style: {}, className: '', innerHTML: '', innerText: '', _a: {},
				getAttribute: function (k) { return this._a[k]; }, setAttribute: function (k, v) { this._a[k] = v; }, focus: function () {} };
		}
		return els[id];
	}
	var plugin = el('pluginPlayer');
	plugin.dur = opts.dur === undefined ? 7200000 : opts.dur;
	['Play', 'Stop', 'Pause', 'Resume', 'JumpForward', 'JumpBackward'].forEach(function (n) {
		plugin[n] = function (a) { calls.push(n + (a === undefined ? '' : ':' + a)); };
	});
	plugin.SetDisplayArea = function (x, y, w, h) { calls.push('Area:' + [x, y, w, h].join(',')); };
	plugin.GetDuration = function () { return plugin.dur; };
	if (opts.size) {
		plugin['GetVideo' + 'Width'] = function () { return opts.size[0]; };
		plugin['GetVideo' + 'Height'] = function () { return opts.size[1]; };
	}
	var audio = el('pluginAudio');
	audio.SetUserMute = function () {};
	audio.GetVolume = function () { return 10; };
	audio.GetUserMute = function () { return 0; };

	var ctx = vm.createContext({
		document: { getElementById: el, body: { className: '' } },
		Log: { add: function (m) { logs.push(m); } },
		setTimeout: timers.setTimeout, setInterval: timers.setInterval,
		clearTimeout: timers.clear, clearInterval: timers.clear
	});
	['store.js', 'subs.js', 'player.js'].forEach(function (f) {
		vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), ctx, { filename: f });
	});
	ctx.Player.init(function () { exits++; });
	return {
		P: ctx.Player, Store: ctx.Store, plugin: plugin, calls: calls, logs: logs, timers: timers, el: el,
		body: function () { return ctx.document.body.className; },
		exits: function () { return exits; },
		key: function (code) { return ctx.Player.onKey(code, TV); },
		last: function (prefix) { return calls.filter(function (c) { return c.indexOf(prefix) === 0; }).pop(); },
		has: function (text) { return logs.some(function (l) { return l.indexOf(text) >= 0; }); }
	};
}

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

/* ---- starting ---- */

test('play starts the movie, shows the controls and lets the video through', function () {
	var t = fresh();
	t.P.play(MOVIE);
	assert.ok(t.P.isActive());
	assert.equal(t.last('Play:'), 'Play:' + MOVIE.path);
	assert.equal(t.body(), 'playing osd');
	assert.equal(t.el('osd').style.display, 'block');
	assert.equal(t.el('osdTitle').innerText, 'Rope (1948)');
	assert.equal(t.last('Area:'), 'Area:0,0,960,540');          /* full screen until the size is known */
});

test('the controls hide after 5 seconds of playing', function () {
	var t = fresh();
	t.P.play(MOVIE);
	t.P.onBuffered();
	t.timers.advance(5000);
	assert.equal(t.el('osd').style.display, 'none');
	assert.equal(t.body(), 'playing');
});

test('a paused movie keeps the controls up', function () {
	var t = fresh();
	t.P.play(MOVIE);
	t.P.onBuffered();
	t.key(TV.KEY_ENTER);
	t.timers.advance(20000);
	assert.equal(t.el('osd').style.display, 'block');
	assert.equal(t.el('osdMsg').innerText, 'Paused');
});

/* ---- picture shape ---- */

test('a 4:3 video is pillarboxed in the middle of the screen', function () {
	var t = fresh({ size: [960, 720] });
	t.P.play(MOVIE);
	t.P.onInfo();
	assert.equal(t.last('Area:'), 'Area:120,0,720,540');
});

test('a wide video is letterboxed (the Ben-Hur numbers from the TV log)', function () {
	var t = fresh({ size: [1280, 458] });
	t.P.play(MOVIE);
	t.P.onInfo();
	assert.equal(t.last('Area:'), 'Area:0,98,960,344');
});

test('a 16:9 video fills the screen', function () {
	var t = fresh({ size: [1920, 1080] });
	t.P.play(MOVIE);
	t.P.onInfo();
	assert.equal(t.last('Area:'), 'Area:0,0,960,540');
});

test('when the player cannot report the size, the picture stays full and the method list is logged once', function () {
	var t = fresh();
	t.P.play(MOVIE);
	t.P.onInfo();
	assert.ok(t.has('Video size not available'));
	assert.ok(t.has('Player methods'));
	var n = t.logs.filter(function (l) { return l.indexOf('Player methods') >= 0; }).length;
	t.P.onInfo();
	assert.equal(t.logs.filter(function (l) { return l.indexOf('Player methods') >= 0; }).length, n);
});

test('GREEN picks a shape by hand and the choice is remembered per movie', function () {
	var t = fresh();
	t.P.play(MOVIE);
	t.P.onInfo();
	t.key(TV.KEY_GREEN);                                          /* 16:9 */
	assert.equal(t.last('Area:'), 'Area:0,0,960,540');
	t.key(TV.KEY_GREEN);                                          /* 4:3 */
	assert.equal(t.last('Area:'), 'Area:120,0,720,540');
	assert.equal(t.Store.get('aspect:' + t.Store.norm(MOVIE.path)), 2);
	t.key(TV.KEY_STOP);
	t.P.play(MOVIE);                                              /* same movie again: 4:3 straight away */
	assert.equal(t.last('Area:'), 'Area:120,0,720,540');
});

test('mode Auto goes back to the detected shape after cycling through all of them', function () {
	var t = fresh({ size: [1280, 458] });
	t.P.play(MOVIE);
	t.P.onInfo();
	for (var i = 0; i < 5; i++) { t.key(TV.KEY_GREEN); }          /* 5 modes: back to Auto */
	assert.equal(t.last('Area:'), 'Area:0,98,960,344');
});

/* ---- transport ---- */

test('ENTER, PLAY and PAUSE toggle between pause and resume', function () {
	var t = fresh();
	t.P.play(MOVIE);
	t.P.onBuffered();
	assert.ok(t.key(TV.KEY_ENTER));
	assert.equal(t.last('P'), 'Pause');
	t.key(TV.KEY_PLAY);
	assert.equal(t.last('Re'), 'Resume');
	t.key(TV.KEY_PAUSE);
	assert.equal(t.last('P'), 'Pause');
});

test('LEFT and RIGHT jump 30 seconds, RW and FF too', function () {
	var t = fresh();
	t.P.play(MOVIE);
	t.P.onBuffered();
	t.key(TV.KEY_RIGHT);
	assert.equal(t.last('JumpForward'), 'JumpForward:30');
	t.key(TV.KEY_LEFT);
	assert.equal(t.last('JumpBackward'), 'JumpBackward:30');
	t.key(TV.KEY_FF);
	assert.equal(t.calls.filter(function (c) { return c === 'JumpForward:30'; }).length, 2);
	t.key(TV.KEY_RW);
	assert.equal(t.calls.filter(function (c) { return c === 'JumpBackward:30'; }).length, 2);
});

test('no jump forward past the end of the movie', function () {
	var t = fresh({ dur: 100000 });
	t.P.play(MOVIE);
	t.P.onInfo();
	t.P.onTime(80000);                                            /* 20 s left */
	t.key(TV.KEY_RIGHT);
	assert.equal(t.last('JumpForward'), undefined);
});

test('DOWN selects the buttons, then LEFT/RIGHT move and ENTER presses one', function () {
	var t = fresh();
	t.P.play(MOVIE);
	t.P.onBuffered();
	t.key(TV.KEY_DOWN);                                           /* play/pause button */
	assert.equal(t.el('b2').className.indexOf(' f') >= 0, true);
	t.key(TV.KEY_RIGHT);                                          /* forward button */
	t.key(TV.KEY_ENTER);
	assert.equal(t.last('JumpForward'), 'JumpForward:30');
	assert.ok(t.P.isActive());
	t.key(TV.KEY_RIGHT);                                          /* stop button */
	t.key(TV.KEY_ENTER);
	assert.equal(t.P.isActive(), false);
	assert.equal(t.exits(), 1);
});

test('RETURN with a button selected only deselects it', function () {
	var t = fresh();
	t.P.play(MOVIE);
	t.key(TV.KEY_DOWN);
	t.key(TV.KEY_RETURN);
	assert.ok(t.P.isActive());
	t.key(TV.KEY_RETURN);
	assert.equal(t.P.isActive(), false);
});

test('RED restarts from the beginning', function () {
	var t = fresh();
	t.P.play(MOVIE);
	t.P.onBuffered();
	t.key(TV.KEY_RED);
	assert.equal(t.calls.filter(function (c) { return c.indexOf('Play:') === 0; }).length, 2);
	assert.equal(t.last('Stop'), 'Stop');
});

test('YELLOW says so when there is no subtitle file', function () {
	var t = fresh();
	t.P.play(MOVIE);
	t.key(TV.KEY_YELLOW);
	assert.equal(t.el('osdMsg').innerText, 'No subtitle file found');
});

test('keys the player does not use are left to the shelf', function () {
	var t = fresh();
	t.P.play(MOVIE);
	assert.equal(t.key(99999), false);
});

/* ---- resume ---- */

test('a saved position is jumped to once, after the first buffering', function () {
	var t = fresh();
	t.Store.set(MOVIE.path, 173);
	t.P.play(MOVIE);
	t.P.onBuffered();
	t.P.onBuffered();
	assert.deepEqual(t.calls.filter(function (c) { return c.indexOf('JumpForward') === 0; }), ['JumpForward:173']);
});

test('the saved position survives a different mount name (sda1 -> sdb1)', function () {
	var t = fresh();
	t.Store.set('/dtv/usb/sda1/Filma/Rope/rope.mp4', 400);
	t.P.play({ title: 'Rope', year: '', path: '/dtv/usb/sdb1/Filma/Rope/rope.mp4', subs: null });
	t.P.onBuffered();
	assert.equal(t.last('JumpForward'), 'JumpForward:400');
});

function leaveAt(ms, dur, how) {
	var t = fresh({ dur: dur });
	t.Store.set(MOVIE.path, 999);                                  /* an older position */
	t.P.play(MOVIE);
	t.P.onInfo();
	t.P.onBuffered();
	t.P.onTime(ms);
	t.key(how || TV.KEY_RETURN);
	return t;
}

test('leaving after 5 minutes saves the position', function () {
	assert.equal(leaveAt(300000, 7200000).Store.get(MOVIE.path), 300);
});

test('STOP saves it too', function () {
	assert.equal(leaveAt(300000, 7200000, TV.KEY_STOP).Store.get(MOVIE.path), 300);
});

test('leaving in the first minute forgets an older position instead of keeping it', function () {
	assert.equal(leaveAt(30000, 7200000).Store.get(MOVIE.path), 0);
});

test('leaving in the last minute forgets the position', function () {
	assert.equal(leaveAt(7200000 - 30000, 7200000).Store.get(MOVIE.path), 0);
});

test('leaving before any time was reported keeps the older position', function () {
	assert.equal(leaveAt(0, 7200000).Store.get(MOVIE.path), 999);
});

test('leaving halfway does not mark the movie as watched', function () {
	assert.equal(leaveAt(300000, 7200000).Store.isWatched(MOVIE.path), false);
});

test('leaving in the first minute does not mark it as watched either', function () {
	assert.equal(leaveAt(30000, 7200000).Store.isWatched(MOVIE.path), false);
});

test('stopping in the last minute counts as watched to the end', function () {
	var t = leaveAt(7200000 - 30000, 7200000);
	assert.equal(t.Store.isWatched(MOVIE.path), true);
	assert.equal(t.Store.get(MOVIE.path), 0);                      /* and there is nothing left to resume */
});

test('a one-minute clip stopped at the start is not marked as watched', function () {
	assert.equal(leaveAt(20000, 50000).Store.isWatched(MOVIE.path), false);
});

test('a watched mark stays when the movie is started again and left halfway', function () {
	var t = fresh({ dur: 7200000 });
	t.Store.setWatched(MOVIE.path, true);
	t.P.play(MOVIE);
	t.P.onInfo();
	t.P.onTime(300000);
	t.key(TV.KEY_RETURN);
	assert.equal(t.Store.isWatched(MOVIE.path), true);
	assert.equal(t.Store.get(MOVIE.path), 300);
});

test('the watched mark is keyed without the mount name and can be removed', function () {
	var t = fresh();
	t.Store.setWatched('/dtv/usb/sda1/Filma/Rope/rope.mp4', true);
	assert.equal(t.Store.isWatched('/dtv/usb/sdb1/Filma/Rope/rope.mp4'), true);
	assert.equal(t.Store.isWatched('/dtv/usb/sda1/Filma/Other/other.mp4'), false);
	t.Store.setWatched('/dtv/usb/sdb1/Filma/Rope/rope.mp4', false);
	assert.equal(t.Store.isWatched('/dtv/usb/sda1/Filma/Rope/rope.mp4'), false);
});

test('finishing the movie clears the position and goes back to the shelf', function () {
	var t = fresh();
	t.Store.set(MOVIE.path, 500);
	t.P.play(MOVIE);
	t.P.onEnd();
	assert.equal(t.Store.get(MOVIE.path), 0);
	assert.equal(t.Store.isWatched(MOVIE.path), true);
	assert.equal(t.P.isActive(), false);
	assert.equal(t.exits(), 1);
	assert.equal(t.body(), '');
});

/* ---- leaving and errors ---- */

test('leaving stops the player, hides the controls and calls back once', function () {
	var t = fresh();
	t.P.play(MOVIE);
	t.key(TV.KEY_RETURN);
	assert.equal(t.last('Stop'), 'Stop');
	assert.equal(t.el('osd').style.display, 'none');
	assert.equal(t.body(), '');
	assert.equal(t.exits(), 1);
});

test('callbacks that arrive after leaving are ignored', function () {
	var t = fresh();
	t.P.play(MOVIE);
	t.key(TV.KEY_RETURN);
	var before = t.calls.length;
	t.P.onTime(5000);
	t.P.onInfo();
	t.P.onBuffered();
	t.P.onError('late');
	t.P.onEnd();
	assert.equal(t.calls.length, before);
	assert.equal(t.exits(), 1);
	assert.equal(t.has('Player error'), false);
});

test('a play error retries once with a file:// address, then gives up on screen', function () {
	var t = fresh();
	t.P.play(MOVIE);
	t.P.onError(1);
	assert.equal(t.last('Play:'), 'Play:file://' + encodeURI(MOVIE.path));
	t.P.onError(1);
	assert.ok(t.P.isActive());
	assert.ok(t.el('osdMsg').innerText.indexOf('Cannot play this file') === 0);
	assert.ok(t.key(TV.KEY_ENTER));                               /* any of ENTER / RETURN / STOP leaves */
	assert.equal(t.P.isActive(), false);
});

test('a throwing player does not crash the page', function () {
	var t = fresh();
	t.plugin.Play = function () { throw new Error('boom'); };
	t.P.play(MOVIE);                                              /* onError path, then the retry throws too */
	assert.ok(t.has('Play threw') || t.has('file:// retry threw'));
});

/* ---- run ---- */

var failed = 0;
tests.forEach(function (t) {
	try { t.fn(); } catch (e) { failed++; console.log('FAIL  ' + t.name + '\n      ' + (e && e.message ? e.message.split('\n')[0] : e)); }
});
if (failed) { console.log(failed + ' of ' + tests.length + ' player tests failed'); process.exit(1); }
console.log('player.test.js: all ' + tests.length + ' tests passed');
