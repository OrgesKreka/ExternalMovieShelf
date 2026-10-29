/* Tests for the volume keys and the volume bar. The real main.js runs in a sandbox with a fake audio
   plugin, fake DOM elements and fake timers. Run: node test/volume.test.js */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var SOURCE = fs.readFileSync(path.join(__dirname, '..', 'widget', 'js', 'main.js'), 'utf8');
var UP = 7, DOWN = 11, MUTE = 27, LEFT = 4;

/* opts.volume: starting level; opts.muted: starting mute; opts.broken: the audio plugin throws */
function fresh(opts) {
	opts = opts || {};
	var els = {}, timers = [], logs = [], state = { volume: opts.volume === undefined ? 14 : opts.volume, muted: opts.muted ? 1 : 0 }, calls = [];
	function el(id) {
		if (!els[id]) { els[id] = { id: id, style: {}, className: '', innerText: '', innerHTML: '', focus: function () {} }; }
		return els[id];
	}
	var audio = el('pluginAudio');
	audio.GetVolume = function () { if (opts.broken) { throw new Error('no audio'); } return state.volume; };
	audio.GetUserMute = function () { return state.muted; };
	audio.SetUserMute = function (m) { calls.push('mute:' + m); state.muted = m; };
	audio.SetVolumeWithKey = function (d) {          /* 0 = up, 1 = down, like the real plugin */
		calls.push('key:' + d);
		state.volume = Math.max(0, Math.min(100, state.volume + (d === 0 ? 1 : -1)));
	};
	var ctx = vm.createContext({
		window: {},
		document: { getElementById: el },
		Log: { add: function (m) { logs.push(m); } },
		Player: { isActive: function () { return false; }, setArea: function () {}, init: function () {} },
		Store: {}, Usb: {}, Info: {},
		setTimeout: function (fn, ms) { timers.push({ fn: fn, ms: ms, live: true }); return timers.length - 1; },
		clearTimeout: function (i) { if (timers[i]) { timers[i].live = false; } }
	});
	vm.runInContext(SOURCE, ctx, { filename: 'main.js' });
	return {
		press: function (code) { ctx.Main.onKeyDown({ keyCode: code }); },
		el: el, state: state, calls: calls, logs: logs,
		hide: function () { timers.forEach(function (t) { if (t.live) { t.live = false; t.fn(); } }); },
		lastTimerMs: function () { return timers.length ? timers[timers.length - 1].ms : null; }
	};
}

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

test('volume up raises the level by one and shows the bar with the number', function () {
	var t = fresh({ volume: 14 });
	t.press(UP);
	assert.equal(t.state.volume, 15);
	assert.equal(t.el('vol').style.display, 'block');
	assert.equal(t.el('volLabel').innerText, 'Volume');
	assert.equal(t.el('volIcon').src, 'img/vol-on.png');
	assert.equal(t.el('volNum').innerText, '15');
	assert.equal(t.el('volFill').style.width, Math.round(15 * 2.28) + 'px');
});

test('volume down lowers it', function () {
	var t = fresh({ volume: 14 });
	t.press(DOWN);
	assert.equal(t.state.volume, 13);
	assert.equal(t.el('volNum').innerText, '13');
});

test('the bar fills in proportion: 0 is empty, 100 is the whole track', function () {
	var low = fresh({ volume: 1 });
	low.press(DOWN);
	assert.equal(low.el('volNum').innerText, '0');
	assert.equal(low.el('volFill').style.width, '0px');
	var high = fresh({ volume: 99 });
	high.press(UP);
	assert.equal(high.el('volNum').innerText, '100');
	assert.equal(high.el('volFill').style.width, '228px');            /* the track is 228 px wide */
});

test('the level stops at the ends', function () {
	var t = fresh({ volume: 100 });
	t.press(UP);
	assert.equal(t.el('volNum').innerText, '100');
	var z = fresh({ volume: 0 });
	z.press(DOWN);
	assert.equal(z.el('volNum').innerText, '0');
});

test('mute shows MUTE in the bar, and pressing it again shows the level again', function () {
	var t = fresh({ volume: 14 });
	t.press(MUTE);
	assert.equal(t.state.muted, 1);
	assert.equal(t.el('volLabel').innerText, 'Muted');
	assert.equal(t.el('volNum').innerText, 'MUTE');
	assert.equal(t.el('volIcon').src, 'img/vol-mute.png');
	assert.equal(t.el('vol').className, 'muted');
	assert.equal(t.el('volFill').className, 'muted');
	t.press(MUTE);
	assert.equal(t.state.muted, 0);
	assert.equal(t.el('volLabel').innerText, 'Volume');
	assert.equal(t.el('volIcon').src, 'img/vol-on.png');
	assert.equal(t.el('volNum').innerText, '14');
	assert.equal(t.el('vol').className, '');
});

test('changing the volume while muted ends the mute', function () {
	var t = fresh({ volume: 14, muted: true });
	t.press(UP);
	assert.equal(t.state.muted, 0);
	assert.equal(t.state.volume, 15);
	assert.equal(t.el('volNum').innerText, '15');
});

test('the bar goes away after 2.5 seconds, and a new press keeps it up longer', function () {
	var t = fresh();
	t.press(UP);
	assert.equal(t.lastTimerMs(), 2500);
	t.press(UP);                                                       /* the first timer is cancelled by the second press */
	t.hide();
	assert.equal(t.el('vol').style.display, 'none');
});

test('every press is logged with the before and after level', function () {
	var t = fresh({ volume: 14 });
	t.press(UP);
	assert.ok(t.logs.some(function (l) { return l.indexOf('Volume key 7 reached the widget: volume 14 -> 15, muted 0') >= 0; }));
});

test('other keys do not touch the volume or the bar', function () {
	var t = fresh();
	t.press(LEFT);
	assert.equal(t.calls.length, 0);
	assert.equal(t.el('vol').style.display, undefined);
});

test('a broken audio plugin is logged and does not crash the key handler', function () {
	var t = fresh({ broken: true });
	t.press(UP);
	assert.ok(t.logs.some(function (l) { return l.indexOf('Volume key 7 failed') >= 0; }));
	assert.equal(t.el('vol').style.display, undefined);
});

var failed = 0;
tests.forEach(function (t) {
	try { t.fn(); } catch (e) { failed++; console.log('FAIL  ' + t.name + '\n      ' + (e && e.message ? e.message.split('\n')[0] : e)); }
});
if (failed) { console.log(failed + ' of ' + tests.length + ' volume tests failed'); process.exit(1); }
console.log('volume.test.js: all ' + tests.length + ' tests passed');
