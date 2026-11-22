// Tree studio: draw publication-quality syntax trees from labelled brackets or LaTeX (qtree / forest),
// then adjust by hand (drag, retype, triangles, movement arrows) and export SVG / PNG / PDF.
// Self-contained: it doesn't use the game's data or pieces. All sizes are in points (1 unit = 1 pt).
(() => {
'use strict';

const STORE = 'shapes-trees-v2';     // v2: starts blank, words sit under their category
const NS = 'http://www.w3.org/2000/svg';
const $ = id => document.getElementById(id);
const mk = (tag, attrs, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};

// ------------------------------------------------------------------ fonts
const FONT_STACKS = {
  'Times New Roman': '"Times New Roman", Times, "Liberation Serif", "Nimbus Roman", "Tinos", serif',
  'Latin Modern Roman': '"Latin Modern Roman", "LM Roman 10", "CMU Serif", "Computer Modern Serif", "Computer Modern", serif',
  'Libertinus Serif': '"Libertinus Serif", "Linux Libertine O", "Linux Libertine", serif',
  'Charis SIL': '"Charis SIL", "Gentium Plus", "Gentium Book Plus", serif',
  'Gentium Plus': '"Gentium Plus", "Gentium Book Plus", "Charis SIL", serif',
  'Doulos SIL': '"Doulos SIL", "Charis SIL", serif',
  'Cardo': '"Cardo", serif',
  'Palatino': '"Palatino Linotype", Palatino, "Book Antiqua", "URW Palladio L", "P052", serif',
  'Garamond': 'Garamond, "EB Garamond", "Cormorant Garamond", serif',
  'Georgia': 'Georgia, serif',
  'Cambria': 'Cambria, "Caladea", serif',
  'STIX Two Text': '"STIX Two Text", "STIXGeneral", serif',
  'Helvetica': '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif',
  'Arial': 'Arial, "Liberation Sans", Helvetica, sans-serif',
  'Calibri': 'Calibri, Carlito, sans-serif',
  'Source Sans': '"Source Sans 3", "Source Sans Pro", sans-serif',
  'Courier New': '"Courier New", Courier, "Liberation Mono", monospace',
};
const stackOf = f => FONT_STACKS[f] || `"${String(f).replace(/["\\]/g, '')}", "Times New Roman", serif`;

// ------------------------------------------------------------------ the document
const DEFAULT_OPTS = () => ({
  lab: { family: 'Times New Roman', size: 12, bold: false, italic: false, color: '#000000' },
  word: { family: 'Times New Roman', size: 12, bold: false, italic: false, color: '#000000' },
  wordMode: 'auto',        // auto: bare words in the text; all: every leaf; none: no leaf is a word
  prime: true, subScale: 0.7,
  line: { width: 0.6, color: '#000000', dash: false, gap: 2.5 },
  hgap: 10, vgap: 34, alignTerm: false, triFill: false,
  arrow: { width: 0.7, color: '#000000', head: 6 },
  margin: 8, bg: '#ffffff', transparent: false,
});

let doc = null;               // { nextId, root, arrows:[{id,from,to,depth,label,dash,color}], opts }
let fmt = 'bracket';          // how the text box writes the tree
let sel = null;               // { kind:'node'|'arrow', id }
let view = { x: 0, y: 0, k: 2 };
let L = null, bounds = null;  // layout of the current doc and the bounds of what is drawn
let ui = { mode: 'build', text: false, cat: 'X', zero: true };   // saved with the page, but not part of the tree
let preview = null;           // where a piece being dragged would join: { type:'child'|'parent'|'relabel', id, cx, cy }
let armed = null;             // { from: nodeId } while waiting for the arrow's landing node
let undoStack = [], redoStack = [];
let lastKey = null, lastT = 0;

const newNode = (label, extra) => Object.assign({ id: doc.nextId++, label: label || '', children: [] }, extra || {});

// ------------------------------------------------------------------ label markup -> styled runs
const SYM = {
  emptyset: '∅', varnothing: '∅', O: 'Ø', rightarrow: '→', to: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι',
  kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ',
  chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  ldots: '…', dots: '…', ast: '*', star: '⋆', bullet: '•', times: '×', neg: '¬', lnot: '¬', wedge: '∧', vee: '∨', in: '∈',
  langle: '⟨', rangle: '⟩', textbar: '|', textasciitilde: '~', textunderscore: '_', ' ': ' ', '&': '&', '%': '%', '#': '#', '_': '_', '$': '$',
};
const STYLE_CMD = {
  textit: { it: true }, emph: { it: true }, mathit: { it: true }, textsl: { it: true },
  textbf: { bd: true }, mathbf: { bd: true },
  sout: { strike: true }, st: { strike: true }, cancel: { strike: true },
  textsubscript: { sub: true }, textsuperscript: { sup: true },
  text: {}, textrm: {}, mathrm: {}, textnormal: {}, textsc: {}, textsf: {}, texttt: {},
};
function matchGroup(s, i) {            // s[i] === '{': returns [inner, indexAfterClosingBrace]
  let depth = 0, j = i;
  for (; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s[j] === '{') depth++;
    else if (s[j] === '}') { depth--; if (depth === 0) return [s.slice(i + 1, j), j + 1]; }
  }
  return [s.slice(i + 1), s.length];
}
function runsOf(str, prime) {
  const out = [];
  const go = (s, st) => {
    let i = 0, buf = '';
    const flush = () => { if (buf) { out.push(Object.assign({ t: buf }, st)); buf = ''; } };
    while (i < s.length) {
      const c = s[i];
      if (c === '\\') {
        const m = /^\\([A-Za-z]+)/.exec(s.slice(i));
        if (m) {
          const cmd = m[1];
          i += m[0].length;
          if (STYLE_CMD[cmd] && s[i] === '{') {
            const [inner, e] = matchGroup(s, i); i = e; flush();
            go(inner, Object.assign({}, st, STYLE_CMD[cmd]));
            continue;
          }
          if (SYM[cmd] !== undefined) buf += SYM[cmd];
          if (s[i] === ' ') i++;
          continue;
        }
        const nx = s[i + 1];
        if (nx === undefined) { i++; continue; }
        buf += SYM[nx] !== undefined ? SYM[nx] : nx;
        i += 2; continue;
      }
      if (c === '_' || c === '^') {
        i++;
        let inner;
        if (s[i] === '{') { const g = matchGroup(s, i); inner = g[0]; i = g[1]; }
        else if (s[i] === '\\') { const m = /^\\[A-Za-z]+/.exec(s.slice(i)); inner = m ? m[0] : s[i]; i += inner.length; }
        else { inner = s[i] || ''; i++; }
        flush();
        go(inner, Object.assign({}, st, c === '_' ? { sub: true } : { sup: true }));
        continue;
      }
      if (c === '{') { const [inner, e] = matchGroup(s, i); i = e; flush(); go(inner, st); continue; }
      if (c === '$') { i++; continue; }
      if (c === '~') { buf += '\u00a0'; i++; continue; }
      if (c === "'" && prime) { buf += '′'; i++; continue; }
      buf += c; i++;
    }
    flush();
  };
  go(String(str), {});
  return out;
}

// ------------------------------------------------------------------ measuring text
const cv = document.createElement('canvas').getContext('2d');
const fontStr = (f, r, scale) =>
  `${(f.italic || r.it) ? 'italic ' : ''}${(f.bold || r.bd) ? 'bold ' : ''}${f.size * ((r.sub || r.sup) ? scale : 1)}px ${stackOf(f.family)}`;
function measure(runs, f, scale) {
  let w = 0;
  for (const r of runs) { cv.font = fontStr(f, r, scale); w += cv.measureText(r.t).width; }
  return w;
}

// ------------------------------------------------------------------ parsing  [..]  \Tree [.. ]  forest
class ParseError extends Error { constructor(msg, pos) { super(msg); this.pos = pos; } }

function pre(src) {
  return src
    .replace(/\\qroof\s*\{([^}]*)\}\s*\.\s*(\S+)/g, '[.$2 \\roof {$1} ]')
    .replace(/\\draw\b[^;]*;/g, ' ')
    .replace(/\\path\b[^;]*;/g, ' ')
    .replace(/\\edge\s*\[\s*roof\s*\]\s*;?/g, ' \\roof ')
    .replace(/\\(?:Tree|begin\{(?:forest|tikzpicture|center|figure|tabular)\}|end\{(?:forest|tikzpicture|center|figure|tabular)\}|centering|forestset\{[^}]*\})/g, ' ')
    .replace(/(^|[^\\])%[^\n]*/g, '$1');
}
function tokenize(src) {
  const toks = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '[') { toks.push({ t: '[', pos: i }); i++; continue; }
    if (c === ']') { toks.push({ t: ']', pos: i }); i++; continue; }
    if (c === '"' || c === '“') {
      const close = c === '"' ? '"' : '”';
      const e = src.indexOf(close, i + 1);
      if (e > 0) { toks.push({ t: 'a', v: src.slice(i + 1, e), pos: i }); i = e + 1; continue; }
    }
    let j = i, depth = 0, v = '';
    while (j < n) {
      const d = src[j];
      if (d === '\\') { v += d; j++; if (j < n) { v += src[j]; j++; } continue; }
      if (d === '{') depth++;
      else if (d === '}') depth = Math.max(0, depth - 1);
      else if (depth === 0 && (/\s/.test(d) || d === '[' || d === ']')) break;
      v += d; j++;
    }
    toks.push({ t: 'a', v, pos: i });
    i = j;
  }
  return toks;
}
const unbrace = v => {                     // {two words} -> two words
  if (v[0] === '{') { const [inner, e] = matchGroup(v, 0); if (e === v.length) return inner; }
  return v;
};
function parseTree(src) {
  const toks = tokenize(pre(src));
  if (!toks.length) return [];
  let p = 0;
  const node = () => {
    const open = toks[p++];
    const n = newNode('');
    if (toks[p] && toks[p].t === 'a' && toks[p].v !== '\\roof') {
      let v = toks[p++].v;
      let forestOpts = false;
      if (/,$/.test(v)) { v = v.slice(0, -1); forestOpts = true; }
      if (v[0] === '.' && v.length > 1) v = v.slice(1);
      else if (v === '.') v = '';
      n.label = unbrace(v);
      if (forestOpts) {                                     // forest "[NP, roof, tier=x [..]]": skip the options
        while (p < toks.length && toks[p].t === 'a') { if (/^roof,?$/.test(toks[p].v)) n.tri = true; p++; }
      }
    }
    while (p < toks.length && toks[p].t !== ']') {
      const k = toks[p];
      if (k.t === '[') n.children.push(node());
      else {
        p++;
        if (k.v === '\\roof') n.tri = true;
        else if (/^[;}]+$/.test(k.v)) continue;
        else n.children.push(newNode(unbrace(k.v), { word: true }));
      }
    }
    if (p >= toks.length) throw new ParseError('This [ is never closed with a ].', open.pos);
    p++;
    return n;
  };
  if (toks[0].t !== '[') throw new ParseError('Start with [ (a tree is a bracket with a label in it).', toks[0].pos);
  const roots = [];
  while (p < toks.length) {                       // several trees in a row are several trees on the page
    const k = toks[p];
    if (k.t === ']') throw new ParseError('This ] has no matching [.', k.pos);
    if (k.t === '[') roots.push(node()); else p++;
  }
  return roots;
}
function posToLineCol(src, pos) {
  // pos is in the preprocessed text; for display, find the same character count in the original, which is close enough
  const before = src.slice(0, Math.min(pos, src.length));
  const line = before.split('\n').length;
  return { line, col: pos - before.lastIndexOf('\n') };
}

