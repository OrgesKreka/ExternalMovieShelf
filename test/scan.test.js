var assert = require('assert');
var Usb = require('../widget/js/usb.js');

function dir(name) { return { name: name, isDir: true }; }
function file(name) { return { name: name, isDir: false }; }

var tree = {
	'/dtv/usb/sda1': [
		dir('The.Matrix.1999.1080p.BluRay.x264'), dir('Alien (1979)'), dir('Trilogy'), dir('.hidden'),
		dir('System Volume Information'), dir('deep'), file('loose.clip.mp4')
	],
	'/dtv/usb/sda1/The.Matrix.1999.1080p.BluRay.x264': [file('matrix.mp4'), file('folder.jpg'), file('other.png')],
	'/dtv/usb/sda1/Alien (1979)': [file('alien.mp4'), file('alien.png'), file('poster.jpg')],
	'/dtv/usb/sda1/Trilogy': [file('Part 1.mp4'), file('Part 1.jpg'), file('Part 2.mp4'), file('poster.jpg')],
	'/dtv/usb/sda1/.hidden': [file('secret.mp4')],
	'/dtv/usb/sda1/System Volume Information': [file('x.mp4')],
	'/dtv/usb/sda1/deep': [dir('a')],
	'/dtv/usb/sda1/deep/a': [dir('b')],
	'/dtv/usb/sda1/deep/a/b': [dir('c')],
	'/dtv/usb/sda1/deep/a/b/c': [dir('Four Deep')],
	'/dtv/usb/sda1/deep/a/b/c/Four Deep': [file('f.mp4')]
};

function readDir(p) { return tree[p] || null; }

// titles
assert.deepEqual(Usb.cleanTitle('The.Matrix.1999.1080p.BluRay.x264'), { title: 'The Matrix', year: '1999' });
assert.deepEqual(Usb.cleanTitle('Blade Runner 2049 (2017) 1080p'), { title: 'Blade Runner 2049', year: '2017' });
assert.deepEqual(Usb.cleanTitle('2012'), { title: '2012', year: '' });
assert.deepEqual(Usb.cleanTitle('Heat (1995) [tmdbid-949]'), { title: 'Heat', year: '1995' });
assert.deepEqual(Usb.cleanTitle('Alien {tmdb-348} [imdbid-tt0078748]'), { title: 'Alien', year: '' });
assert.deepEqual(Usb.cleanTitle('Some_Film_720p_x264'), { title: 'Some Film', year: '' });
assert.deepEqual(Usb.cleanTitle('Spider-Man'), { title: 'Spider-Man', year: '' });

// sorting
assert.equal(Usb.sortKey('The Matrix'), 'the matrix');
assert.ok(Usb.sortKey('École') < Usb.sortKey('Fargo'));
assert.ok(Usb.sortKey('Part 2') < Usb.sortKey('Part 10'));
assert.ok(Usb.sortKey('Alien') < Usb.sortKey('The Matrix'));

// poster preference
assert.equal(Usb.pickPoster(['z.jpg', 'cover.png', 'poster.jpg'], 'm', false), 'poster.jpg');
assert.equal(Usb.pickPoster(['z.jpg', 'm.png', 'poster.jpg'], 'm', false), 'm.png');
assert.equal(Usb.pickPoster(['z.jpg', 'a.jpg'], 'm', false), 'a.jpg');
assert.equal(Usb.pickPoster(['poster.jpg'], 'm', true), null);

// scan
var movies = Usb.scan(readDir, ['/dtv/usb/sda1']);
var byTitle = {};
movies.forEach(function (m) { byTitle[m.title] = m; });
var titles = movies.map(function (m) { return m.title; });

assert.deepEqual(titles, ['Alien', 'loose clip', 'Part 1', 'Part 2', 'The Matrix']);
assert.equal(byTitle['The Matrix'].poster, '/dtv/usb/sda1/The.Matrix.1999.1080p.BluRay.x264/folder.jpg');
assert.equal(byTitle['The Matrix'].path, '/dtv/usb/sda1/The.Matrix.1999.1080p.BluRay.x264/matrix.mp4');
assert.equal(byTitle['Alien'].year, '1979');
assert.equal(byTitle['Alien'].poster, '/dtv/usb/sda1/Alien (1979)/alien.png');
assert.equal(byTitle['Part 1'].poster, '/dtv/usb/sda1/Trilogy/Part 1.jpg');
assert.equal(byTitle['Part 2'].poster, null);
assert.equal(byTitle['loose clip'].poster, null);
assert.ok(!byTitle['Four Deep'], 'movies deeper than 4 levels are skipped');

