/* Tests for the saved positions (store.js) with an in-memory stand-in for the TV's FileSystem.
   Run: node test/store.test.js */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var SOURCE = fs.readFileSync(path.join(__dirname, '..', 'widget', 'js', 'store.js'), 'utf8');

/* `initial` is the text of resume.json on the TV (or null for no file yet). */
function fresh(initial) {
	var file = { text: initial, writes: 0 }, logs = [];
	function FakeFs() {}
	FakeFs.prototype.isValidCommonPath = function () { return true; };
	FakeFs.prototype.createCommonDir = function () {};
	FakeFs.prototype.openCommonFile = function (name, mode) {
		return { readAll: function () { return file.text; }, writeAll: function (t) { file.text = t; file.writes++; } };
	};
	FakeFs.prototype.closeCommonFile = function () {};
	var ctx = vm.createContext({ FileSystem: FakeFs, Log: { add: function (m) { logs.push(m); } } });
	vm.runInContext(SOURCE, ctx);
	return { Store: ctx.Store, file: file, logs: logs, saved: function () { return JSON.parse(file.text); } };
}

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

var P = '/dtv/usb/sda1/Filma/Rope/rope.mp4';

test('positions, watched marks and picture shapes survive a restart', function () {
	var a = fresh(null);
	a.Store.load();
	a.Store.set(P, 300);
	a.Store.setWatched(P, true);
	a.Store.set('aspect:' + a.Store.norm(P), 2);
	var b = fresh(a.file.text);
	b.Store.load();
	assert.equal(b.Store.get(P), 300);
	assert.equal(b.Store.isWatched(P), true);
	assert.equal(b.Store.get('aspect:' + b.Store.norm(P)), 2);
});

test('details that version 0.2.8 saved here are removed once, and nothing else is touched', function () {
	var t = fresh(JSON.stringify({
		'/Filma/Rope/rope.mp4': 300, 'watched:/Filma/Rope/rope.mp4': 1, 'aspect:/Filma/Rope/rope.mp4': 2,
		'details:348': { format: 2, title: 'Alien' }, 'details:78': { format: 2, title: 'Blade Runner' }
	}));
	t.Store.load();
	assert.equal(t.Store.get('details:348'), 0);
	assert.equal(t.Store.get('details:78'), 0);
	assert.equal(t.Store.get(P), 300);
	assert.equal(t.Store.isWatched(P), true);
	var saved = t.saved();
	assert.deepEqual(Object.keys(saved).sort(), ['/Filma/Rope/rope.mp4', 'aspect:/Filma/Rope/rope.mp4', 'watched:/Filma/Rope/rope.mp4']);
	assert.equal(t.file.writes, 1);
	assert.ok(t.logs.some(function (l) { return l.indexOf('removed 2 saved details') >= 0; }));
});

test('a file without old details is not rewritten at start', function () {
	var t = fresh(JSON.stringify({ '/Filma/Rope/rope.mp4': 300 }));
	t.Store.load();
	assert.equal(t.file.writes, 0);
	assert.equal(t.Store.get(P), 300);
});

test('a missing or damaged file starts empty without failing', function () {
	var none = fresh(null);
	none.Store.load();
	assert.equal(none.Store.get(P), 0);
	var bad = fresh('this is not json');
	bad.Store.load();
	assert.equal(bad.Store.get(P), 0);
	assert.ok(bad.logs.some(function (l) { return l.indexOf('Store load failed') >= 0; }));
});

test('the mount name does not matter for positions', function () {
	var t = fresh(null);
	t.Store.load();
	t.Store.set('/dtv/usb/sda1/Filma/Rope/rope.mp4', 120);
	assert.equal(t.Store.get('/dtv/usb/sdb1/Filma/Rope/rope.mp4'), 120);
	assert.equal(t.Store.get('$USB_DIR/sda1/Filma/Rope/rope.mp4'), 120);
});

var failed = 0;
tests.forEach(function (t) {
	try { t.fn(); } catch (e) { failed++; console.log('FAIL  ' + t.name + '\n      ' + (e && e.message ? e.message.split('\n')[0] : e)); }
});
if (failed) { console.log(failed + ' of ' + tests.length + ' store tests failed'); process.exit(1); }
console.log('store.test.js: all ' + tests.length + ' tests passed');
