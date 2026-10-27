var assert = require('assert');
var Info = require('../widget/js/info.js');

// parse: JSON text -> object, anything else -> null
assert.deepEqual(Info.parse('{"title":"Heat","rating":8.2}'), { title: 'Heat', rating: 8.2 });
assert.deepEqual(Info.parse(String.fromCharCode(65279) + '{"a":1}'), { a: 1 }, 'a byte order mark is ignored');
assert.equal(Info.parse('not json'), null);
assert.equal(Info.parse(''), null);
assert.equal(Info.parse('42'), null);
var BS = String.fromCharCode(92);
assert.equal(Info.parse('{"title":"Caf' + BS + 'u00e9"}').title, 'Caf' + String.fromCharCode(233), 'escaped letters decode');

// runtime
assert.equal(Info.runtime(170), '2h 50m');
assert.equal(Info.runtime(120), '2h 0m');
assert.equal(Info.runtime(45), '45m');
assert.equal(Info.runtime(0), '');
assert.equal(Info.runtime(null), '');

// meta line: missing parts are left out
var dot = '  ' + String.fromCharCode(183) + '  ';
assert.equal(Info.meta({ year: '1995', runtime: 170, rating: 8.2, genres: ['Crime', 'Drama'] }),
	['1995', '2h 50m', '8.2/10', 'Crime, Drama'].join(dot));
assert.equal(Info.meta({ year: '1995', runtime: 0, rating: 0, genres: [] }), '1995');
assert.equal(Info.meta({}), '');
assert.equal(Info.meta(null), '');

console.log('info.test.js: all passed');
