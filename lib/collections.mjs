// Grouping specs by collection, and the order the groups come out in.
//
// Shared by the home page's rail, its project sections and the public project
// page because all three must agree: a name has one rank, wherever the reader
// meets it. Two copies of this rule would drift the first time either was
// tuned.

/**
 * When each collection name was last active: the newest stamp on any spec
 * carrying it — `created`, `updated`, or the newest comment (`commented` maps
 * spec id -> ms). A thread moving is the name being alive as much as an edit
 * is. The comment times ride in as data: the comment stores are IO and this
 * module stays pure.
 *
 * Computed over the whole store, never just the view being grouped. The rail
 * lists a name once across every project, so a name quiet HERE but alive THERE
 * must not change rank with the project a reader has selected — the rail and
 * the groups would read differently. Uncollected gets no entry: it is always
 * last whatever its stamps say.
 *
 * @param {object[]} specs spec meta (the whole store)
 * @param {Map<string, number>} [commented] spec id -> ms of its newest comment
 * @returns {Map<string, number>} collection name -> recency, in ms
 */
export function collectionRecency(specs, commented = new Map()) {
  const at = new Map();
  for (const m of specs) {
    const key = m.collection || '';
    if (!key) continue;
    const t = Math.max(m.created || 0, m.updated || 0, commented.get(m.id) || 0);
    at.set(key, Math.max(at.get(key) || 0, t));
  }
  return at;
}

/**
 * Group specs by collection, ordered by the names' recency.
 *
 * `recency` is a rank per NAME — what collectionRecency returned — so every
 * view sorts the same name the same way. The most recently active name leads;
 * the tie falls to alphabetical, so a store where nothing has happened yet
 * still reads predictably.
 *
 * Uncollected ('') is always last and appears only when something is in it: it
 * is the absence of a collection, not one you can place.
 *
 * @param {object[]} specs spec meta (the scope to group)
 * @param {Map<string, number>} [recency] collection name -> recency, in ms
 * @returns {{ order: {key: string, specs: object[]}[], named: string[] }}
 */
export function groupByCollection(specs, recency = new Map()) {
  const groups = new Map();
  for (const m of specs) {
    const key = m.collection || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const at = (k) => recency.get(k) || 0;
  const named = [...groups.keys()].filter((k) => k !== '')
    .sort((a, b) => at(b) - at(a) || a.toLowerCase().localeCompare(b.toLowerCase()));
  const order = groups.has('') ? [...named, ''] : named;
  return { order: order.map((k) => ({ key: k, specs: groups.get(k) })), named };
}

/** What an unnamed collection reads as. Not a name anyone typed. */
export const UNCOLLECTED = 'Uncollected';
