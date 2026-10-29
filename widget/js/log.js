/* On-screen diagnostics (Blue key). Also mirrors to alert() for the TV log. Opening the log sends it to the
   PC that serves the widget (tools/serve.py saves it under tools/_logs/). */
var Log = (function () {
	var lines = [];
	var visible = false;
	var MAX = 200;
	var SHOWN = 32;
	var SEND_TIMEOUT = 8000;

	function el() { return document.getElementById('log'); }

	function render() {
		var e = el();
		if (!e) { return; }
		e.innerText = lines.slice(-SHOWN).join('\n');
	}

	function stamp() {
		var d = new Date();
		return (d.getMinutes() < 10 ? '0' : '') + d.getMinutes() + ':' + (d.getSeconds() < 10 ? '0' : '') + d.getSeconds();
	}

	function push(msg) {
		lines.push(stamp() + ' ' + msg);
		if (lines.length > MAX) { lines.shift(); }
		if (visible) { render(); }
	}

	function add(msg) {
		push(msg);
		try { alert('[MovieShelf] ' + msg); } catch (e1) {}
	}

	/* POSTs every line to the address serve.py wrote into js/build.js, and notes the outcome in the log. */
	function send() {
		var url = (typeof BUILD !== 'undefined' && BUILD && BUILD.logUrl) ? BUILD.logUrl : '';
		var x, done = false, count = lines.length, timer;

		function finish(ok, why) {
			if (done) { return; }
			done = true;
			clearTimeout(timer);
			push(ok ? 'Log sent to the PC (' + count + ' lines)' : 'Sending the log failed: ' + why + '. Is serve.py still running?');
		}

		if (!url) { push('Log not sent: this build has no PC address (start it with tools/serve.py)'); return; }
		try {
			x = new XMLHttpRequest();
			x.open('POST', url, true);
			x.setRequestHeader('Content-Type', 'text/plain; charset=utf-8');
			x.onreadystatechange = function () {
				if (x.readyState === 4) { finish(x.status === 200, 'HTTP ' + x.status); }
			};
			timer = setTimeout(function () { try { x.abort(); } catch (e2) {} finish(false, 'no answer from ' + url); }, SEND_TIMEOUT);
			x.send(lines.join('\n'));
		} catch (e) {
			finish(false, e);
		}
	}

	function toggle() {
		var e = el();
		visible = !visible;
		if (e) { e.style.display = visible ? 'block' : 'none'; }
		if (visible) { render(); send(); }
	}

	return { add: add, toggle: toggle, send: send };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = Log; }
