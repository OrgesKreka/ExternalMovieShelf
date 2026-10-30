/* Tests for the shelf and the details screen: the real main.js, usb.js, store.js and info.js run in a
   sandbox with a fake USB drive, a small fake DOM and fake timers. Run: node test/shelf.test.js */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var JS = path.join(__dirname, '..', 'widget', 'js');
var INFO = 31, YELLOW = 21, LEFT = 4, RIGHT = 5, RETURN = 88, ENTER = 29443;

var A = '/dtv/usb/sda1/Filma/Alien (1979) [tmdbid-348]';
var B = '/dtv/usb/sda1/Filma/Blade Runner (1982)';

function dir(n) { return { name: n, isDir: true }; }
function file(n) { return { name: n, isDir: false }; }

var TREE = {
	'/dtv/usb/sda1': [dir('Filma')],
	'/dtv/usb/sda1/Filma': [dir('Alien (1979) [tmdbid-348]'), dir('Blade Runner (1982)')],
	'/dtv/usb/sda1/Filma/Alien (1979) [tmdbid-348]': [file('alien.mp4'), file('poster.jpg'), file('backdrop.jpg'), file('alien.tmdb.json')],
	'/dtv/usb/sda1/Filma/Blade Runner (1982)': [file('br.mp4')]
};
var FILES = {};
FILES[A + '/alien.tmdb.json'] = JSON.stringify({ format: 2, title: 'Alien', year: '1979', tagline: 'In space...', rating: 8.1, runtime: 117,
	genres: ['Horror', 'Sci-Fi'], directors: ['Ridley Scott'], writers: ['Dan Obannon'], cast: ['Sigourney Weaver', 'Tom Skerritt'], countries: ['United Kingdom'], overview: 'The crew of a ship meets something. ' + new Array(60).join('Long plot text. ') });

function makeEl(tag) {
	var e = { tag: tag, style: {}, className: '', innerText: '', children: [], parentNode: null, _html: '', _a: {}, offsetWidth: 100 };
	Object.defineProperty(e, 'firstChild', { get: function () { return e.children[0] || null; } });
	Object.defineProperty(e, 'lastChild', { get: function () { return e.children[e.children.length - 1] || null; } });
	Object.defineProperty(e, 'innerHTML', {
		get: function () { return e._html; },
		set: function (v) { e._html = v; e.children = []; if (v) { e.children.push(makeEl('div')); e.children.push(makeEl('div')); } }
	});
	e.appendChild = function (c) { c.parentNode = e; e.children.push(c); return c; };
	e.insertBefore = function (c, ref) {
		var i = e.children.indexOf(ref);
		c.parentNode = e;
		e.children.splice(i < 0 ? e.children.length : i, 0, c);
		return c;
	};
	e.removeChild = function (c) { e.children = e.children.filter(function (x) { return x !== c; }); c.parentNode = null; return c; };
	e.getAttribute = function (k) { return e._a[k]; };
	e.setAttribute = function (k, v) { e._a[k] = v; };
	e.focus = function () {};
	e.SetBannerState = function () {};
	return e;
}