// keep what the user did by hand (positions, styles, arrows) when the text is edited: match nodes by position in the tree
function adopt(nw, old) {
  nw.id = old.id;
  if (nw.word === undefined && old.word) nw.word = true;
  for (const k of ['dx', 'dy', 'bold', 'italic', 'color', 'size', 'cross', 'placed']) if (old[k] !== undefined) nw[k] = old[k];
  const m = Math.min(nw.children.length, old.children.length);
  for (let i = 0; i < m; i++) adopt(nw.children[i], old.children[i]);
}

// ------------------------------------------------------------------ writing the tree out
function toLatexText(s) {
  return s.replace(/([_^])\{([^{}]*)\}|([_^])(\\[A-Za-z]+|[^\s{}])/g, (m, a, b, c, d) => {
    const op = a || c, body = b !== undefined ? b : d;
    return (op === '_' ? '\\textsubscript{' : '\\textsuperscript{') + body + '}';
  });
}
const leafWords = n => (n.children.length ? n.children.flatMap(leafWords) : [n.label]);
function serialize(root, f, collapse, names) {
  const nm = k => (f === 'forest' && names && names.has(k.id) ? ', name=' + names.get(k.id) : '');
  const lab = (s, atEmpty) => {
    let t = f === 'bracket' ? s : toLatexText(s);
    if (/[\s[\]]/.test(t) || (t === '' && atEmpty)) t = '{' + t + '}';
    return t;
  };
  const open = f === 'qtree' ? '[.' : '[';
  const word = k => (f === 'forest' ? '[' + lab(k.label) + nm(k) + ']' : lab(k.label, true));
  const bare = k => (k.word && !k.children.length);
  const rec = (n, ind) => {
    let kids = n.children;
    let roof = '';
    if (n.tri && n.children.length) {
      if (collapse) { kids = [{ id: 't' + n.id, label: leafWords(n).join(' '), word: true, children: [] }]; }
      roof = f === 'qtree' ? '\\edge[roof]; ' : f === 'forest' ? '' : '\\roof ';
    }
    const head = open + lab(n.label, f === 'qtree') + (n.tri && n.children.length && f === 'forest' ? ', roof' : '') + nm(n);
    const close = f === 'qtree' ? ' ]' : ']';
    if (!kids.length) return f === 'qtree' ? head + close : head + ']';
    const simple = kids.every(k => !k.children.length);
    if (simple) {
      return head + ' ' + roof + kids.map(k => (bare(k) ? word(k) : (f === 'qtree' ? '[.' + lab(k.label, true) + ' ]' : '[' + lab(k.label) + nm(k) + ']'))).join(' ') + close;
    }
    const pad = '  '.repeat(ind + 1);
    return head + (roof ? ' ' + roof.trim() : '') + '\n' + kids.map(k => pad + (bare(k) ? word(k) : rec(k, ind + 1))).join('\n') + close;
  };
  const body = rec(root, 0);
  if (f === 'qtree') return '\\Tree ' + body.replace(/\n/g, '\n      ');
  if (f === 'forest') return '\\begin{forest}\n' + body.replace(/^/gm, '  ') + '\n\\end{forest}';
  return body;
}

// the node an arrow should start or end under: the lowest thing under (or at) it, which is where it is drawn
function lowestKey(id, Lm) {
  let cur = Lm.map.get(String(id));
  while (cur && cur.kids.length) cur = cur.kids.reduce((a, b) => (b.subBot > a.subBot ? b : a));
  return cur ? (cur.virt ? 't' + cur.node.id : cur.node.id) : null;
}
function serializeAll(roots, f) {
  if (f === 'tikz') return toTikz(false);
  if (f !== 'forest' || !doc.arrows.length) return roots.map(r => serialize(r, f, f !== 'bracket')).join('\n\n');
  const Lm = layoutDoc();
  const names = new Map(), ends = new Map();
  for (const a of doc.arrows) {
    for (const id of [a.from, a.to]) { const k = lowestKey(id, Lm); if (k !== null) names.set(k, 'n' + k); }
    ends.set(a.id, [names.get(lowestKey(a.from, Lm)), names.get(lowestKey(a.to, Lm))]);
  }
  return roots.map(r => {
    const ids = subIds(r);
    let out = serialize(r, f, true, names);
    const lines = [];
    for (const a of doc.arrows) {
      const [x, y] = ends.get(a.id) || [];
      if (!x || !y || !ids.has(a.from) || !ids.has(a.to)) { if (x && y && (ids.has(a.from) || ids.has(a.to))) lines.push('  % an arrow between two separate trees is left out here (use the TikZ format for that)'); continue; }
      const d = Math.round(a.depth * 10) / 10;
      lines.push(`  \\draw[->, >=stealth, line width=${doc.opts.arrow.width}pt${a.dash ? ', dashed' : ''}] (${x}.south) .. controls +(0,-${d}pt) and +(0,-${d}pt) .. (${y}.south);`);
      if (a.label) lines.push(`  \\path (${x}.south) -- node[midway, below=${d * 0.75}pt, font=\\itshape\\small] {${toLatexText(a.label)}} (${y}.south);`);
    }
    if (lines.length) out = out.replace(/\n\\end\{forest\}$/, '\n' + lines.join('\n') + '\n\\end{forest}');
    return out;
  }).join('\n\n');
}