// a "Filma" folder restricts the scan to itself
var tree2 = {
	'/dtv/usb/sdb1': [dir('Other'), dir('Filma')],
	'/dtv/usb/sdb1/Other': [dir('Nope')],
	'/dtv/usb/sdb1/Other/Nope': [file('n.mp4')],
	'/dtv/usb/sdb1/Filma': [dir('Heat.1995')],
	'/dtv/usb/sdb1/Filma/Heat.1995': [file('heat.mp4'), file('poster.jpg')]
};
var m2 = Usb.scan(function (p) { return tree2[p] || null; }, ['/dtv/usb/sdb1']);
assert.deepEqual(m2.map(function (m) { return m.title; }), ['Heat']);

// nested Filma, with a stray video directly inside it
var tree3 = {
	'/r': [dir('Stuff'), dir('Backup')],
	'/r/Stuff': [dir('Filma')],
	'/r/Stuff/Filma': [file('stray.mp4'), dir('Heat.1995'), dir('Alien (1979)')],
	'/r/Stuff/Filma/Heat.1995': [file('heat.mp4')],
	'/r/Stuff/Filma/Alien (1979)': [file('alien.mp4')],
	'/r/Backup': [dir('Old')],
	'/r/Backup/Old': [file('old.mp4')]
};
var m3 = Usb.scan(function (p) { return tree3[p] || null; }, ['/r']);
assert.deepEqual(m3.map(function (m) { return m.title; }), ['Alien', 'Heat', 'stray']);

// the TV's readDir format: "./", "../", folders as "name/"
var fakeFs = { readDir: function (p) {
	return p === '/x' ? [{ name: './' }, { name: '../' }, { name: 'Filma/' }, { name: 'a.mp4', isDir: false }] : null;
} };
assert.deepEqual(Usb.makeReader(fakeFs)('/x'), [{ name: 'Filma', isDir: true }, { name: 'a.mp4', isDir: false }]);

// subtitles
assert.equal(Usb.pickSub(['b.srt', 'a.srt'], 'm', true), 'a.srt');
assert.equal(Usb.pickSub(['b.srt', 'm.srt'], 'm', true), 'm.srt');
assert.equal(Usb.pickSub(['m.sq.srt', 'z.srt'], 'm', false), 'm.sq.srt');
assert.equal(Usb.pickSub(['z.srt'], 'm', false), null);
var tree4 = {
	'/s': [dir('Heat.1995'), dir('Pack')],
	'/s/Heat.1995': [file('heat.mp4'), file('anything.srt')],
	'/s/Pack': [file('One.mp4'), file('Two.mp4'), file('One.srt'), file('other.srt')]
};
var m4 = Usb.scan(function (p) { return tree4[p] || null; }, ['/s']);
var by4 = {}; m4.forEach(function (m) { by4[m.title] = m; });
assert.equal(by4['Heat'].subs, '/s/Heat.1995/anything.srt');
assert.equal(by4['One'].subs, '/s/Pack/One.srt');
assert.equal(by4['Two'].subs, null);

// SRT parser
var Subs = require('../widget/js/subs.js');
var cues = Subs.parse('﻿1\r\n00:00:01,000 --> 00:00:03,500\r\n<i>Hello</i>\r\n{\\an8}world\r\n\r\n2\r\n00:01:02,5 --> 00:01:04,000\r\nSecond\r\n\r\nbroken block\r\n');
assert.equal(cues.length, 2);
assert.deepEqual([cues[0].start, cues[0].end, cues[0].text], [1000, 3500, 'Hello\nworld']);
assert.deepEqual([cues[1].start, cues[1].end, cues[1].text], [62500, 64000, 'Second']);

// requireDir: drive present but no Filma folder -> flagged, nothing scanned
var strict = Usb.scan(function (p) { return tree[p] || null; }, ['/dtv/usb/sda1'], true);
assert.equal(strict.length, 0);
assert.equal(strict.noMovieDir, true);
var strict2 = Usb.scan(function (p) { return tree2[p] || null; }, ['/dtv/usb/sdb1'], true);
assert.equal(strict2.noMovieDir, false);
assert.equal(strict2.length, 1);
assert.equal(Usb.scan(function () { return null; }, [], true).noMovieDir, true);