/* opts.alienFile: another details file for Alien on the drive. */
function fresh(opts) {
	opts = opts || {};
	var files = {};
	Object.keys(FILES).forEach(function (k) { files[k] = FILES[k]; });
	if (opts.alienFile !== undefined) { files[A + '/alien.tmdb.json'] = opts.alienFile; }
	var els = {}, timers = [], logs = [], played = [], now = 0;
	function el(id) { if (!els[id]) { els[id] = makeEl('div'); els[id].id = id; } return els[id]; }
	function FakeXhr() {}
	FakeXhr.prototype.open = function (m, url) { this.url = url; };
	FakeXhr.prototype.overrideMimeType = function () {};
	FakeXhr.prototype.send = function () {
		var key = decodeURI(this.url.replace('file://', ''));
		this.readyState = 4;
		this.status = files.hasOwnProperty(key) ? 200 : 404;
		this.responseText = files.hasOwnProperty(key) ? files[key] : '';
		this.onreadystatechange();
	};
	function FakeFs() {}
	FakeFs.prototype.readDir = function (p) { return TREE.hasOwnProperty(p) ? TREE[p] : null; };
	FakeFs.prototype.isValidCommonPath = function () { return true; };
	FakeFs.prototype.createCommonDir = function () {};
	FakeFs.prototype.openCommonFile = function () { return null; };

	var ctx = vm.createContext({
		window: { innerWidth: 960, innerHeight: 540 },
		document: { getElementById: el, createElement: makeEl, body: makeEl('body'), documentElement: { clientWidth: 960, clientHeight: 540 } },
		Log: { add: function (m) { logs.push(m); }, toggle: function () {} },
		Player: { init: function () {}, isActive: function () { return false; }, setArea: function () {}, play: function (m) { played.push(m.path); }, onKey: function () { return false; } },
		FileSystem: FakeFs, XMLHttpRequest: FakeXhr, alert: function () {},
		setTimeout: function (fn, ms) { timers.push({ fn: fn, at: now + ms, live: true }); return timers.length - 1; },
		clearTimeout: function (i) { if (timers[i]) { timers[i].live = false; } }
	});
	['usb.js', 'store.js', 'info.js', 'main.js'].forEach(function (f) {
		vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), ctx, { filename: f });
	});
	var t = {
		Main: ctx.Main, Store: ctx.Store, el: el, logs: logs, played: played,
		advance: function (ms) {
			var end = now + ms, next, i;
			for (;;) {
				next = null;
				for (i = 0; i < timers.length; i++) { if (timers[i].live && timers[i].at <= end && (!next || timers[i].at < next.at)) { next = timers[i]; } }
				if (!next) { break; }
				now = next.at; next.live = false; next.fn();
			}
			now = end;
		},
		press: function (code) { ctx.Main.onKeyDown({ keyCode: code }); },
		badge: function (i) {
			var poster = el('grid').children[i].children[0];
			return poster.children.filter(function (c) { return c.className === 'cseen'; })[0];
		}
	};
	t.Main.onLoad();
	t.advance(200);                                                    /* the scan runs after a short delay */
	return t;
}

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

test('the shelf lists the movies in title order', function () {
	var t = fresh();
	assert.equal(t.el('grid').children.length, 2);
	assert.equal(t.el('hCount').innerText, '2 movies');
	assert.equal(t.el('grid').children[0].children[1].innerText, 'Alien');
});

test('a movie that was not watched has no eye badge', function () {
	var t = fresh();
	assert.equal(t.badge(0).style.display, 'none');
	assert.equal(t.badge(1).style.display, 'none');
});

test('the poster image goes under the dimming overlay and the badges', function () {
	var t = fresh();
	var kids = t.el('grid').children[0].children[0].children.map(function (c) { return c.className || c.tag; });
	assert.ok(kids.indexOf('img') >= 0, 'no poster image was added: ' + kids.join());
	assert.ok(kids.indexOf('img') < kids.indexOf('dim'));
	assert.ok(kids.indexOf('dim') < kids.indexOf('cseen'));
});

test('INFO opens the details screen with the details file read from the drive', function () {
	var t = fresh();
	t.press(INFO);
	assert.equal(t.el('info').style.display, 'block');
	assert.equal(t.el('infoTitle').innerText, 'Alien');
	assert.equal(t.el('infoTag').innerText, 'In space...');
	assert.equal(t.el('infoMeta').innerText, ['1979', '1h 57m', '8.1/10', 'Horror, Sci-Fi'].join('  ' + String.fromCharCode(183) + '  '));
	var plot = t.el('infoText').innerText;
	assert.ok(plot.indexOf('The crew of a ship') === 0);
	assert.ok(plot.length <= 433 && /\.\.\.$/.test(plot), 'a long plot is cut with dots');
});

test('the details screen lists director, writer, cast and country', function () {
	var t = fresh();
	t.press(INFO);
	var rows = t.el('infoCredits').children.map(function (r) { return [r.children[0].innerText, r.children[1].innerText]; });
	assert.deepEqual(rows, [['Director', 'Ridley Scott'], ['Writer', "Dan Obannon"], ['Cast', 'Sigourney Weaver, Tom Skerritt'], ['Country', 'United Kingdom']]);
	t.press(RIGHT);                                                    /* the next movie has no details: the rows go away */
	assert.equal(t.el('infoCredits').children.length, 0);
	t.press(LEFT);
	assert.equal(t.el('infoCredits').children.length, 4);
});

test('a movie without a details file says how to get it', function () {
	var t = fresh();
	t.press(RIGHT);
	t.press(INFO);
	assert.equal(t.el('infoTitle').innerText, 'Blade Runner (1982)');
	assert.ok(t.el('infoText').innerText.indexOf('No details for this movie yet') === 0);
	assert.equal(t.el('infoCredits').children.length, 0);
});

