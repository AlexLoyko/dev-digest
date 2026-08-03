import type { FeatureModelChoice } from '@devdigest/shared';

/** How many ranked source files to sample (via repoIntel.getConventionSamples). */
export const SAMPLE_FILE_COUNT = 12;

/** Per-file budget for sampled source. Files are truncated, never skipped. */
export const MAX_FILE_CHARS = 6_000;

/** Per-file budget for config files — they are dense, so a smaller slice. */
export const MAX_CONFIG_CHARS = 3_000;

/**
 * Consistency floor. Deliberately LOW: a rule the repo follows inconsistently is
 * the most useful thing to surface, so the gate must not delete exactly the
 * mixed-practice candidates the rubric asks the model to report. Only noise
 * (a single occurrence against many counterexamples) falls below this.
 */
export const MIN_CONFIDENCE = 0.35;

/** Hard cap on persisted candidates per scan. */
export const MAX_CANDIDATES = 20;

/**
 * Cap on tier-2 evidence reads (a candidate citing a file we never sampled).
 * Bounds the filesystem cost of a pathological model response.
 */
export const MAX_FALLBACK_READS = 10;

/**
 * Config files worth showing the model, in priority order. Read best-effort —
 * a repo has only a handful of these and missing ones are normal.
 */
export const CONFIG_PATHS = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  '.prettierrc.yml',
  '.prettierrc.yaml',
  'prettier.config.js',
  'prettier.config.mjs',
  'prettier.config.cjs',
  'tsconfig.json',
  'tsconfig.base.json',
] as const;

/**
 * Module-local default model. Extraction is a cheap bulk-reading task, so it
 * defaults to a cheap model rather than the registry's `gpt-5.4`. The workspace
 * can override it in Settings → Feature Models (`FeatureModelId: 'conventions'`),
 * which is exactly the "caller keeps its own dynamic default" case that
 * `getFeatureModelOverride` documents.
 */
export const DEFAULT_MODEL: FeatureModelChoice = {
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
};
