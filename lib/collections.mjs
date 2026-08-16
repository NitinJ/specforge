// Grouping specs by collection, and the order the groups come out in.
//
// Shared by the home page and the public project page because the two must
// agree: a reader looking at a shared project and the owner looking at the same
// project selected on their own home page should see the same groups in the same
// order. Two copies of this rule would drift the first time either was tuned.

/**
 * Group specs by collection, ordered.
 *
 * `ranked` is the order the owner arranged (Move up / Move down). Anything it
 * does not name falls in after, alphabetically, so a fresh store reads A-Z and
 * stays predictable until someone takes a position on it.
 *
 * Uncollected ('') is always last and appears only when something is in it: it
 * is the absence of a collection, not one you can place.
 *
 * @param {object[]} specs spec meta
 * @param {string[]} [ranked] collection names in the owner's chosen order
 * @returns {{ order: {key: string, specs: object[]}[], named: string[] }}
 */
export function groupByCollection(specs, ranked = []) {
  const groups = new Map();
  for (const m of specs) {
    const key = m.collection || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const rank = new Map(ranked.map((name, i) => [name, i]));
  const at = (k) => (rank.has(k) ? rank.get(k) : Number.MAX_SAFE_INTEGER);
  const named = [...groups.keys()].filter((k) => k !== '')
    .sort((a, b) => at(a) - at(b) || a.toLowerCase().localeCompare(b.toLowerCase()));
  const order = groups.has('') ? [...named, ''] : named;
  return { order: order.map((k) => ({ key: k, specs: groups.get(k) })), named };
}

/** What an unnamed collection reads as. Not a name anyone typed. */
export const UNCOLLECTED = 'Uncollected';