// widget scripts must stay ASCII-only: the TV may decode them with the wrong charset
var fs = require('fs'), path = require('path');
fs.readdirSync(path.join(__dirname, '..', 'widget', 'js')).forEach(function (f) {
	var text = fs.readFileSync(path.join(__dirname, '..', 'widget', 'js', f), 'utf8');
	for (var i = 0; i < text.length; i++) { assert.ok(text.charCodeAt(i) < 128, f + ' has a non-ASCII character at ' + i + '; use \\uXXXX'); }
});

// accents fold and the BOM / replacement-character checks still work as escapes
assert.equal(Usb.sortKey('\u00c9cole'), 'ecole');

// a drive with a partition is found once, not as sda1 and sda
var mounts = { '/dtv/usb/sda1': [], '/dtv/usb/sda': [] };
var found = Usb.findRoots(null, function (p) { return mounts.hasOwnProperty(p) ? mounts[p] : null; });
assert.deepEqual(found, ['/dtv/usb/sda1']);
var bare = Usb.findRoots(null, function (p) { return p === '/dtv/usb/sda' ? [] : null; });
assert.deepEqual(bare, ['/dtv/usb/sda']);

console.log('scan.test.js: all passed (' + movies.length + ' movies)');

// backdrops and details files from tools/tmdb_posters.py
var side = {
	'/dtv/usb/sda1': [dir('Filma')],
	'/dtv/usb/sda1/Filma': [dir('Heat (1995) [tmdbid-949]'), dir('Only Backdrop'), dir('Pair')],
	'/dtv/usb/sda1/Filma/Heat (1995) [tmdbid-949]': [file('heat.mp4'), file('poster.jpg'), file('heat.backdrop.jpg'), file('heat.tmdb.json')],
	'/dtv/usb/sda1/Filma/Only Backdrop': [file('x.mp4'), file('x.backdrop.jpg')],
	'/dtv/usb/sda1/Filma/Pair': [file('a.mp4'), file('b.mp4'), file('b.backdrop.jpg'), file('b.tmdb.json'), file('a.tmdb.json')]
};
var sideMovies = Usb.scan(function (p) { return side[p] || null; }, ['/dtv/usb/sda1'], true);
var sideBy = {};
sideMovies.forEach(function (m) { sideBy[m.path.split('/').pop()] = m; });
var heat = sideBy['heat.mp4'];
assert.equal(heat.poster, '/dtv/usb/sda1/Filma/Heat (1995) [tmdbid-949]/poster.jpg');
assert.equal(heat.backdrop, '/dtv/usb/sda1/Filma/Heat (1995) [tmdbid-949]/heat.backdrop.jpg');
assert.equal(heat.info, '/dtv/usb/sda1/Filma/Heat (1995) [tmdbid-949]/heat.tmdb.json');
assert.equal(sideBy['x.mp4'].poster, null, 'a backdrop must never be used as the poster');
assert.equal(sideBy['x.mp4'].backdrop, '/dtv/usb/sda1/Filma/Only Backdrop/x.backdrop.jpg');
assert.equal(sideBy['x.mp4'].info, null);
assert.equal(sideBy['a.mp4'].backdrop, null, 'several videos: only the file named after the video counts');
assert.equal(sideBy['a.mp4'].info, '/dtv/usb/sda1/Filma/Pair/a.tmdb.json');
assert.equal(sideBy['b.mp4'].backdrop, '/dtv/usb/sda1/Filma/Pair/b.backdrop.jpg');
assert.equal(Usb.pickSide(['Only.tmdb.json'], 'renamed', '.tmdb.json', true), 'Only.tmdb.json');
assert.equal(Usb.pickSide(['Only.tmdb.json'], 'renamed', '.tmdb.json', false), null);
assert.equal(Usb.pickSide(['HEAT.TMDB.JSON'], 'heat', '.tmdb.json', false), 'HEAT.TMDB.JSON');

// the version shown on the shelf must equal the one in config.xml (serve.py names the zip after config.xml)
var cfgText = fs.readFileSync(path.join(__dirname, '..', 'widget', 'config.xml'), 'utf8');
var mainText = fs.readFileSync(path.join(__dirname, '..', 'widget', 'js', 'main.js'), 'utf8');
var cfgVer = /<ver[^>]*>([^<]+)<\/ver>/.exec(cfgText);
var mainVer = /var VERSION = '([^']+)'/.exec(mainText);
assert.ok(cfgVer && mainVer, 'could not find the version in config.xml or main.js');
assert.equal(mainVer[1], cfgVer[1].trim(), 'VERSION in main.js and <ver> in config.xml differ');
