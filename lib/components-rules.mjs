// Generates references/spec-components.md: the selection rules an authoring
// agent reads before writing a spec.
//
// Generated rather than written, for the same reason the stylesheet is: a rule
// that lives apart from the component it governs goes stale, and the create-spec
// skill reads this file every time it authors. The prose in each entry comes
// from the definition itself.

import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { COMPONENTS, FAMILIES, layerOf } from '../components/index.mjs';
import { VERSION } from './components-build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function rulesPath() {
  return join(ROOT, 'references', 'spec-components.md');
}

const FAMILY_TITLE = {
  notice: 'Notices',
  inline: 'Inline',
  data: 'Data',
  code: 'Code',
  structure: 'Structure',
  spec: 'Spec structure',
};

/**
 * The selection table: what the block asserts, and what to reach for.
 *
 * Ordered by how often the choice comes up rather than by family, because this
 * is the table an author scans mid-sentence.
 */
const SELECTION = [
  ['A choice was made between alternatives', 'callout decision'],
  ['We believe X but have not verified it', 'callout assumption'],
  ['This can fail in a specific way', 'callout risk'],
  ['We are departing from a principle or an existing pattern', 'callout deviation'],
  ['A limit exists that we cannot move', 'callout constraint'],
  ['A number, with a method behind it', 'evidence + src'],
  ['Several headline numbers at once', 'stats'],
  ['Options weighed against each other', 'table compare'],
  ['Items compared on attributes', 'table'],
  ['An ordered procedure', 'steps'],
  ['Conditions to verify in any order', 'checklist'],
  ['A requirement that is normative', 'kw'],
  ['A concrete instance of a rule', 'callout example'],
  ['Somebody else’s words', 'callout quote'],
  ['Something that will break if ignored', 'callout danger'],
  ['Something to be careful about', 'callout warning'],
  ['Context, no claim', 'callout note'],
  // The three ways to draw. Ordered by how often the choice is the right one:
  // most diagrams in a spec are graphs, and most of what authors reach for a
  // diagram to say is not a diagram at all.
  ['Nodes and the relationships between them', 'pre[data-lang="mermaid"]'],
  ['A picture where the exact placement carries meaning', 'flow or figure, inline SVG'],
  ['Anything that must reflow at the reader’s width', 'table, grid, card, steps'],
  // The interactive three. Placed after the drawing rows and before the fallback
  // because they are the least often correct: each one asks a reader to act
  // before they can read, and most blocks should not.
  ['Detail a reader needs on a second pass, not the first', '<details class="disclosure">'],
  ['The same thing in two to five alternative forms', '.tabs'],
  ['A long table a reader may want ordered differently', 'table.sortable'],
  ['None of the above', 'a paragraph'],
];

/**
 * Choosing between the three ways to draw.
 *
 * Its own section because the selection table can say which to use and not why,
 * and the why is what stops an author reaching for the most powerful option
 * every time. Written here rather than in a component's `rule` because it is a
 * comparison between three of them.
 */
function drawingRules() {
  return [
    '## Drawing',
    '',
    'Three ways, and the choice is not about how the result looks.',
    '',
    '| If the diagram is | Use | Because |',
    '|---|---|---|',
    '| A graph: nodes and the relationships between them. Flowchart, sequence, '
      + 'state, ER, class. | `pre[data-lang="mermaid"]` | The relationships are the content and the '
      + 'position is not. Editable in one line, and it survives markdown as source. |',
    '| A picture where position carries meaning: a timeline to scale, a screen '
      + 'layout, an annotated arrangement, or anything with no matching mermaid diagram type. | '
      + '`.flow` or `figure` with inline SVG | Mermaid computes layout and will not honour a '
      + 'specific placement. Costs a sidecar file on export. |',
    '| Not a diagram: a comparison, a grid of peer items, a UI mock, anything '
      + 'that must reflow at the reader’s width. | `table`, `.grid`, `.card`, `.steps` | A '
      + 'diagram of a table is a table drawn badly, and these reflow, which no SVG does. |',
    '',
    '**Mermaid is the default for a graph.** An inline SVG of the same graph costs '
    + 'a coordinate for every node and every edge endpoint, has to be recomputed to '
    + 'move one box, and leaves the spec as a linked `.svg` file on export. A mermaid '
    + 'diagram is the same text at both ends and renders natively on GitHub.',
    '',
    '**Past about 15 nodes a mermaid diagram stops being readable** at a spec’s '
    + 'column width. Split it, or say the same thing in a table. Asserted from the '
    + 'content width, not measured against readers.',
    '',
    '**`mermaid` is the one declared language that is never highlighted**, and the '
    + 'one case where declaring a language on a block that is not code is correct. '
    + 'The rule against declaring a language on ASCII diagrams and pseudo-code is '
    + 'unchanged: those stay undeclared.',
    '',
    '**A diagram is one comment target.** A reviewer comments on the diagram, not '
    + 'on a node inside it, so a picture carrying several separate claims is several '
    + 'diagrams or a table.',
    '',
    '**It renders where the review layer runs**: the daemon and a published copy. '
    + 'From `file://` a diagram shows its source as a code block, the same trade the '
    + 'themes and the highlighter already make.',
    '',
  ];
}

