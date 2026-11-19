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
// The game's own trees, so the physical set can be checked against every one
// of them (Level 1 targets and the Level 2 sentences).
const slim = n => ({ s: n.shape, n: n.number, c: (n.children || []).map(slim) });
for (const id of ['prex', 'xbar']) {
  const m = MODES[id];
  out.modes[id] = {
    edges: [...m.legalEdges].map(e => e.split('>')),
    trees: [...m.level1.filter(x => x.root).map(x => ({ name: 'L1 ' + x.id, tree: slim(x.root) })),
            ...m.level2.filter(x => x.root).map(x => ({ name: 'L2 ' + x.id, tree: slim(x.root) }))],
    structures: m.structures.map(s => ({
      id: s.id, shape: s.shape, number: s.number, rule: s.rule,
      children: s.children.map(c => ({ shape: c.shape, number: c.number })),
    })),
  };
}
fs.writeFileSync(__dirname + '/rules.json', JSON.stringify(out, null, 1));
console.log(Object.fromEntries(Object.entries(out.modes).map(
  ([k, v]) => [k, `${v.structures.length} fragments, ${v.edges.length} edges, ${v.trees.length} trees`])));
