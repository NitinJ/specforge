// SpecForge configuration: packaged defaults merged with a per-project override
// at <project>/.specforge/config.json. These defaults are the machine-readable
// source of truth for the house rules (the prose lives in templates/house-rules.md).

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** @typedef {{onePRPerStage:boolean, tddRequired:boolean}} Cadence */

export const DEFAULTS = {
  // Where specs live. null → resolved to <project>/specs at load time.
  specsDir: null,
  defaultTheme: 'dark',
  port: 4178,
  naming: '{date}-{slug}-spec.html',
  // Sections every spec must contain (by stable section id). Enforced by the lint.
  requiredSections: [
    'tldr', 'overview', 'goals', 'design', 'decisions',
    'impl-plan', 'task-tracker', 'impl-decisions', 'deviations', 'tradeoffs',
  ],
  optionalSections: ['open-questions', 'appendix'],
  cadence: { onePRPerStage: true, tddRequired: true },
  trackComments: false,
};

/** Expand a leading ~ to the user's home directory. */
export function expandHome(p) {
  if (typeof p !== 'string') return p;
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

/**
 * Load the merged SpecForge config for a project.
 * @param {string} [projectDir] project root (defaults to cwd)
 * @returns {typeof DEFAULTS} merged config with specsDir resolved to an absolute-ish path
 */
export function loadConfig(projectDir = process.cwd()) {
  let override = {};
  const cfgPath = join(projectDir, '.specforge', 'config.json');
  if (existsSync(cfgPath)) {
    try {
      override = JSON.parse(readFileSync(cfgPath, 'utf8'));
    } catch {
      override = {};
    }
  }
  const merged = {
    ...DEFAULTS,
    ...override,
    cadence: { ...DEFAULTS.cadence, ...(override.cadence || {}) },
  };
  merged.specsDir = merged.specsDir ? expandHome(merged.specsDir) : join(projectDir, 'specs');
  return merged;
}
