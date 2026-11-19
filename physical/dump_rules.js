// Dumps what the physical design needs straight out of data.js: the category
// shapes/colours, every buildable fragment (a node plus its children, in
// left-to-right order) and each mode's legal-edge set.
// Run from the repo root:  node physical/dump_rules.js
const fs = require('fs');
const vm = require('vm');
vm.runInThisContext(fs.readFileSync(__dirname + '/../data.js', 'utf8') +
  ';globalThis.__m = { MODES, CATEGORIES };');
const { MODES, CATEGORIES } = globalThis.__m;
const out = { categories: CATEGORIES, modes: {} };
for (const id of ['prex', 'xbar']) {
  const m = MODES[id];
  out.modes[id] = {
    edges: [...m.legalEdges].map(e => e.split('>')),
    structures: m.structures.map(s => ({
      id: s.id, shape: s.shape, number: s.number, rule: s.rule,
      children: s.children.map(c => ({ shape: c.shape, number: c.number })),
    })),
  };
}
fs.writeFileSync(__dirname + '/rules.json', JSON.stringify(out, null, 1));
console.log(Object.fromEntries(Object.entries(out.modes).map(
  ([k, v]) => [k, `${v.structures.length} fragments, ${v.edges.length} edges`])));
