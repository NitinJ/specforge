#!/usr/bin/env node
// Mine the human review-comment corpus across the SpecForge store: every
// human-authored comment, keyed to the spec (title/type) and the section it
// anchored to. This is the Learn input for the tune-templates skill — cluster
// these into recurring cross-spec themes, then propose template changes.
//
// Agent replies are excluded by `kind`, not by name: authors are free text, so
// every reviewer's comment counts and only the agent's are dropped. The point is
// to learn what people keep asking for.
//
// Usage:
//   node lib/mine-comments.mjs           # human-readable, one line per comment
//   node lib/mine-comments.mjs --json    # structured, for programmatic clustering

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { specsDir } from './store-paths.mjs';
import { isAgent } from './comments.mjs';
import { isMain } from './is-main.mjs';

/** @returns {{ specs: Array, total: number }} */
export function mineComments() {
  let entries;
  try {
    entries = readdirSync(specsDir(), { withFileTypes: true });
  } catch {
    return { specs: [], total: 0 };
  }
  const out = [];
  let total = 0;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const cpath = join(specsDir(), e.name, 'comments.json');
    const mpath = join(specsDir(), e.name, 'meta.json');
    if (!existsSync(cpath)) continue;
    let store;
    let meta;
    try {
      store = JSON.parse(readFileSync(cpath, 'utf8'));
    } catch {
      continue;
    }
    try {
      meta = JSON.parse(readFileSync(mpath, 'utf8'));
    } catch {
      meta = {};
    }
    const threads = (store.threads || [])
      .map((t) => {
        const human = (t.comments || []).filter((c) => !isAgent(c));
        total += human.length;
        if (!human.length) return null;
        const block = (t.anchor && t.anchor.block) || {};
        return {
          section: (block.sectionPath || []).join('>') || '(none)',
          tag: block.tag || '',
          comments: human.map((c) => c.body),
        };
      })
      .filter(Boolean);
    if (threads.length) {
      out.push({ id: e.name, title: meta.title || e.name, type: meta.type || '?', template: !!meta.template, threads });
    }
  }
  out.sort((a, b) => b.threads.length - a.threads.length);
  return { specs: out, total };
}

function main(argv) {
  const { specs, total } = mineComments();
  if (argv.includes('--json')) {
    console.log(JSON.stringify(specs, null, 1));
    return;
  }
  console.log(`# ${specs.length} specs with human comments · ${total} human comments`);
  for (const s of specs) {
    console.log(`\n## ${s.title}  [${s.type}${s.template ? ' · template' : ''}]  (${s.threads.length} threads)`);
    for (const t of s.threads) {
      for (const body of t.comments) {
        console.log(`  · [${t.section}] ${String(body ?? '').replace(/\s+/g, ' ').slice(0, 200)}`);
      }
    }
  }
}

if (isMain(import.meta.url)) main(process.argv.slice(2));
