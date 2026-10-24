import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, SKILLS_DIR, writeJson } from './lib.mjs';

// Переносит проверенный и одобренный скил из кэша в data/skills/.
// Вызывающий обязан сверить treeHash кэша с одобренным до вызова.
export function importCandidate({ meta }) {
  const outDir = join(SKILLS_DIR, meta.source, meta.slug);
  mkdirSync(outDir, { recursive: true });
  copyFileSync(join(CACHE_DIR, meta.source, meta.path, 'SKILL.md'), join(outDir, 'SKILL.en.md'));
  writeJson(join(outDir, 'meta.json'), meta);
}
