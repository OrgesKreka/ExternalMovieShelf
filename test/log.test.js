/* Tests for the on-screen log and its upload to the PC (BLUE key). Run: node test/log.test.js */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var SOURCE = fs.readFileSync(path.join(__dirname, '..', 'widget', 'js', 'log.js'), 'utf8');

/* opts.build: the BUILD object serve.py writes (none: a build without it); opts.xhr: 'ok' | 500 | 'silent' | 'throw' */
function fresh(opts) {
	opts = opts || {};
	var sent = [], timers = [], panel = { style: {}, innerText: '' };
	function FakeXhr() {
		this.headers = {};
		this.aborted = false;
		sent.push(this);
		if (opts.xhr === 'throw') { throw new Error('no network'); }
	}
	FakeXhr.prototype.open = function (method, url) { this.method = method; this.url = url; };
	FakeXhr.prototype.setRequestHeader = function (k, v) { this.headers[k] = v; };
	FakeXhr.prototype.abort = function () { this.aborted = true; };
	FakeXhr.prototype.send = function (body) {
		var self = this;
		this.body = body;
		if (opts.xhr === 'silent' || opts.xhr === 'throw') { return; }
		this.readyState = 4;
		this.status = opts.xhr === 500 ? 500 : 200;
		setImmediateSafe(function () { self.onreadystatechange(); });
	};
	/* answers synchronously after send() returns, like a very fast network */
	var queue = [];
	function setImmediateSafe(fn) { queue.push(fn); }

	var ctx = vm.createContext({
		document: { getElementById: function () { return panel; } },
		XMLHttpRequest: FakeXhr,
		alert: function () {},
		setTimeout: function (fn, ms) { timers.push({ fn: fn, ms: ms, live: true }); return timers.length - 1; },
		clearTimeout: function (i) { if (timers[i]) { timers[i].live = false; } }
	});
	if (opts.build !== null) { vm.runInContext('var BUILD = ' + JSON.stringify(opts.build || { logUrl: 'http://192.168.2.156:80/log' }) + ';', ctx); }
	vm.runInContext(SOURCE, ctx);
	return {
		Log: ctx.Log, sent: sent, panel: panel,
		answer: function () { while (queue.length) { queue.shift()(); } },
		timeout: function () { timers.forEach(function (t) { if (t.live) { t.live = false; t.fn(); } }); },
		timerMs: function () { return timers.length ? timers[0].ms : null; },
		text: function () { return panel.innerText; }
	};
}

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

test('opening the log posts every line to the address from build.js', function () {
	var t = fresh();
	t.Log.add('first');
	t.Log.add('second');
	t.Log.toggle();
	assert.equal(t.sent.length, 1);
	assert.equal(t.sent[0].method, 'POST');
	assert.equal(t.sent[0].url, 'http://192.168.2.156:80/log');
	assert.equal(t.sent[0].headers['Content-Type'], 'text/plain; charset=utf-8');
	var lines = t.sent[0].body.split('\n');
	assert.equal(lines.length, 2);
	assert.ok(/^\d\d:\d\d first$/.test(lines[0]));
	assert.ok(/ second$/.test(lines[1]));
	assert.equal(t.panel.style.display, 'block');
});

test('a successful send is noted in the log', function () {
	var t = fresh();
	t.Log.add('a');
	t.Log.toggle();
	t.answer();
	assert.ok(t.text().indexOf('Log sent to the PC (1 lines)') >= 0);
});

test('closing the log sends nothing', function () {
	var t = fresh();
	t.Log.toggle();
	t.answer();
	t.Log.toggle();
	assert.equal(t.sent.length, 1);
	assert.equal(t.panel.style.display, 'none');
});

test('opening it again sends again, with the lines added since', function () {
	var t = fresh();
	t.Log.add('one');
	t.Log.toggle();
	t.answer();
	t.Log.toggle();
	t.Log.add('two');
	t.Log.toggle();
	assert.equal(t.sent.length, 2);
	assert.ok(t.sent[1].body.indexOf(' two') > 0);
});

test('an HTTP error is reported on screen', function () {
	var t = fresh({ xhr: 500 });
	t.Log.toggle();
	t.answer();
	assert.ok(t.text().indexOf('Sending the log failed: HTTP 500') >= 0);
	assert.ok(t.text().indexOf('serve.py') >= 0);
});

test('no answer within 8 seconds aborts and reports', function () {
	var t = fresh({ xhr: 'silent' });
	t.Log.toggle();
	assert.equal(t.timerMs(), 8000);
	t.timeout();
	assert.ok(t.sent[0].aborted);
	assert.ok(t.text().indexOf('no answer from http://192.168.2.156:80/log') >= 0);
});

test('a late answer after the timeout does not report twice', function () {
	var t = fresh({ xhr: 'silent' });
	t.Log.toggle();
	t.timeout();
	t.sent[0].readyState = 4;
	t.sent[0].status = 200;
	t.sent[0].onreadystatechange();
	assert.equal(t.text().split('\n').filter(function (l) { return l.indexOf('Log sent') >= 0; }).length, 0);
});

test('a throwing XMLHttpRequest does not break the log', function () {
	var t = fresh({ xhr: 'throw' });
	t.Log.add('x');
	t.Log.toggle();
	assert.ok(t.text().indexOf('Sending the log failed: Error: no network') >= 0);
});

test('a build without an address says so instead of failing', function () {
	var t = fresh({ build: null });
	t.Log.toggle();
	assert.equal(t.sent.length, 0);
	assert.ok(t.text().indexOf('Log not sent') >= 0);
});

test('the panel shows the last 32 lines and the upload keeps the last 200', function () {
	var t = fresh();
	for (var i = 0; i < 250; i++) { t.Log.add('line ' + i); }
	t.Log.toggle();
	var shown = t.text().split('\n');
	assert.ok(shown.length >= 32 && shown.length <= 33);          /* 32 lines, plus the send note appended afterwards */
	assert.ok(/line 249$/.test(shown[shown.length - 1]) || t.text().indexOf('line 249') > 0);
	var sentLines = t.sent[0].body.split('\n');
	assert.equal(sentLines.length, 200);
	assert.ok(/line 50$/.test(sentLines[0]));
});

var failed = 0;
tests.forEach(function (t) {
	try { t.fn(); } catch (e) { failed++; console.log('FAIL  ' + t.name + '\n      ' + (e && e.message ? e.message.split('\n')[0] : e)); }
});
if (failed) { console.log(failed + ' of ' + tests.length + ' log tests failed'); process.exit(1); }
console.log('log.test.js: all ' + tests.length + ' tests passed');
