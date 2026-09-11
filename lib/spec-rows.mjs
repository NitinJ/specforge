// The tree a list of specs is drawn as, on every page that lists them.
//
// The home page and the shared project page list the same specs, and both draw
// a parent with its children directly beneath it. The layout lives here, once,
// for the reason the palette and the list CSS live in server/theme.mjs: two
// copies drift, and a reviewer then meets a different tree from the owner's.

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * Draw a group's specs as a tree: parents at the top level, children under them.
 *
 * A child does not get a row of its own at the top level. The whole point of
 * splitting a spec up is to reduce what a reviewer has to hold in their head,
 * and a list that grows a row per child would be longer than it was before the
 * feature existed.
 *
 * One level of indentation, and only one. A grandchild is drawn under its own
 * parent, which is itself indented once: deeper nesting is the panel's job, and
 * a list indented four times is a list nobody can scan. `nested` marks a row
 * that is deeper than it is drawn, so it can name its parent instead.
 *
 * A child whose parent is not in `list` at all is drawn at the top level, which
 * is where an orphan from an interrupted delete belongs.
 */
function orderWithChildren(list, childrenByParent) {
  const present = new Set(list.map((m) => m.id));
  const out = [];
  const seen = new Set();

  // Depth first, so a spec is always directly below the one it belongs to. The
  // INDENT is capped at one; the ORDER is not.
  const walk = (meta, depth) => {
    if (seen.has(meta.id)) return;   // a hand-written cycle must not loop here
    seen.add(meta.id);
    out.push({ meta, depth: Math.min(depth, 1), nested: depth > 1 });
    for (const kid of childrenByParent.get(meta.id) || []) walk(kid, depth + 1);
  };

  for (const m of list) {
    // spec-tree-ok: reads this row's own field to decide whether it is a root here
    const parent = m.parent || null;
    if (parent && present.has(parent)) continue;
    walk(m, 0);
  }

  // Anything left is inside a cycle, so no walk reached it. Drawn at the top
  // level rather than dropped: a spec missing from the page is worse than one
  // drawn in the wrong place, and the page is how you would notice.
  for (const m of list) if (!seen.has(m.id)) walk(m, 0);

  return out;
}

/** parent id → its children among `list`, in the order the list gives them. */
function indexChildren(list) {
  const byParent = new Map();
  for (const m of list) {
    // spec-tree-ok: groups rows by the field they carry; does not walk it
    const parent = m.parent || null;
    if (!parent) continue;
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(m);
  }
  return byParent;
}

/**
 * Every spec, with its tree root's project and collection for grouping.
 *
 * Returns copies. The stored fields are untouched: this decides which section a
 * row is drawn in, and nothing else. A child is drawn under its parent, so it
 * has to be in its parent's section: grouped by its own collection it would
 * render as a root somewhere its parent is not. A spec whose parent is not in
 * `list`, or that sits in a cycle, keeps its own address.
 *
 * `filed` is what the spec says it is. It differs from the drawn address only
 * for a child moved away from its parent, and the home page's move controls
 * read it back off the row.
 */
export function groupByRoot(list) {
  const byId = new Map(list.map((m) => [m.id, m]));
  const rootOf = (m) => {
    const seen = new Set([m.id]);
    let cur = m;
    for (;;) {
      // spec-tree-ok: walks the rows this page already has, not the store
      const parent = cur.parent && byId.get(cur.parent);
      if (!parent) return cur;
      // A ring has no root. Whichever member the walk happens to stop on is not
      // this one, and taking its address would file two specs in each other's
      // sections. Everything in a cycle keeps its own.
      if (seen.has(parent.id)) return m;
      seen.add(parent.id);
      cur = parent;
    }
  };
  return list.map((m) => {
    const root = rootOf(m);
    if (root === m) return m;
    return {
      ...m,
      project: root.project || null,
      collection: root.collection || null,
      filed: { project: m.project || null, collection: m.collection || null },
    };
  });
}

/**
 * One group's rows, in the order and at the indent they are drawn.
 *
 * Every spec in `list` gets exactly one entry. `kids` counts the children drawn
 * in this group, so a parent shows a number the reader can reconcile with what
 * is on screen. `parentTitle` is set on every child row: the home page's flat
 * views show it on all of them, and both pages show it on a nested row.
 *
 * @param {object[]} list spec metas, in the order roots and siblings are drawn
 * @returns {{meta:object, depth:0|1, nested:boolean, kids:number, parentTitle:string}[]}
 */
export function layoutTree(list) {
  const byParent = indexChildren(list);
  const titles = new Map(list.map((m) => [m.id, m.title || 'Untitled']));
  return orderWithChildren(list, byParent).map(({ meta, depth, nested }) => ({
    meta,
    depth,
    nested,
    kids: (byParent.get(meta.id) || []).length,
    // spec-tree-ok: names this row's own parent, does not walk the edge
    parentTitle: depth ? titles.get(meta.parent) || '' : '',
  }));
}

/**
 * The two marks a tree row carries after its title: the child count on a
 * parent, and the parent's name on a child (shown only where the indent cannot
 * say it). Styled by the shared list CSS.
 */
export function treeMarks(kids, parentTitle) {
  const count = kids
    ? `<span class="kids" title="${kids} child spec${kids === 1 ? '' : 's'}">${kids}</span>` : '';
  const under = parentTitle
    ? `<span class="under" title="Child of ${esc(parentTitle)}">in ${esc(parentTitle)}</span>` : '';
  return count + under;
}