test('a details file from an older version still shows what it has', function () {
	var t = fresh({ alienFile: JSON.stringify({ title: 'Alien', year: '1979', overview: 'Old plot.' }) });
	t.press(INFO);
	assert.equal(t.el('infoTitle').innerText, 'Alien');
	assert.equal(t.el('infoText').innerText, 'Old plot.');
	assert.equal(t.el('infoCredits').children.length, 0);         /* no director or cast rows without the data */
});

test('LEFT and RIGHT browse the details, RETURN closes the screen', function () {
	var t = fresh();
	t.press(INFO);
	t.press(RIGHT);
	assert.equal(t.el('infoTitle').innerText, 'Blade Runner (1982)');
	t.press(RIGHT);                                                    /* wraps around */
	assert.equal(t.el('infoTitle').innerText, 'Alien');
	t.press(LEFT);
	assert.equal(t.el('infoTitle').innerText, 'Blade Runner (1982)');
	t.press(RETURN);
	assert.equal(t.el('info').style.display, 'none');
});

test('ENTER on the details screen closes it and plays the movie', function () {
	var t = fresh();
	t.press(INFO);
	t.press(ENTER);
	assert.equal(t.el('info').style.display, 'none');
	assert.deepEqual(t.played, [A + '/alien.mp4']);
});

test('the details screen says whether the movie was watched', function () {
	var t = fresh();
	t.press(INFO);
	assert.ok(t.el('infoSeenText').innerText.indexOf('Not watched yet') === 0);
	assert.equal(t.el('infoSeen').className, '');
	t.Store.setWatched(A + '/alien.mp4', true);
	t.press(RIGHT);
	t.press(LEFT);
	assert.ok(t.el('infoSeenText').innerText.indexOf('Watched.') === 0);
	assert.equal(t.el('infoSeen').className, 'on');
});

test('YELLOW on the details screen flips the mark, and the badge on the poster follows', function () {
	var t = fresh();
	t.press(INFO);
	t.press(YELLOW);
	assert.equal(t.Store.isWatched(A + '/alien.mp4'), true);
	assert.equal(t.el('infoSeen').className, 'on');
	assert.equal(t.badge(0).style.display, 'block');
	assert.equal(t.badge(1).style.display, 'none');
	t.press(YELLOW);
	assert.equal(t.Store.isWatched(A + '/alien.mp4'), false);
	assert.equal(t.badge(0).style.display, 'none');
	assert.ok(t.el('infoSeenText').innerText.indexOf('Not watched yet') === 0);
});

test('the mark belongs to the movie that is showing', function () {
	var t = fresh();
	t.press(INFO);
	t.press(RIGHT);
	t.press(YELLOW);
	assert.equal(t.Store.isWatched(B + '/br.mp4'), true);
	assert.equal(t.Store.isWatched(A + '/alien.mp4'), false);
	assert.equal(t.badge(1).style.display, 'block');
	assert.equal(t.badge(0).style.display, 'none');
});

test('the shelf background gets the backdrop of the selected movie a moment after the selection settles', function () {
	var t = fresh();                                                   /* the scan and the 150 ms delay have passed */
	var bg = t.el('shelf').style;
	var url = 'url("file://' + encodeURI(A + '/backdrop.jpg') + '")';
	assert.ok(bg.backgroundImage.indexOf(url) >= 0, 'the first movie has its backdrop');
	t.press(RIGHT);                                                    /* Blade Runner has none: the picture goes at once */
	assert.ok(bg.backgroundImage.indexOf('url(') < 0);
	t.press(LEFT);                                                     /* back to Alien: not instantly... */
	assert.ok(bg.backgroundImage.indexOf('url(') < 0);
	t.advance(300);                                                    /* ...but once the selection has settled */
	assert.ok(bg.backgroundImage.indexOf(url) >= 0);
});

var failed = 0;
tests.forEach(function (t) {
	try { t.fn(); } catch (e) { failed++; console.log('FAIL  ' + t.name + '\n      ' + (e && e.message ? e.message.split('\n')[0] : e)); }
});
if (failed) { console.log(failed + ' of ' + tests.length + ' shelf tests failed'); process.exit(1); }
console.log('shelf.test.js: all ' + tests.length + ' tests passed');
