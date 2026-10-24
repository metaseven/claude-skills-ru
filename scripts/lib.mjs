import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = join(ROOT, 'data');
export const SKILLS_DIR = join(DATA_DIR, 'skills');
export const CACHE_DIR = join(ROOT, '.cache', 'sources');

// SKILL.md больше этого размера переводим только кратко (описание + пересказ).
export const MAX_FULL_TRANSLATION_BYTES = 60_000;
export const OPEN_LICENSES = ['Apache-2.0', 'MIT'];

export function readJson(path, fallback = undefined) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function detectLicense(text) {
  if (!text) return null;
  if (/Apache License/i.test(text)) return 'Apache-2.0';
  if (/MIT License|Permission is hereby granted, free of charge/i.test(text)) return 'MIT';
  if (/All rights reserved|Proprietary/i.test(text)) return 'proprietary';
  return 'other';
}

// Все скилы из data/skills/<source>/<slug>/ с их meta.json и ru.json.
export function loadSkills() {
  if (!existsSync(SKILLS_DIR)) return [];
  const skills = [];
  for (const source of readdirSync(SKILLS_DIR)) {
    const sourceDir = join(SKILLS_DIR, source);
    for (const slug of readdirSync(sourceDir)) {
      const dir = join(sourceDir, slug);
      const meta = readJson(join(dir, 'meta.json'));
      if (!meta) continue;
      skills.push({ dir, meta, ru: readJson(join(dir, 'ru.json'), null) });
    }
  }
  return skills;
}

// Что ещё нужно сделать переводчику для скила; пустой массив — всё актуально.
export function pendingWork({ dir, meta, ru }) {
  const work = [];
  if (!ru) work.push('нет ru.json');
  else if (ru.sourceHash !== meta.hash) work.push('оригинал изменился');
  if (meta.translationScope === 'full' && !existsSync(join(dir, 'SKILL.ru.md'))) {
    work.push('нет SKILL.ru.md');
  }
  return work;
}
