/* On-screen diagnostics (Blue key). Also mirrors to alert() for the TV log. */
var Log = (function () {
	var lines = [];
	var visible = false;
	var MAX = 200;
	var SHOWN = 32;

	function el() { return document.getElementById('log'); }

	function render() {
		var e = el();
		if (!e) { return; }
		e.innerText = lines.slice(-SHOWN).join('\n');
	}

	function add(msg) {
		var d = new Date();
		var t = (d.getMinutes() < 10 ? '0' : '') + d.getMinutes() + ':' + (d.getSeconds() < 10 ? '0' : '') + d.getSeconds();
		lines.push(t + ' ' + msg);
		if (lines.length > MAX) { lines.shift(); }
		try { alert('[MovieShelf] ' + msg); } catch (e1) {}
		if (visible) { render(); }
	}

	function toggle() {
		var e = el();
		visible = !visible;
		if (e) { e.style.display = visible ? 'block' : 'none'; }
		if (visible) { render(); }
	}

	return { add: add, toggle: toggle };
})();
