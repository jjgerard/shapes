// Dumps the Level 2 sentence trees WITH their words (and silent heads and traces), for the physical renders.
// Run from the repo root:  node physical/dump_words.js
const fs = require('fs');
const vm = require('vm');
vm.runInThisContext(fs.readFileSync(__dirname + '/../data.js', 'utf8') + ';globalThis.__m = { MODES };');
const { MODES } = globalThis.__m;
const slim = n => ({ s: n.shape, n: n.number, w: n.word || null, silent: !!n.silent, trace: !!n.isTrace, c: (n.children || []).map(slim) });
const out = {};
for (const id of ['prex', 'xbar']) {
  for (const x of MODES[id].level2.filter(x => x.root)) out[`${id}:L2 ${x.id}`] = slim(x.root);
}
fs.writeFileSync(__dirname + '/words.json', JSON.stringify(out, null, 1));
console.log(Object.keys(out).length, 'sentences');