/**
 * What an interactive component costs, which is the half an agent will not
 * infer from a rule.
 *
 * Its own section for the same reason `drawingRules()` is: the selection table
 * says which to use and cannot say what using it gives up, and what it gives up
 * is what should stop an author reaching for one out of enthusiasm.
 */
function interactiveRules() {
  return [
    '## Interactive components',
    '',
    'Three blocks respond to a reader. They are documented at '
      + '`/components-interactive` and they ship differently: the stylesheet is '
      + 'stamped into the spec as usual, but the behaviour is served by the review '
      + 'layer and is not part of the file.',
    '',
    '**Every one of them is complete with no JavaScript.** A spec opened from '
      + '`file://`, or served where the script fails, shows every tab panel in order '
      + 'and every table row as written. The script REDUCES a document that is '
      + 'already whole; it never builds one. Write the content as though nothing '
      + 'will run, because sometimes nothing does.',
    '',
    '| Component | Without the script | The cost to weigh |',
    '|---|---|---|',
    '| `<details class="disclosure">` | Fully interactive: the element needs no '
      + 'script at all. | Its headings are **not in the contents rail**, and a reader '
      + 'skimming the outline will not know they exist. |',
    '| `.tabs` | Every panel, in order, each under its label. | Content behind a '
      + 'label a reader does not click is content they never read. |',
    '| `table.sortable` | The table, in the order you wrote it. | The authored '
      + 'order is what exports and what a reader sees first, so it still has to be '
      + 'the order that means something. |',
    '',
    '**The disclosure is the safe one.** Three document products ship it natively '
      + '(Notion’s toggle list, Confluence’s Expand macro, Google Docs’ '
      + 'collapsible heading) and it needs no script. Tabs are shipped natively by '
      + 'none of them; reach for them only when a reader genuinely needs exactly one '
      + 'of the alternatives.',
    '',
    '**Never put the argument inside one.** A section heading behind a summary '
      + 'line is a part of the document a reader can miss, and the lint says so '
      + '(`disclosure-depth`). A disclosure holds the working, not the conclusion.',
    '',
  ];
}

export function buildRules() {
  const L = [];
  L.push('# SpecForge components');
  L.push('');
  L.push(`Generated by \`components build\` from \`components/\` (library v${VERSION}). Do not edit.`);
  L.push('');
  L.push('Every spec carries the component stylesheet as a stamped block, so these');
  L.push('classes are available in any spec and nothing needs importing. Pick a');
  L.push('component by asking what the block asserts. Appearance is never the entry');
  L.push('point: a notice takes a type, and its tone follows from the type.');
  L.push('');
  L.push('## Choosing');
  L.push('');
  L.push('| If the block asserts | Use |');
  L.push('|---|---|');
  for (const [when, use] of SELECTION) L.push(`| ${when} | \`${use}\` |`);
  L.push('');
  L.push('**Density.** A component is emphasis, and emphasis is a budget. No more than');
  L.push('one notice per 400 words of a section, and never two notices in immediate');
  L.push('succession: two adjacent notices are a table with two rows.');
  L.push('');
  L.push(...drawingRules());
  L.push(...interactiveRules());

  for (const family of FAMILIES) {
    const items = COMPONENTS.filter((c) => c.family === family);
    if (!items.length) continue;
    L.push(`## ${FAMILY_TITLE[family] || family}`);
    L.push('');
    for (const c of items) {
      // A notice is never written alone: the class is `callout <type>`, and a
      // heading showing `.note` would teach the wrong markup.
      const head = c.selector ? `\`${c.selector}\``
        : c.family === 'notice' ? `\`.callout.${c.name}\``
          : c.kind === 'element' ? `\`<${c.name}>\`` : `\`.${c.name}\``;
      // Marked in the heading, so an author scanning a family section can tell
      // that `<details class="disclosure">` behaves differently from the
      // `.panel` two entries below it.
      const layer = layerOf(c) === 'interactive' ? ' · interactive' : '';
      L.push(`### ${head}${c.tone ? ` · ${c.tone}` : ''}${layer}`);
      L.push('');
      L.push(c.rule);
      if (c.requires && c.requires.length) {
        L.push('');
        L.push(`Must contain: ${c.requires.map((r) => `${r}`).join('; ')}.`);
      }
      if (c.variants && c.variants.length) {
        L.push('');
        L.push(`Variants: ${c.variants.map((v) => `\`${v}\``).join(', ')}.`);
      }
      L.push('');
      L.push('```html');
      L.push(c.example);
      L.push('```');
      L.push('');
    }
  }
  return L.join('\n');
}

/** Write the rules file. Returns whether it changed. */
export function writeRules() {
  const md = buildRules();
  const path = rulesPath();
  let before = null;
  try { before = readFileSync(path, 'utf8'); } catch { /* first build */ }
  if (before === md) return { path, changed: false, bytes: md.length };
  writeFileSync(path, md);
  return { path, changed: true, bytes: md.length };
}