// TikZ with every position written out, so what you see is exactly what you get: moved nodes, triangles and arrows included.
const TEX_SYM = (() => {
  const m = {};
  for (const k of Object.keys(SYM)) if (/^[A-Za-z]+$/.test(k) && SYM[k].charCodeAt(0) > 127 && !m[SYM[k]]) m[SYM[k]] = '\\ensuremath{\\' + k + '}';
  m['Ø'] = '\\O{}'; m['…'] = '\\ldots{}'; m['′'] = "\\ensuremath{'}"; m['\u00a0'] = '~';
  return m;
})();
const texEsc = t => { let o = ''; for (const ch of t) o += TEX_SYM[ch] || ({ '&': '\\&', '%': '\\%', '$': '\\$', '#': '\\#', '_': '\\_', '{': '\\{', '}': '\\}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}', '\\': '\\textbackslash{}' }[ch] || ch); return o; };
function texRuns(runs) {
  return runs.map(r => {
    let t = texEsc(r.t);
    if (r.sub) t = `\\textsubscript{${t}}`; else if (r.sup) t = `\\textsuperscript{${t}}`;
    if (r.it) t = `\\textit{${t}}`;
    if (r.bd) t = `\\textbf{${t}}`;
    if (r.strike) t = `\\sout{${t}}`;
    return t;
  }).join('');
}
function toTikz(standalone) {
  const o = doc.opts, Lm = layoutDoc();
  const bb = paintTree(mk('g', {}), Lm, false);
  const n2 = v => String(Math.round(v * 100) / 100);
  const X = x => n2(x - bb.minX), Y = y => n2(bb.maxY - y);
  const colors = new Map();
  const col = hex => { if (!hex || /^#0{6}$/i.test(hex)) return null; if (!colors.has(hex)) colors.set(hex, 'ts' + 'abcdefghijklmnopqrstuvwxyz'[colors.size % 26] + colors.size); return colors.get(hex); };
  const out = [];
  let usesSout = false;
  const lw = o.line.width, dash = o.line.dash ? `, dash pattern=on ${n2(lw * 4)}pt off ${n2(lw * 3)}pt` : '';
  const lc = col(o.line.color);
  const lineOpt = `line width=${lw}pt, line cap=round, line join=round${lc ? ', color=' + lc : ''}${dash}`;
  const all = [...Lm.map.values()];
  out.push('  % lines');
  for (const p of all) for (const k of p.kids) {
    const x0 = p.x, y0 = p.bot + o.line.gap, x1 = k.x, y1 = k.top - o.line.gap;
    if (k.virt) out.push(`  \\draw[${lineOpt}${o.triFill ? ', fill=black, fill opacity=0.08' : ''}] (${X(x0)},${Y(y0)}) -- (${X(x1 - k.w / 2 - 1)},${Y(y1)}) -- (${X(x1 + k.w / 2 + 1)},${Y(y1)}) -- cycle;`);
    else out.push(`  \\draw[${lineOpt}] (${X(x0)},${Y(y0)}) -- (${X(x1)},${Y(y1)});`);
  }
  out.push('  % labels and words');
  for (const ln of all) {
    if (!ln.runs.length) continue;
    if (ln.runs.some(r => r.strike)) usesSout = true;
    const f = ln.font, c = col(f.color);
    const style = `font=\\fontsize{${n2(f.size)}}{${n2(f.size * 1.2)}}\\selectfont${f.italic ? '\\itshape' : ''}${f.bold ? '\\bfseries' : ''}${c ? ', text=' + c : ''}`;
    out.push(`  \\node[anchor=base, inner sep=0pt, ${style}] at (${X(ln.x)},${Y(ln.y)}) {${texRuns(ln.runs)}};`);
  }
  if (doc.arrows.length) out.push('  % movement arrows');
  for (const a of doc.arrows) {
    const g = arrowGeom(a, Lm);
    if (!g) continue;
    const ac = col(a.color || o.arrow.color), aw = o.arrow.width;
    const opt = `line width=${aw}pt, line cap=round${ac ? ', color=' + ac : ''}${a.dash ? `, dash pattern=on ${n2(aw * 4)}pt off ${n2(aw * 3)}pt` : ''}`;
    out.push(`  \\draw[${opt}] (${X(g.sx)},${Y(g.sy)}) .. controls (${X(g.sx)},${Y(g.c)}) and (${X(g.ex)},${Y(g.c)}) .. (${X(g.bx)},${Y(g.by)});`);
    const px = -g.dy, py = g.dx, w = g.head * 0.36;
    out.push(`  \\fill[${ac ? 'color=' + ac : 'black'}] (${X(g.ex)},${Y(g.ey)}) -- (${X(g.bx + px * w)},${Y(g.by + py * w)}) -- (${X(g.bx - px * w)},${Y(g.by - py * w)}) -- cycle;`);
    if (a.label) {
      const size = Math.max(6, o.lab.size * 0.8), lr = runsOf(a.label, o.prime);
      if (lr.some(r => r.strike)) usesSout = true;
      out.push(`  \\node[anchor=base, inner sep=0pt, font=\\fontsize{${n2(size)}}{${n2(size * 1.2)}}\\selectfont\\itshape${ac ? ', text=' + ac : ''}] at (${X(g.mid.x)},${Y(g.mid.y + size * 1.05)}) {${texRuns(lr)}};`);
    }
  }
  const defs = [...colors].map(([hex, name]) => `  \\definecolor{${name}}{HTML}{${hex.slice(1).toUpperCase()}}`);
  const body = ['\\begin{tikzpicture}[x=1pt, y=1pt]', ...defs, ...out, '\\end{tikzpicture}'].join('\n');
  const head = `% Tree studio: TikZ with exact positions. Needs \\usepackage{tikz}${usesSout ? ' and \\usepackage{ulem}' : ''}.\n% Text uses the surrounding document's font; for ∅, Greek etc. any normal LaTeX engine is fine.\n`;
  if (!standalone) return head + body;
  return `\\documentclass[border=4pt]{standalone}\n\\usepackage{tikz}\n${usesSout ? '\\usepackage{ulem}\n' : ''}\\begin{document}\n${body}\n\\end{document}\n`;
}

// ------------------------------------------------------------------ finding things
function findNode(id) {                       // { n, parent, idx }: a top node has parent null and idx = its place in doc.roots
  const walk = (n, parent, idx) => {
    if (n.id === id) return { n, parent, idx };
    for (let i = 0; i < n.children.length; i++) { const r = walk(n.children[i], n, i); if (r) return r; }
    return null;
  };
  for (let i = 0; i < doc.roots.length; i++) { const r = walk(doc.roots[i], null, i); if (r) return r; }
  return null;
}
const subIds = (n, set = new Set()) => { set.add(n.id); n.children.forEach(c => subIds(c, set)); return set; };
const nodeIds = () => { const set = new Set(); doc.roots.forEach(r => subIds(r, set)); return set; };
const realId = id => parseInt(String(id), 10);       // 12~t (a triangle's words) -> 12
function pruneArrows() {
  const ids = nodeIds();
  doc.arrows = doc.arrows.filter(a => ids.has(a.from) && ids.has(a.to) && a.from !== a.to);
  if (sel && sel.kind === 'arrow' && !doc.arrows.some(a => a.id === sel.id)) sel = null;
  if (sel && sel.kind === 'node' && !ids.has(sel.id)) sel = null;
}

// ------------------------------------------------------------------ layout
function styleFor(n, role) {
  const o = doc.opts, b = role === 'word' ? o.word : o.lab;
  return {
    family: b.family,
    size: n && n.size ? n.size : b.size,
    bold: n && n.bold !== undefined ? n.bold : b.bold,
    italic: n && n.italic !== undefined ? n.italic : b.italic,
    color: n && n.color ? n.color : b.color,
  };
}
function layoutDoc() {
  const o = doc.opts;
  const map = new Map();
  let maxDepth = 0;

  const build = (n, depth, virtText) => {
    const virt = virtText !== undefined;
    const isLeafNode = virt || !n.children.length;
    const role = isLeafNode && (virt ? o.wordMode !== 'none' : (o.wordMode === 'all' || (o.wordMode === 'auto' && n.word))) ? 'word' : 'lab';
    const font = styleFor(n, role);
    let runs = runsOf(virt ? virtText : n.label, o.prime);
    if (n.cross) runs = runs.map(r => Object.assign({}, r, { strike: true }));
    const ln = {
      id: virt ? n.id + '~t' : String(n.id), node: n, virt, depth, font, runs, role,
      w: Math.max(measure(runs, font, o.subScale), font.size * 0.4), kids: [], x: 0, y: 0,
    };
    maxDepth = Math.max(maxDepth, depth);
    if (!virt) {
      if (n.tri && n.children.length) ln.kids = [build(n, depth + 1, leafWords(n).join(' '))];
      else ln.kids = n.children.map(c => build(c, depth + 1));
    }
    return ln;
  };
  // tidy placement: each subtree is a contour (left/right edge per depth), siblings slide together until they are hgap apart
  const place = ln => {
    const me = [];
    me[0] = [-ln.w / 2, ln.w / 2];
    if (!ln.kids.length) {
      ln.rel = [];
      if (o.alignTerm) { me.length = 0; me[maxDepth - ln.depth] = [-ln.w / 2, ln.w / 2]; }   // a bottom-row word only competes for room on the bottom row
      return me;
    }
    const acc = [];              // right edge of everything placed so far, per depth below ln
    const xs = [];
    const conts = ln.kids.map(place);
    conts.forEach((c, i) => {
      let x = 0;
      if (i > 0) {
        x = -Infinity;
        for (let d = 0; d < c.length; d++) if (c[d] && acc[d] !== undefined) x = Math.max(x, acc[d] + o.hgap - c[d][0]);
        if (x === -Infinity) x = xs[i - 1] + 1;
      }
      xs.push(x);
      c.forEach((e, d) => { acc[d] = acc[d] === undefined ? x + e[1] : Math.max(acc[d], x + e[1]); });
    });
    const mid = (xs[0] + xs[xs.length - 1]) / 2;
    ln.rel = xs.map(x => x - mid);
    const merged = [];
    conts.forEach((c, i) => c.forEach((e, d) => {
      const l = ln.rel[i] + e[0], r = ln.rel[i] + e[1];
      if (!merged[d]) merged[d] = [l, r]; else { merged[d][0] = Math.min(merged[d][0], l); merged[d][1] = Math.max(merged[d][1], r); }
    }));
    for (let d = 0; d < merged.length; d++) if (merged[d]) me[d + 1] = merged[d];
    return me;
  };
  const finish = (ln, ax, cdx, cdy) => {
    const n = ln.node;
    if (!ln.virt) { cdx += n.dx || 0; cdy += n.dy || 0; }
    const depthY = (ln.kids.length || !o.alignTerm) ? ln.depth : maxDepth;
    ln.x = ax + cdx;
    ln.y = depthY * o.vgap + cdy;
    const f = ln.font.size;
    ln.top = ln.y - 0.76 * f;
    ln.bot = ln.y + (ln.runs.some(r => r.sub) ? 0.34 : 0.24) * f;
    ln.subBot = ln.bot;
    ln.kids.forEach((k, i) => {
      finish(k, ax + ln.rel[i], cdx, cdy);
      ln.subBot = Math.max(ln.subBot, k.subBot);
    });
    map.set(ln.id, ln);
  };
  const infos = [];
  for (const r of doc.roots) {                      // every tree on the page is laid out on its own, then moved by its own offset
    maxDepth = 0;
    const root = build(r, 0);
    place(root);
    finish(root, 0, 0, 0);
    let minX = Infinity, maxX = -Infinity;
    const scan = ln => { minX = Math.min(minX, ln.x - ln.w / 2); maxX = Math.max(maxX, ln.x + ln.w / 2); ln.kids.forEach(scan); };
    scan(root);
    infos.push({ minX, maxX });
  }
  return { map, infos };
}

// trees that came from the text (not dragged anywhere yet) are set out side by side
function autoPlace() {
  if (doc.roots[0]) doc.roots[0].placed = true;
  if (doc.roots.every(r => r.placed)) return;
  const Lm = layoutDoc();
  let right = -Infinity;
  doc.roots.forEach((r, i) => { if (r.placed) right = Math.max(right, Lm.infos[i].maxX); });
  doc.roots.forEach((r, i) => {
    if (r.placed) return;
    const inf = Lm.infos[i], shift = right + 60 - inf.minX;
    r.dx = (r.dx || 0) + shift; r.placed = true; right = inf.maxX + shift;
  });
}

// ------------------------------------------------------------------ arrows
const ARROW_K = 1.333;       // control point is this much further down than the curve's depth
function arrowGeom(a, Lm) {
  const f = Lm.map.get(String(a.from)), t = Lm.map.get(String(a.to));
  if (!f || !t) return null;
  const sx = f.x, sy = f.subBot + 2.5;
  const ex = t.x, ey = t.subBot + 2.5;
  const head = doc.opts.arrow.head;
  const c = Math.max(sy, ey) + (a.depth || 26) * ARROW_K;
  // arrowhead points along the last bit of the curve (control point 2 -> end)
  let dx = ex - ex, dy = ey - c;                       // the curve arrives from straight below: (ex, c) -> (ex, ey)
  const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
  const bx = ex - dx * head, by = ey - dy * head;
  const mid = { x: (sx + 3 * sx + 3 * ex + bx) / 8, y: (sy + 3 * c + 3 * c + by) / 8 };
  return { sx, sy, ex, ey, c, bx, by, dx, dy, mid, head };
}
function depthFromMidY(a, Lm, my) {
  const f = Lm.map.get(String(a.from)), t = Lm.map.get(String(a.to));
  const sy = f.subBot + 2.5, ey = t.subBot + 2.5;
  const g = arrowGeom(a, Lm);
  const c = (8 * my - sy - g.by) / 6;                  // solve (sy + 6c + by)/8 = my
  return Math.max(6, Math.min(160, (c - Math.max(sy, ey)) / ARROW_K));
}

// ------------------------------------------------------------------ painting
function paintText(parent, x, y, runs, f, scale) {
  const t = mk('text', {
    x, y, 'text-anchor': 'middle', 'font-family': stackOf(f.family), 'font-size': f.size, fill: f.color,
    'font-weight': f.bold ? 'bold' : 'normal', 'font-style': f.italic ? 'italic' : 'normal', 'xml:space': 'preserve',
  }, parent);
  let prev = 0;
  for (const r of runs) {
    const sh = r.sup ? -0.4 * f.size : r.sub ? 0.2 * f.size : 0;
    const a = {};
    if (sh !== prev) { a.dy = sh - prev; prev = sh; }
    if (r.sub || r.sup) a['font-size'] = f.size * scale;
    if (r.it && !f.italic) a['font-style'] = 'italic';
    if (r.bd && !f.bold) a['font-weight'] = 'bold';
    if (r.strike) a['text-decoration'] = 'line-through';
    mk('tspan', a, t).textContent = r.t;
  }
  return t;
}
const bez = (g, t) => {
  const u = 1 - t;
  return { x: u * u * u * g.sx + 3 * u * u * t * g.sx + 3 * u * t * t * g.ex + t * t * t * g.bx, y: u * u * u * g.sy + 3 * u * u * t * g.c + 3 * u * t * t * g.c + t * t * t * g.by };
};

// paints the tree into `g`; returns its bounds. `interactive` adds hit areas for the editor.
function paintTree(g, Lm, interactive) {
  const o = doc.opts;
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const grow = (x0, y0, x1, y1) => { b.minX = Math.min(b.minX, x0); b.minY = Math.min(b.minY, y0); b.maxX = Math.max(b.maxX, x1); b.maxY = Math.max(b.maxY, y1); };
  const lineAttrs = { stroke: o.line.color, 'stroke-width': o.line.width, fill: 'none', 'stroke-linecap': 'round' };
  if (o.line.dash) lineAttrs['stroke-dasharray'] = `${o.line.width * 4} ${o.line.width * 3}`;
  const gLines = mk('g', {}, g), gText = mk('g', {}, g), gArrows = mk('g', {}, g);

  const all = [...Lm.map.values()];
  for (const p of all) {
    for (const k of p.kids) {
      const x0 = p.x, y0 = p.bot + o.line.gap, x1 = k.x, y1 = k.top - o.line.gap;
      if (k.virt) {
        mk('polygon', Object.assign({}, lineAttrs, {
          points: `${x0},${y0} ${x1 - k.w / 2 - 1},${y1} ${x1 + k.w / 2 + 1},${y1}`, 'stroke-linejoin': 'round',
          fill: o.triFill ? '#000000' : 'none', 'fill-opacity': o.triFill ? 0.08 : 0,
        }), gLines);
      } else {
        mk('line', Object.assign({}, lineAttrs, { x1: x0, y1: y0, x2: x1, y2: y1 }), gLines);
      }
      grow(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1));
    }
  }
  for (const ln of all) {
    paintText(gText, ln.x, ln.y, ln.runs, ln.font, o.subScale);
    grow(ln.x - ln.w / 2, ln.top, ln.x + ln.w / 2, ln.bot);
    if (interactive) {
      mk('rect', { class: 'hit', 'data-nid': ln.id, x: ln.x - ln.w / 2 - 3, y: ln.top - 2, width: ln.w + 6, height: ln.bot - ln.top + 4, rx: 2 }, gText);
    }
  }
  for (const a of doc.arrows) {
    const ag = arrowGeom(a, Lm);
    if (!ag) continue;
    const col = a.color || o.arrow.color;
    const d = `M${ag.sx},${ag.sy} C${ag.sx},${ag.c} ${ag.ex},${ag.c} ${ag.bx},${ag.by}`;
    const attrs = { d, stroke: col, 'stroke-width': o.arrow.width, fill: 'none', 'stroke-linecap': 'round' };
    if (a.dash) attrs['stroke-dasharray'] = `${o.arrow.width * 4} ${o.arrow.width * 3}`;
    mk('path', attrs, gArrows);
    const px = -ag.dy, py = ag.dx, h = ag.head, w = h * 0.36;
    mk('polygon', { points: `${ag.ex},${ag.ey} ${ag.bx + px * w},${ag.by + py * w} ${ag.bx - px * w},${ag.by - py * w}`, fill: col, stroke: col, 'stroke-width': 0.3, 'stroke-linejoin': 'round' }, gArrows);
    for (let i = 0; i <= 8; i++) { const q = bez(ag, i / 8); grow(q.x, q.y, q.x, q.y); }
    grow(ag.sx - 1, ag.sy, ag.ex + 1, ag.ey);
    if (a.label) {
      const f = { family: o.lab.family, size: Math.max(6, o.lab.size * 0.8), bold: false, italic: true, color: col };
      const lr = runsOf(a.label, o.prime);
      const lw = measure(lr, f, o.subScale);
      const ly = ag.mid.y + f.size * 1.05;
      paintText(gArrows, ag.mid.x, ly, lr, f, o.subScale);
      grow(ag.mid.x - lw / 2, ly - f.size * 0.76, ag.mid.x + lw / 2, ly + f.size * 0.3);
    }
    if (interactive) {
      mk('path', { d, class: 'arrow-hit', 'data-aid': a.id, 'stroke-width': Math.max(8, o.arrow.width + 6) }, gArrows);
    }
  }
  if (b.minX === Infinity) { b.minX = -20; b.minY = -20; b.maxX = 20; b.maxY = 20; }
  return b;
}

// ------------------------------------------------------------------ the canvas
const board = $('board'), world = $('world'), stage = $('stage');
const gPaper = $('layer-paper'), gTree = $('layer-tree'), gOver = $('layer-over');
const inputEdit = $('edit');

function applyView() { world.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`); placeNodeBar(); }
// a small bar beside the selected node, so deleting never means dragging
function placeNodeBar() {
  const bar = $('nodebar');
  const f = sel && sel.kind === 'node' && L ? findNode(sel.id) : null;
  const ln = f && L.map.get(String(sel.id));
  if (!ln || (gesture && gesture.moved) || armed || editing) { bar.hidden = true; return; }
  bar.hidden = false;
  $('nb-keep').hidden = !f.n.children.length;
  const x = view.x + ln.x * view.k;
  let y = view.y + ln.top * view.k - 40;
  if (y < 44) y = view.y + ln.bot * view.k + 10;          // no room above (the Build / Nudge switch lives there): go below
  bar.style.left = Math.max(80, Math.min(stage.clientWidth - 80, x)) + 'px';
  bar.style.top = y + 'px';
}
function pageBox() {
  const m = doc.opts.margin;
  return { x: bounds.minX - m, y: bounds.minY - m, w: bounds.maxX - bounds.minX + 2 * m, h: bounds.maxY - bounds.minY + 2 * m };
}
function fit() {
  const W = stage.clientWidth, H = stage.clientHeight;
  const pb = pageBox();
  const k = Math.max(0.2, Math.min((W - 70) / pb.w, (H - 70) / pb.h, 2.5));
  view = { k, x: (W - pb.w * k) / 2 - pb.x * k, y: (H - pb.h * k) / 2 - pb.y * k };
  applyView();
  placeEditor();
}
function zoomAt(cx, cy, factor) {
  const r = stage.getBoundingClientRect();
  const px = cx - r.left, py = cy - r.top;
  const k = Math.max(0.1, Math.min(20, view.k * factor));
  view.x = px - (px - view.x) * (k / view.k);
  view.y = py - (py - view.y) * (k / view.k);
  view.k = k;
  applyView();
  placeEditor();
}

function render() {
  L = layoutDoc();
  while (gTree.firstChild) gTree.removeChild(gTree.firstChild);
  bounds = paintTree(gTree, L, true);
  paintPaper();
  paintOverlay();
}
function paintPaper() {                  // just the sandbox's faint grid; the page edge is only where the export is cropped
  while (gPaper.firstChild) gPaper.removeChild(gPaper.firstChild);
  mk('rect', { x: -6000, y: -6000, width: 12000, height: 12000, fill: 'url(#grid)' }, gPaper);
}

function paintOverlay() {
  while (gOver.firstChild) gOver.removeChild(gOver.firstChild);
  placeNodeBar();
  if (preview) {
    const ln = L.map.get(String(preview.id));
    if (ln) {
      mk('rect', { class: 'snapbox', x: ln.x - ln.w / 2 - 4, y: ln.top - 3, width: ln.w + 8, height: ln.bot - ln.top + 6, rx: 3 }, gOver);
      if (preview.type !== 'relabel' && preview.cx !== undefined) {
        const up = preview.type === 'parent';
        mk('line', { class: 'snapline', x1: ln.x, y1: up ? ln.top : ln.bot, x2: preview.cx, y2: up ? preview.cy + 8 : preview.cy - 10 }, gOver);
      }
    }
  }
  if (gesture && gesture.type === 'agh' && gesture.moved && gesture.at) {
    const f = L.map.get(String(gesture.from));
    if (f) mk('line', { class: 'rubber', x1: f.x, y1: f.subBot + 2.5, x2: gesture.at.x, y2: gesture.at.y }, gOver);
  }
  if (!sel) return;
  if (sel.kind === 'node') {
    const ln = L.map.get(String(sel.id));
    if (!ln) return;
    mk('rect', { class: 'selbox', x: ln.x - ln.w / 2 - 3, y: ln.top - 2, width: ln.w + 6, height: ln.bot - ln.top + 4, rx: 2 }, gOver);
    if (!armed && !(gesture && gesture.moved) && !editing) {          // drag this dot onto the node it moved to
      const hx = ln.x + ln.w / 2 + 11 / view.k, hy = (ln.top + ln.bot) / 2;
      mk('circle', { class: 'agh', 'data-agh': sel.id, cx: hx, cy: hy, r: 6.5 / view.k }, gOver);
      const t = mk('text', { class: 'agh-t', x: hx, y: hy + 3.2 / view.k, 'font-size': 9 / view.k }, gOver);
      t.textContent = '↷';
    }
  } else {
    const a = doc.arrows.find(x => x.id === sel.id);
    const ag = a && arrowGeom(a, L);
    if (!ag) return;
    mk('path', { class: 'arrow-sel', d: `M${ag.sx},${ag.sy} C${ag.sx},${ag.c} ${ag.ex},${ag.c} ${ag.bx},${ag.by}`, 'stroke-width': 7 }, gOver);
    mk('circle', { class: 'handle', 'data-ah': a.id, cx: ag.mid.x, cy: ag.mid.y, r: 5 / view.k }, gOver);
  }
}

// ------------------------------------------------------------------ editing the doc (with undo)
const snapshot = () => JSON.stringify(doc);
function pushUndo(s) { undoStack.push(s); if (undoStack.length > 200) undoStack.shift(); redoStack = []; }
function edit(fn, key) {
  const now = Date.now();
  if (!(key && key === lastKey && now - lastT < 900)) pushUndo(snapshot());
  lastKey = key || null; lastT = now;
  fn();
  changed();
}
function changed(opts) {
  pruneArrows();
  render();
  refreshUI();
  if (!(opts && opts.keepSource)) syncSource();
  save();
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  doc = JSON.parse(undoStack.pop());
  lastKey = null; changed();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  doc = JSON.parse(redoStack.pop());
  lastKey = null; changed();
}

// ------------------------------------------------------------------ text box <-> tree
const srcEl = $('src'), errEl = $('err');
let srcTimer = null;
function syncSource() {
  if (document.activeElement === srcEl) return;
  srcEl.value = serializeAll(doc.roots, fmt);
  srcEl.readOnly = fmt === 'tikz';
  srcEl.classList.remove('bad');
  const note = fmt === 'tikz' ? 'TikZ is output only (every position is written out). Switch to Brackets to edit.'
    : fmt === 'qtree' && doc.arrows.length ? 'qtree cannot draw movement arrows. Use forest or TikZ for those.' : '';
  errEl.textContent = note; errEl.className = note ? 'ok' : '';
}
function applySource(text, force) {
  let roots;
  try { roots = parseTree(text); } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    const lc = posToLineCol(pre(text), e.pos);
    srcEl.classList.add('bad');
    errEl.className = '';
    errEl.textContent = `${e.message}  (line ${lc.line}, column ${lc.col}) The drawing keeps the last tree that worked.`;
    return false;
  }
  srcEl.classList.remove('bad');
  if (!roots.length) { errEl.className = 'ok'; errEl.textContent = 'Nothing to draw yet.'; return false; }
  if (!force) roots.forEach((r, i) => { if (doc.roots[i]) adopt(r, doc.roots[i]); });
  const old = doc.roots;
  doc.roots = roots; autoPlace(); doc.roots = old;
  errEl.className = 'ok'; errEl.textContent = 'Drawn.';
  if (!force && JSON.stringify(roots) === JSON.stringify(old)) return true;
  edit(() => { doc.roots = roots; if (force) { doc.arrows = []; sel = null; } }, 'src');
  const pb = pageBox(), W = stage.clientWidth, H = stage.clientHeight;
  const x0 = view.x + pb.x * view.k, y0 = view.y + pb.y * view.k;
  if (force || x0 < 0 || y0 < 0 || x0 + pb.w * view.k > W || y0 + pb.h * view.k > H) fit();
  return true;
}
srcEl.addEventListener('input', () => { clearTimeout(srcTimer); srcTimer = setTimeout(() => { srcTimer = null; applySource(srcEl.value); }, 350); });
srcEl.addEventListener('blur', () => {
  if (srcTimer) { clearTimeout(srcTimer); srcTimer = null; applySource(srcEl.value); }
  if (!srcEl.classList.contains('bad')) syncSource();
});
$('btn-copy').addEventListener('click', async () => {
  const text = serializeAll(doc.roots, fmt);
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch (e) { srcEl.focus(); srcEl.select(); toast('Select all and copy'); }
});
$('seg-fmt').addEventListener('click', e => {
  const b = e.target.closest('button[data-fmt]');
  if (!b) return;
  fmt = b.dataset.fmt;
  save(); refreshUI(); srcEl.blur(); syncSource();
});

// ------------------------------------------------------------------ inline retyping
let editing = null;       // { id, virt }
function placeEditor() {
  if (!editing) return;
  const ln = L.map.get(editing.virt ? editing.id + '~t' : String(editing.id));
  if (!ln) { closeEditor(false); return; }
  const w = Math.max(70, (ln.w + 16) * view.k);
  const fs = ln.font.size * view.k;
  inputEdit.style.width = w + 'px';
  inputEdit.style.fontSize = fs + 'px';
  inputEdit.style.fontFamily = stackOf(ln.font.family);
  inputEdit.style.height = (fs * 1.5) + 'px';
  inputEdit.style.left = (view.x + ln.x * view.k - w / 2) + 'px';
  inputEdit.style.top = (view.y + ln.y * view.k - fs * 1.05) + 'px';
}
function openEditor(id, virt, selectAll) {
  const f = findNode(id);
  if (!f) return;
  editing = { id, virt: !!virt };
  inputEdit.hidden = false;
  inputEdit.value = virt ? leafWords(f.n).join(' ') : f.n.label;
  placeEditor(); placeNodeBar();
  inputEdit.focus();
  if (selectAll !== false) inputEdit.select();
}
function closeEditor(commit) {
  if (!editing) return;
  const e = editing; editing = null;
  inputEdit.hidden = true;
  placeNodeBar();
  if (!commit) return;
  const v = inputEdit.value;
  edit(() => {
    const f = findNode(e.id);
    if (!f) return;
    if (e.virt) f.n.children = v === '' ? [] : [newNode(v, { word: true })];
    else f.n.label = v;
  });
}
inputEdit.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') { closeEditor(true); stage.focus && stage.focus(); }
  else if (e.key === 'Escape') closeEditor(false);
  else if (e.key === 'Tab') { e.preventDefault(); const id = editing && editing.id; closeEditor(true); if (id !== undefined) opAddChild(id); }
});
inputEdit.addEventListener('blur', () => closeEditor(true));

// ------------------------------------------------------------------ structure operations
function selNodeId() { return sel && sel.kind === 'node' ? sel.id : null; }
function opAddChild(id) {
  let nid;
  edit(() => { const f = findNode(id); if (!f) return; const n = newNode('X'); f.n.children.push(n); nid = n.id; sel = { kind: 'node', id: nid }; });
  if (nid !== undefined) openEditor(nid, false);
}
function opAddSister(id, after) {
  let nid;
  edit(() => {
    const f = findNode(id);
    if (!f || !f.parent) { toast('The top node has no sisters'); return; }
    const n = newNode('X');
    f.parent.children.splice(f.idx + (after ? 1 : 0), 0, n);
    nid = n.id; sel = { kind: 'node', id: nid };
  });
  if (nid !== undefined) openEditor(nid, false);
}
function opWrap(id) {
  let nid;
  edit(() => {
    const f = findNode(id);
    if (!f) return;
    const p = newNode('X');
    p.children = [f.n];
    if (f.parent) f.parent.children[f.idx] = p;
    else {                                          // a top node: the new parent takes its place on the page, one level up
      doc.roots[f.idx] = p;
      p.dx = f.n.dx || 0; p.dy = (f.n.dy || 0) - doc.opts.vgap; p.placed = true;
      delete f.n.dx; delete f.n.dy;
    }
    nid = p.id; sel = { kind: 'node', id: nid };
  });
  if (nid !== undefined) openEditor(nid, false);
}
function opDelete(id, subtree) {
  const f = findNode(id);
  if (!f) return;
  edit(() => {
    if (f.parent) {
      if (subtree || !f.n.children.length) f.parent.children.splice(f.idx, 1);
      else f.parent.children.splice(f.idx, 1, ...f.n.children);
    } else if (subtree || !f.n.children.length) doc.roots.splice(f.idx, 1);
    else {                                          // the daughters of a deleted top node stay where they are, each as its own tree
      for (const c of f.n.children) { const ln = L.map.get(String(c.id)); c.dx = ln ? ln.x : 0; c.dy = ln ? ln.y : 0; c.placed = true; }
      doc.roots.splice(f.idx, 1, ...f.n.children);
    }
    sel = null;
  });
}
function opArrowStart(id) {
  armed = { from: id };
  board.classList.add('armed');
  showHint('Now click the node it moved to  (Esc to cancel)');
  placeNodeBar();
}
function makeArrow(from, to) {
  if (to === from) { toast('Pick a different node'); return; }
  edit(() => {
    const a = { id: doc.nextId++, from, to, depth: Math.min(26 + 12 * doc.arrows.length, 100), label: '', dash: false };   // later arrows swing a bit lower, so they nest
    doc.arrows.push(a);
    sel = { kind: 'arrow', id: a.id };
  });
}
function opArrowFinish(toId) {
  const from = armed.from;
  cancelArmed();
  makeArrow(from, toId);
}
function cancelArmed() { armed = null; board.classList.remove('armed'); showHint(''); paintOverlay(); }
function showHint(t) { const h = $('hint'); h.textContent = t; h.classList.toggle('on', !!t); }

// ------------------------------------------------------------------ pointer: select, drag, pan, pinch
const ptrs = new Map();
let gesture = null, lastTap = { t: 0, id: null };
const shiftOf = e => e.shiftKey;
board.addEventListener('pointerdown', e => {
  board.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    gesture = { type: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
    return;
  }
  const tgt = e.target.closest ? e.target.closest('[data-nid],[data-aid],[data-ah],[data-agh]') : null;
  if (armed) {
    if (tgt && tgt.dataset.nid) opArrowFinish(realId(tgt.dataset.nid));
    else cancelArmed();
    gesture = null; return;
  }
  if (tgt && tgt.dataset.agh) { gesture = { type: 'agh', from: +tgt.dataset.agh, moved: false, sx: e.clientX, sy: e.clientY, at: null, target: null }; return; }
  if (tgt && tgt.dataset.ah) { gesture = { type: 'handle', id: +tgt.dataset.ah, before: snapshot(), moved: false }; return; }
  if (tgt && tgt.dataset.nid) {
    const id = realId(tgt.dataset.nid), virt = String(tgt.dataset.nid).includes('~');
    const now = Date.now();
    if (lastTap.id === tgt.dataset.nid && now - lastTap.t < 380) { sel = { kind: 'node', id }; paintOverlay(); refreshUI(); setTimeout(() => openEditor(id, virt), 30); lastTap = { t: 0, id: null }; gesture = null; return; }
    lastTap = { t: now, id: tgt.dataset.nid };
    sel = { kind: 'node', id }; paintOverlay(); refreshUI();
    gesture = { type: 'node', id, lx: e.clientX, ly: e.clientY, before: snapshot(), moved: false, solo: ui.mode === 'nudge' && shiftOf(e), build: ui.mode === 'build' && !shiftOf(e), sx: e.clientX, sy: e.clientY };
    return;
  }
  if (tgt && tgt.dataset.aid) { sel = { kind: 'arrow', id: +tgt.dataset.aid }; paintOverlay(); refreshUI(); gesture = null; return; }
  if (sel) { sel = null; paintOverlay(); refreshUI(); }
  closeEditor(true);
  gesture = { type: 'pan', lx: e.clientX, ly: e.clientY };
});
board.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  lastPtr = { x: e.clientX, y: e.clientY };
  if (!gesture) return;
  if (gesture.type === 'pinch' && ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / gesture.d);
    gesture.d = d;
    return;
  }
  if (ptrs.size > 1) return;
  if (gesture.type === 'pan') {
    view.x += e.clientX - gesture.lx; view.y += e.clientY - gesture.ly;
    gesture.lx = e.clientX; gesture.ly = e.clientY;
    applyView(); placeEditor();
  } else if (gesture.type === 'node') {
    if (!gesture.moved) {
      if (Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy) < 4) return;
      gesture.moved = true; pushUndo(gesture.before); lastKey = null;
      if (gesture.build) {                      // pull the piece off whatever it hangs from; it becomes a tree of its own
        const f0 = findNode(gesture.id);
        if (f0 && f0.parent) {
          const ln0 = L.map.get(String(f0.n.id));
          f0.parent.children.splice(f0.idx, 1);
          f0.n.dx = ln0 ? ln0.x : 0; f0.n.dy = ln0 ? ln0.y : 0; f0.n.placed = true;
          doc.roots.push(f0.n);
        }
      }
    }
    const ddx = (e.clientX - gesture.lx) / view.k, ddy = (e.clientY - gesture.ly) / view.k;
    gesture.lx = e.clientX; gesture.ly = e.clientY;
    const f = findNode(gesture.id);
    if (!f) return;
    f.n.dx = (f.n.dx || 0) + ddx; f.n.dy = (f.n.dy || 0) + ddy;
    if (gesture.solo) for (const c of f.n.children) { c.dx = (c.dx || 0) - ddx; c.dy = (c.dy || 0) - ddy; }
    liveRender();
  } else if (gesture.type === 'agh') {
    if (!gesture.moved && Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy) < 4) return;
    gesture.moved = true;
    gesture.at = toWorld(e.clientX, e.clientY);
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const t = hit && hit.closest ? hit.closest('[data-nid]') : null;
    const id = t ? realId(t.dataset.nid) : null;
    gesture.target = id !== null && id !== gesture.from ? id : null;
    preview = gesture.target !== null ? { type: 'relabel', id: gesture.target } : null;
    paintOverlay();
  } else if (gesture.type === 'handle') {
    const a = doc.arrows.find(x => x.id === gesture.id);
    if (!a) return;
    if (!gesture.moved) { gesture.moved = true; pushUndo(gesture.before); lastKey = null; }
    const r = board.getBoundingClientRect();
    const my = (e.clientY - r.top - view.y) / view.k;
    a.depth = depthFromMidY(a, L, my);
    liveRender();
  }
});
function liveRender() {
  render(); refreshUI();
  if (gesture && gesture.type === 'node' && gesture.build) {
    const ln = L.map.get(String(gesture.id)), f = findNode(gesture.id);
    preview = ln && f ? snapCandidate(ln.x, ln.y, subIds(f.n)) : null;
    paintOverlay();
    $('parts').classList.toggle('away', overParts(lastPtr.x, lastPtr.y));
  }
}
let lastPtr = { x: 0, y: 0 };
const overParts = (x, y) => { const r = $('parts').getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
function endPointer(e) {
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2 && gesture && gesture.type === 'pinch') gesture = null;
  if (ptrs.size === 0) {
    if (gesture && gesture.type === 'agh') {
      const g = gesture; gesture = null; preview = null;
      if (g.moved && g.target !== null) makeArrow(g.from, g.target);
      else if (!g.moved) opArrowStart(g.from);                    // just a click on the dot: then click the node it moved to
      else { paintOverlay(); }
    }
    else if (gesture && gesture.type === 'node' && gesture.moved && gesture.build) finishBuildDrop(e);
    else if (gesture && (gesture.type === 'node' || gesture.type === 'handle') && gesture.moved) { changed(); }
    gesture = null;
    placeNodeBar();
  }
}
board.addEventListener('pointerup', endPointer);
board.addEventListener('pointercancel', endPointer);
board.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.012));
  else { view.x -= e.deltaX; view.y -= e.deltaY; applyView(); placeEditor(); }
}, { passive: false });
$('btn-zoom-in').addEventListener('click', () => { const r = stage.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.25); });
$('btn-zoom-out').addEventListener('click', () => { const r = stage.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 0.8); });
$('btn-fit').addEventListener('click', fit);
window.addEventListener('resize', () => { placeEditor(); });

// ------------------------------------------------------------------ keyboard
function ensureVisible(id) {                 // pan just enough to keep a node in view when the keys walk off the screen
  const ln = L.map.get(String(id));
  if (!ln) return;
  const W = stage.clientWidth, H = stage.clientHeight, m = 60;
  const x = view.x + ln.x * view.k, y = view.y + ln.y * view.k;
  let dx = 0, dy = 0;
  if (x < m) dx = m - x; else if (x > W - m) dx = W - m - x;
  if (y < m + 30) dy = m + 30 - y; else if (y > H - m) dy = H - m - y;
  if (dx || dy) { view.x += dx; view.y += dy; applyView(); placeEditor(); }
}
function selectNode(id) { sel = { kind: 'node', id }; paintOverlay(); refreshUI(); ensureVisible(id); }
function moveSelection(key) {                // arrows walk the tree: up to the mother, down to the first daughter, sideways between sisters
  if (!doc.roots.length) return;
  const id = selNodeId();
  if (id === null) { selectNode(doc.roots[0].id); return; }
  const f = findNode(id);
  if (!f) return;
  const sibs = f.parent ? f.parent.children : doc.roots;
  const to = key === 'ArrowUp' ? f.parent : key === 'ArrowDown' ? (f.n.tri ? null : f.n.children[0]) : key === 'ArrowLeft' ? sibs[f.idx - 1] : sibs[f.idx + 1];
  if (to) selectNode(to.id);
}
function zoomBy(f) { const r = stage.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, f); }
function toggleMode() { ui.mode = ui.mode === 'build' ? 'nudge' : 'build'; applyUI(); save(); toast(ui.mode === 'build' ? 'Build: dragging joins and pulls pieces off' : 'Nudge: dragging only slides'); }
document.addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]')) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''));
  const mod = e.ctrlKey || e.metaKey, k = e.key, lower = k.length === 1 ? k.toLowerCase() : k;
  if (mod && !typing && lower === 'z') { e.preventDefault(); (e.shiftKey ? redo : undo)(); return; }
  if (mod && !typing && lower === 'y') { e.preventDefault(); redo(); return; }
  if (k === 'Escape') { if (armed) cancelArmed(); else if (sel) { sel = null; paintOverlay(); refreshUI(); } return; }
  if (typing) return;
  if (e.target.tagName === 'BUTTON' && (k === 'Enter' || k === ' ')) return;      // that is just pressing the focused button

  // anywhere on the page
  if (!mod && !e.altKey) {
    if (k === '?') { e.preventDefault(); $('dlg-keys').showModal(); return; }
    if (k === '0') { e.preventDefault(); fit(); return; }
    if (k === '+' || k === '=') { e.preventDefault(); zoomBy(1.25); return; }
    if (k === '-') { e.preventDefault(); zoomBy(0.8); return; }
    if (lower === 'm') { e.preventDefault(); toggleMode(); return; }
    if (k.startsWith('Arrow')) { e.preventDefault(); moveSelection(k); return; }
  }
  const id = selNodeId();
  if (id === null) {
    if (sel && sel.kind === 'arrow' && (k === 'Delete' || k === 'Backspace')) {
      e.preventDefault(); edit(() => { doc.arrows = doc.arrows.filter(a => a.id !== sel.id); sel = null; });
    }
    return;
  }

  // with a node selected
  if (e.altKey && k.startsWith('Arrow')) {        // Alt + arrows: nudge by 1 pt (Shift: 5 pt)
    e.preventDefault();
    const st = e.shiftKey ? 5 : 1;
    const d = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[k];
    edit(() => { const f = findNode(id); if (f) { f.n.dx = (f.n.dx || 0) + d[0]; f.n.dy = (f.n.dy || 0) + d[1]; } }, 'nudge');
    return;
  }
  if (mod) {
    if (lower === 'd') { e.preventDefault(); $('b-dup').click(); }
    else if (lower === 'b') { e.preventDefault(); $('b-bold').click(); }
    else if (lower === 'i') { e.preventDefault(); $('b-italic').click(); }
    return;
  }
  if (e.altKey) return;
  if (k === 'Tab') { e.preventDefault(); if (e.shiftKey) opWrap(id); else opAddChild(id); }          // Tab: daughter, Shift+Tab: mother
  else if (k === 'F1') { e.preventDefault(); opAddChild(id); }                                      // as in TreeForm: F1 down,
  else if (k === 'F2') { e.preventDefault(); opWrap(id); }                                          // F2 up
  else if (k === 'Enter') { e.preventDefault(); opAddSister(id, !e.shiftKey); }                      // Enter: sister to the right, Shift+Enter: to the left
  else if (lower === 'r') { e.preventDefault(); openEditor(id, false); }
  else if (lower === 't') { e.preventDefault(); $('b-tri').click(); }
  else if (lower === 'x') { e.preventDefault(); $('b-cross').click(); }
  else if (lower === 'w') { e.preventDefault(); $('b-word').click(); }
  else if (lower === 'a') { e.preventDefault(); opArrowStart(id); }
  else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); opDelete(id, !e.shiftKey); }   // Shift: keep what is below
});

// ------------------------------------------------------------------ the right-hand panel
const get = (o, path) => path.split('.').reduce((a, k) => a[k], o);
function setPath(o, path, v) { const ks = path.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; }
function refreshUI() {
  for (const el of document.querySelectorAll('[data-opt]')) {
    if (document.activeElement === el) continue;
    const v = get(doc.opts, el.dataset.opt);
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  }
  for (const b of $('seg-fmt').querySelectorAll('button')) b.classList.toggle('on', b.dataset.fmt === fmt);
  $('empty').hidden = doc.roots.length > 0;
  $('btn-undo').disabled = !undoStack.length;
  $('btn-redo').disabled = !redoStack.length;

  const nodeSel = sel && sel.kind === 'node' ? findNode(sel.id) : null;
  const arrSel = sel && sel.kind === 'arrow' ? doc.arrows.find(a => a.id === sel.id) : null;
  $('sel-none').hidden = !!(nodeSel || arrSel);
  $('sel-node').hidden = !nodeSel;
  $('sel-arrow').hidden = !arrSel;
  if (nodeSel) {
    const n = nodeSel.n, ln = L && L.map.get(String(n.id));
    if (document.activeElement !== $('n-label')) $('n-label').value = n.label;
    $('f-words').hidden = !(n.tri && n.children.length);
    if (document.activeElement !== $('n-words')) $('n-words').value = leafWords(n).join(' ');
    $('b-tri').classList.toggle('on', !!n.tri);
    $('b-tri').disabled = !n.children.length;
    $('b-cross').classList.toggle('on', !!n.cross);
    $('b-word').classList.toggle('on', !!(ln && ln.role === 'word'));
    $('b-word').disabled = !!n.children.length || doc.opts.wordMode !== 'auto';
    $('b-bold').classList.toggle('on', !!(ln && ln.font.bold));
    $('b-italic').classList.toggle('on', !!(ln && ln.font.italic));
    $('n-color').value = (ln && ln.font.color) || '#000000';
    if (document.activeElement !== $('n-size')) $('n-size').value = n.size || '';
    $('b-before').disabled = $('b-after').disabled = !nodeSel.parent;
  }
  if (arrSel) {
    if (document.activeElement !== $('a-label')) $('a-label').value = arrSel.label || '';
    $('a-depth').value = arrSel.depth;
    $('a-dash').checked = !!arrSel.dash;
    $('a-color').value = arrSel.color || doc.opts.arrow.color;
  }
}
for (const el of document.querySelectorAll('[data-opt]')) {
  const path = el.dataset.opt;
  const h = () => {
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'number') { v = parseFloat(el.value); if (!isFinite(v)) return; }
    else v = el.value;
    if (el.type === 'text' && !v.trim()) return;
    edit(() => setPath(doc.opts, path, v), 'opt:' + path);
  };
  el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' || el.type === 'color' ? 'change' : 'input', h);
  if (el.type === 'color') el.addEventListener('input', h);
}
const fontList = $('fonts');
for (const k of Object.keys(FONT_STACKS)) { const o = document.createElement('option'); o.value = k; fontList.appendChild(o); }

const withNode = fn => () => { const id = selNodeId(); if (id !== null) fn(id); };
const nodeEdit = (fn, key) => edit(() => { const f = findNode(sel.id); if (f) fn(f.n, f); }, key);
$('n-label').addEventListener('input', e => nodeEdit(n => { n.label = e.target.value; }, 'label'));
$('n-words').addEventListener('input', e => nodeEdit(n => {
  const v = e.target.value;
  n.children = v === '' ? [] : [newNode(v, { word: true })];
}, 'words'));
$('b-child').addEventListener('click', withNode(opAddChild));
$('b-after').addEventListener('click', withNode(id => opAddSister(id, true)));
$('b-before').addEventListener('click', withNode(id => opAddSister(id, false)));
$('b-wrap').addEventListener('click', withNode(opWrap));
$('b-del').addEventListener('click', withNode(id => opDelete(id, false)));
$('b-delsub').addEventListener('click', withNode(id => opDelete(id, true)));
$('b-arrow').addEventListener('click', withNode(opArrowStart));
$('b-tri').addEventListener('click', () => nodeEdit(n => { if (n.children.length) n.tri = !n.tri; }));
$('b-cross').addEventListener('click', () => nodeEdit(n => { n.cross = !n.cross; }));
$('b-word').addEventListener('click', () => nodeEdit(n => {
  const ln = L.map.get(String(n.id));
  n.word = !(ln && ln.role === 'word');
}));
$('b-bold').addEventListener('click', () => nodeEdit(n => { const ln = L.map.get(String(n.id)); n.bold = !(ln && ln.font.bold); }));
$('b-italic').addEventListener('click', () => nodeEdit(n => { const ln = L.map.get(String(n.id)); n.italic = !(ln && ln.font.italic); }));
$('n-color').addEventListener('input', e => nodeEdit(n => { n.color = e.target.value; }, 'ncolor'));
$('n-size').addEventListener('input', e => nodeEdit(n => { const v = parseFloat(e.target.value); if (isFinite(v) && v > 0) n.size = v; else delete n.size; }, 'nsize'));
const clearOffsets = x => { delete x.dx; delete x.dy; x.children.forEach(clearOffsets); };
$('b-reset').addEventListener('click', () => nodeEdit((n, f) => { if (f.parent) clearOffsets(n); else n.children.forEach(clearOffsets); }));
$('b-resetall').addEventListener('click', () => edit(() => { doc.roots.forEach(r => r.children.forEach(clearOffsets)); }));
const arrEdit = (fn, key) => edit(() => { const a = doc.arrows.find(x => x.id === sel.id); if (a) fn(a); }, key);
$('a-label').addEventListener('input', e => arrEdit(a => { a.label = e.target.value; }, 'alabel'));
$('a-depth').addEventListener('input', e => arrEdit(a => { a.depth = parseFloat(e.target.value); }, 'adepth'));
$('a-dash').addEventListener('change', e => arrEdit(a => { a.dash = e.target.checked; }));
$('a-color').addEventListener('input', e => arrEdit(a => { a.color = e.target.value; }, 'acolor'));
$('a-swap').addEventListener('click', () => arrEdit(a => { const t = a.from; a.from = a.to; a.to = t; }));
$('a-del').addEventListener('click', () => edit(() => { doc.arrows = doc.arrows.filter(a => a.id !== sel.id); sel = null; }));

$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);

// ------------------------------------------------------------------ examples, new
const EXAMPLES = [
  { name: 'What did John buy? (wh-movement, arrows)',
    src: "[CP [DP_i [D' [D what]]] [C' [C did_j] [TP [DP [D' [D John]]] [T' [T t_j] [VP [V' [V buy] [DP t_i]]]]]]]",
    arrows: [['t_j', 'did_j', 16], ['t_i', 'DP_i', 32]] },
  { name: 'The cat sat on the mat (triangle)',
    src: '[S [NP [Det the] [N cat]] [VP [V sat] [PP [P on] [NP \\roof the mat]]]]', arrows: [] },
  { name: 'LaTeX qtree: The dog barks',
    src: "\\Tree [.TP [.DP [.D' [.D the ] [.NP [.N dog ] ] ] ] [.T' [.T \\emph{-s} ] [.VP [.V' [.V bark ] ] ] ] ]", arrows: [] },
  { name: 'Labels with sub/superscripts and symbols',
    src: "[CP [C^0 \\emptyset] [TP [DP_{i} Pat] [T' [T^0 \\emph{will}] [vP [DP_{i} t] [v' [v^0 \\textit{v}] [VP [V^0 sleep]]]]]]]", arrows: [] },
];
for (const [i, ex] of EXAMPLES.entries()) { const o = document.createElement('option'); o.value = i; o.textContent = ex.name; $('examples').appendChild(o); }
const labelIn = (n, lab) => { if (n.label === lab) return n; for (const c of n.children) { const r = labelIn(c, lab); if (r) return r; } return null; };
const findLabel = lab => { for (const r of doc.roots) { const n = labelIn(r, lab); if (n) return n; } return null; };
function normDoc(d) {                                // a saved or opened document, filled in with anything an older one lacked
  const o = Object.assign({ arrows: [], nextId: 1000000 }, d);
  const def = DEFAULT_OPTS();
  o.opts = Object.assign(def, d.opts);
  for (const k of ['lab', 'word', 'line', 'arrow']) o.opts[k] = Object.assign(DEFAULT_OPTS()[k], (d.opts || {})[k]);
  if (!o.roots) o.roots = d.root ? [d.root] : [];
  delete o.root;
  for (const r of o.roots) if (r.placed === undefined) r.placed = true;
  return o;
}
function loadSource(text, arrows, align) {
  const roots = parseTree(text);
  pushUndo(snapshot());
  doc.roots = roots; doc.arrows = []; sel = null;
  autoPlace();
  if (align !== undefined) doc.opts.alignTerm = align;
  for (const [f, t, d] of arrows || []) {
    const a = findLabel(f), b = findLabel(t);
    if (a && b) doc.arrows.push({ id: doc.nextId++, from: a.id, to: b.id, depth: d || 26, label: '', dash: false });
  }
  lastKey = null;
  changed();
  fit();
}
$('examples').addEventListener('change', e => {
  const ex = EXAMPLES[e.target.value];
  e.target.value = '';
  if (ex) { loadSource(ex.src, ex.arrows, !!ex.align); fmt = /^\\Tree/.test(ex.src) ? 'qtree' : fmt; refreshUI(); syncSource(); }
});
$('btn-newtree').addEventListener('click', () => {
  if (doc.roots.length && !confirm('Clear the page and start again? (Undo brings it back.)')) return;
  edit(() => { doc.roots = []; doc.arrows = []; sel = null; });
  fit();
});

// ------------------------------------------------------------------ joining pieces
// Where would a piece centred at (cx, cy) join? Just under a node (as a daughter, level with its other daughters),
// or just above a top node (becoming its parent). A triangle hides what is under it, so nothing hangs from one.
function snapCandidate(cx, cy, exclude) {
  const o = doc.opts, thr = Math.max(26, o.vgap * 0.95);
  let best = null;
  for (const ln of L.map.values()) {
    if (ln.virt || exclude.has(ln.node.id)) continue;
    const n = ln.node;
    if (!n.tri) {
      let lo = ln.x, hi = ln.x;
      for (const k of ln.kids) { lo = Math.min(lo, k.x); hi = Math.max(hi, k.x); }
      const gapX = cx < lo ? lo - cx : cx > hi ? cx - hi : 0;
      const d = Math.hypot(gapX, cy - (ln.y + o.vgap)) + 0.02 * Math.abs(cx - ln.x);
      if (gapX < thr && Math.abs(cy - (ln.y + o.vgap)) < thr * 0.9 && (!best || d < best.d)) best = { type: 'child', id: n.id, d, cx, cy };
    }
    if (doc.roots.includes(n)) {
      const d = Math.hypot(cx - ln.x, cy - (ln.y - o.vgap));
      if (d < thr && (!best || d < best.d)) best = { type: 'parent', id: n.id, d, cx, cy };
    }
  }
  return best;
}
function applySnap(n, c) {              // n is a tree of its own (in doc.roots, or about to be)
  if (!c) return;
  const f = findNode(c.id);
  if (!f) return;
  if (c.type === 'child') {
    doc.roots = doc.roots.filter(r => r !== n);
    delete n.dx; delete n.dy;
    let at = f.n.children.length;
    for (let i = 0; i < f.n.children.length; i++) { const k = L.map.get(String(f.n.children[i].id)); if (k && k.x > c.cx) { at = i; break; } }
    f.n.children.splice(at, 0, n);
  } else {                               // n becomes the parent of the top node f.n
    const ln = L.map.get(String(f.n.id));
    const T = f.n;
    doc.roots = doc.roots.filter(r => r !== n);
    const at = doc.roots.indexOf(T);
    let ins = n.children.length;
    for (let i = 0; i < n.children.length; i++) { const k = L.map.get(String(n.children[i].id)); if (k && k.x > ln.x) { ins = i; break; } }
    n.children.splice(ins, 0, T);
    n.dx = ln.x; n.dy = ln.y - doc.opts.vgap; n.placed = true;
    delete T.dx; delete T.dy;
    doc.roots[at] = n;
  }
}
function finishBuildDrop(e) {
  const f = findNode(gesture.id);
  const ln = L.map.get(String(gesture.id));
  $('parts').classList.remove('away');
  if (f && overParts(e.clientX, e.clientY)) {
    doc.roots = doc.roots.filter(r => r !== f.n);
    sel = null;
    toast('Put away (Undo brings it back)');
  } else if (f && ln) {
    applySnap(f.n, snapCandidate(ln.x, ln.y, subIds(f.n)));
  }
  preview = null;
  changed();
}

// ------------------------------------------------------------------ the parts shelf
const CATS = ['X', 'C', 'T', 'v', 'V', 'D', 'N', 'P', 'A', 'Adv'];
const catOf = () => (ui.cat || 'X').trim() || 'X';
function makeTile(kind) {
  const cat = catOf();
  switch (kind) {
    case 'xp': return newNode(cat + 'P');
    case 'xbar': return newNode(cat + '′');
    case 'head': return newNode(cat + (ui.zero ? '^0' : ''));
    case 'tri': { const n = newNode(cat + 'P', { tri: true }); n.children = [newNode('words', { word: true })]; return n; }
    case 'word': return newNode('word', { word: true });
    case 'label': return newNode('label');
    case 'trace': return newNode('t', { word: true });
    default: return newNode('∅', { word: true });
  }
}
function relabelFor(label, cat) {       // keep the level (phrase / bar / head) of the node being renamed
  if (/^.+P$/.test(label)) return cat + 'P';
  if (/['′]$/.test(label)) return cat + '′';
  return cat + (ui.zero ? '^0' : '');
}
function refreshShelf() {
  const c = catOf();
  const txt = { xp: c + 'P', xbar: c + '′', head: c + (ui.zero ? '⁰' : ''), tri: c + 'P △' };
  for (const el of document.querySelectorAll('#parts [data-tile]')) if (txt[el.dataset.tile]) el.textContent = txt[el.dataset.tile];
  for (const el of document.querySelectorAll('#cats .chip')) el.classList.toggle('on', el.dataset.chip === c);
  if (document.activeElement !== $('p-cat')) $('p-cat').value = ui.cat;
  $('p-zero').checked = !!ui.zero;
}
for (const c of CATS) { const el = document.createElement('div'); el.className = 'chip'; el.dataset.chip = c; el.textContent = c; $('cats').appendChild(el); }
$('p-cat').addEventListener('input', e => { ui.cat = e.target.value; refreshShelf(); save(); });
$('p-zero').addEventListener('change', e => { ui.zero = e.target.checked; refreshShelf(); save(); });

const toWorld = (cx, cy) => { const r = stage.getBoundingClientRect(); return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k }; };
const overStage = (x, y) => { const r = stage.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
let pdrag = null;
function placeTile(kind, wx, wy) {
  let made = null;
  edit(() => {
    const n = makeTile(kind);
    n.dx = wx; n.dy = wy; n.placed = true;
    applySnapNew(n, snapCandidate(wx, wy, new Set()));
    sel = { kind: 'node', id: n.id };
    made = n;
  });
  if (made && (kind === 'word' || kind === 'label')) setTimeout(() => openEditor(made.id, false), 30);
}
function applySnapNew(n, c) { doc.roots.push(n); applySnap(n, c); }
function clickTile(kind) {              // a click, not a drag: hang it under the selected node, else drop it in the middle of the view
  const id = selNodeId(), f = id !== null ? findNode(id) : null;
  if (f && !f.n.tri) {
    let made;
    edit(() => { made = makeTile(kind); f.n.children.push(made); sel = { kind: 'node', id: made.id }; });
    if (kind === 'word' || kind === 'label') setTimeout(() => openEditor(made.id, false), 30);
  } else {
    const r = stage.getBoundingClientRect();
    const w = toWorld(r.left + r.width / 2, r.top + r.height / 2);
    placeTile(kind, w.x, w.y);
  }
}
$('parts').addEventListener('pointerdown', e => {
  const el = e.target.closest('[data-tile],[data-chip]');
  if (!el) return;
  e.preventDefault();
  pdrag = { el, kind: el.dataset.tile || null, chip: el.dataset.chip || null, sx: e.clientX, sy: e.clientY, moved: false, ghost: null };
  el.setPointerCapture(e.pointerId);
});
$('parts').addEventListener('pointermove', e => {
  if (!pdrag) return;
  if (!pdrag.moved) {
    if (Math.hypot(e.clientX - pdrag.sx, e.clientY - pdrag.sy) < 5) return;
    pdrag.moved = true;
    const g = pdrag.el.cloneNode(true);
    g.className += ' ghost';
    g.style.width = pdrag.el.offsetWidth + 'px';
    document.body.appendChild(g);
    pdrag.ghost = g;
  }
  pdrag.ghost.style.left = e.clientX + 'px'; pdrag.ghost.style.top = e.clientY + 'px';
  preview = null;
  if (overStage(e.clientX, e.clientY)) {
    if (pdrag.kind) { const w = toWorld(e.clientX, e.clientY); preview = snapCandidate(w.x, w.y, new Set()); }
    else {
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const t = hit && hit.closest ? hit.closest('[data-nid]') : null;
      if (t) preview = { type: 'relabel', id: realId(t.dataset.nid) };
    }
  }
  paintOverlay();
});
function endPaletteDrag(e, cancel) {
  if (!pdrag) return;
  const d = pdrag; pdrag = null;
  if (d.ghost) d.ghost.remove();
  const had = preview; preview = null; paintOverlay();
  if (cancel) return;
  if (!d.moved) {
    if (d.chip) { ui.cat = d.chip; refreshShelf(); save(); } else clickTile(d.kind);
    return;
  }
  if (!overStage(e.clientX, e.clientY)) return;
  if (d.kind) { const w = toWorld(e.clientX, e.clientY); placeTile(d.kind, w.x, w.y); }
  else if (had && had.type === 'relabel') {
    const cat = d.chip;
    edit(() => { const f = findNode(had.id); if (f) { f.n.label = relabelFor(f.n.label, cat); sel = { kind: 'node', id: f.n.id }; } });
  }
}
$('parts').addEventListener('pointerup', e => endPaletteDrag(e, false));
$('parts').addEventListener('pointercancel', e => endPaletteDrag(e, true));

// ------------------------------------------------------------------ mode switch and the text pane
function applyUI() {
  for (const b of $('seg-mode').querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === ui.mode);
  $('left').hidden = !ui.text;
  $('btn-text').classList.toggle('on', ui.text);
  $('btn-text').setAttribute('aria-pressed', ui.text ? 'true' : 'false');
  refreshShelf();
}
$('seg-mode').addEventListener('click', e => { const b = e.target.closest('button[data-mode]'); if (b) { ui.mode = b.dataset.mode; applyUI(); save(); } });
$('btn-text').addEventListener('click', () => {
  const before = stage.clientWidth;
  ui.text = !ui.text;
  applyUI(); save();
  view.x += (stage.clientWidth - before) / 2;       // keep the drawing where it was, relative to the middle of the page
  applyView(); placeEditor();
  if (ui.text) syncSource();
});
$('nb-arrow').addEventListener('click', withNode(opArrowStart));
$('nb-del').addEventListener('click', withNode(id => opDelete(id, true)));
$('nb-keep').addEventListener('click', withNode(id => opDelete(id, false)));
$('b-dup').addEventListener('click', withNode(id => edit(() => {
  const f = findNode(id), ln = L.map.get(String(id));
  if (!f || !ln) return;
  const clone = n => Object.assign({}, n, { id: doc.nextId++, children: n.children.map(clone) });
  const c = clone(f.n);
  c.dx = ln.x + 36; c.dy = ln.y + 36; c.placed = true;
  doc.roots.push(c);
  sel = { kind: 'node', id: c.id };
})));

// ------------------------------------------------------------------ exporting
function buildExport() {
  const Lm = layoutDoc();
  const tmp = mk('g', {});
  const bb = paintTree(tmp, Lm, false);
  const m = doc.opts.margin;
  const x = bb.minX - m, y = bb.minY - m, w = bb.maxX - bb.minX + 2 * m, h = bb.maxY - bb.minY + 2 * m;
  const svg = mk('svg', { xmlns: NS, viewBox: `${x} ${y} ${w} ${h}`, width: w + 'pt', height: h + 'pt' });
  if (!doc.opts.transparent) mk('rect', { x, y, width: w, height: h, fill: doc.opts.bg }, svg);
  svg.appendChild(tmp);
  return { svg, w, h };
}
const xmlOf = svg => '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
$('x-svg').addEventListener('click', () => { const { svg } = buildExport(); download(new Blob([xmlOf(svg)], { type: 'image/svg+xml' }), 'tree.svg'); });
$('x-png').addEventListener('click', () => {
  const { svg, w, h } = buildExport();
  const dpi = parseFloat($('x-dpi').value) || 300;
  let s = dpi / 72;
  s = Math.min(s, 16000 / Math.max(w, h));
  const W = Math.max(1, Math.round(w * s)), H = Math.max(1, Math.round(h * s));
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  const url = URL.createObjectURL(new Blob([xmlOf(svg)], { type: 'image/svg+xml' }));
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    c.getContext('2d').drawImage(img, 0, 0, W, H);
    c.toBlob(b => { download(b, 'tree.png'); URL.revokeObjectURL(url); }, 'image/png');
  };
  img.onerror = () => { toast('Could not make the PNG'); URL.revokeObjectURL(url); };
  img.src = url;
});
$('x-tex').addEventListener('click', () => download(new Blob([toTikz(true)], { type: 'text/x-tex' }), 'tree.tex'));
$('x-pdf').addEventListener('click', () => {
  const { svg } = buildExport();
  const host = $('print-host');
  host.innerHTML = '';
  host.appendChild(svg);
  $('dlg-export').close();
  setTimeout(() => window.print(), 80);
});
window.addEventListener('afterprint', () => { $('print-host').innerHTML = ''; });
$('x-json').addEventListener('click', () => download(new Blob([JSON.stringify({ app: 'shapes-trees', version: 1, fmt, doc }, null, 1)], { type: 'application/json' }), 'tree.json'));
$('x-open').addEventListener('click', () => $('x-file').click());
$('x-file').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (!j || !j.doc || !(j.doc.roots || j.doc.root)) throw new Error('not a tree file');
    pushUndo(snapshot());
    doc = normDoc(j.doc);
    sel = null; if (j.fmt) fmt = j.fmt;
    changed(); fit(); $('dlg-export').close();
  } catch (err) { toast('That is not a saved tree'); }
});
$('btn-export').addEventListener('click', () => $('dlg-export').showModal());
$('btn-help').addEventListener('click', () => $('dlg-help').showModal());
$('btn-keys').addEventListener('click', () => $('dlg-keys').showModal());

// ------------------------------------------------------------------ saving
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify({ doc, fmt, ui })); } catch (e) { /* full or blocked */ } }, 200);
}
let toastTimer = null;
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 2200); }

// ------------------------------------------------------------------ start
function start() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE)); } catch (e) { /* ignore */ }
  if (saved && saved.doc && (saved.doc.roots || saved.doc.root)) {
    doc = normDoc(saved.doc);
    fmt = saved.fmt || 'bracket';
    if (saved.ui) ui = Object.assign(ui, saved.ui);
  } else {
    doc = { nextId: 1, roots: [], arrows: [], opts: DEFAULT_OPTS() };      // a blank page
  }
  applyUI(); render(); refreshUI(); syncSource(); fit();
}
start();
// a font that finishes loading after the first paint changes the widths: draw again once the browser is ready
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { render(); });

})();
