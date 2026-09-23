// Grouping specs by collection, and the order the groups come out in.
//
// Shared by the home page and the public project page because the two must
// agree: a reader looking at a shared project and the owner looking at the same
// project selected on their own home page should see the same groups in the same
// order. Two copies of this rule would drift the first time either was tuned.

/**
 * Group specs by collection, ordered by recency.
 *
 * A collection is as recent as its most recently active member: the newest of
 * that spec's `created` and `updated` stamps and the newest comment on it. A
 * thread moving is the collection being alive as much as an edit is, so the
 * comment times ride in as `commented` (spec id -> ms) — the comment stores are
 * IO and this module stays pure.
 *
 * The most recently active collection leads; the tie falls to alphabetical, so
 * a store where nothing has happened yet still reads predictably.
 *
 * Uncollected ('') is always last and appears only when something is in it: it
 * is the absence of a collection, not one you can place.
 *
 * @param {object[]} specs spec meta
 * @param {Map<string, number>} [commented] spec id -> ms of its newest comment
 * @returns {{ order: {key: string, specs: object[]}[], named: string[] }}
 */
export function groupByCollection(specs, commented = new Map()) {
  const groups = new Map();
  for (const m of specs) {
    const key = m.collection || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const activity = (m) => Math.max(m.created || 0, m.updated || 0, commented.get(m.id) || 0);
  const recency = (k) => groups.get(k).reduce((t, m) => Math.max(t, activity(m)), 0);
  const named = [...groups.keys()].filter((k) => k !== '')
    .sort((a, b) => recency(b) - recency(a) || a.toLowerCase().localeCompare(b.toLowerCase()));
  const order = groups.has('') ? [...named, ''] : named;
  return { order: order.map((k) => ({ key: k, specs: groups.get(k) })), named };
}

/** What an unnamed collection reads as. Not a name anyone typed. */
export const UNCOLLECTED = 'Uncollected';
