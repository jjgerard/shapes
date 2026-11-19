// Dumps each mode's legal parent->child edges straight out of data.js, so the
// physical connector design is derived from the game's own rules, not copied.
// Run from the repo root:  node physical/dump_rules.js
const fs = require('fs');
const vm = require('vm');
vm.runInThisContext(fs.readFileSync(__dirname + '/../data.js', 'utf8') +
  ';globalThis.__m = { MODES, setMode };');
const { MODES } = globalThis.__m;
const out = {};
for (const id of ['prex', 'xbar']) {
  const edges = [...MODES[id].legalEdges].map(e => {
    const [p, c] = e.split('>');
    return [p, c];
  });
  out[id] = edges;
}
fs.writeFileSync(__dirname + '/rules.json', JSON.stringify(out, null, 1));
console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length + ' edges'])));
