import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = join(ROOT, 'data');
export const SKILLS_DIR = join(DATA_DIR, 'skills');
export const APPROVALS_FILE = join(DATA_DIR, 'approvals.json');
export const CACHE_DIR = join(ROOT, '.cache', 'sources');
export const REVIEW_DIR = join(ROOT, '.cache', 'review');

// SKILL.md больше этого размера переводим только кратко (описание + пересказ).
export const MAX_FULL_TRANSLATION_BYTES = 60_000;
// Больше этого — вообще не импортируем: так не бывает у нормальных скилов.
export const MAX_SKILL_BYTES = 300_000;
export const MAX_FRONTMATTER_BYTES = 16_000;
export const OPEN_LICENSES = ['Apache-2.0', 'MIT'];

// Имена папок/плагинов из чужих репозиториев попадают в пути и команды — только безопасный набор символов.
export const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

// Безопасные git-опции для чужих репозиториев: без символических ссылок, хуков, сабмодулей и LFS.
export const GIT_SAFE = ['-c', 'core.symlinks=false', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=never'];
export const GIT_ENV = { ...process.env, GIT_LFS_SKIP_SMUDGE: '1', GIT_TERMINAL_PROMPT: '0' };

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

export function isSymlink(path) {
  return lstatSync(path).isSymbolicLink();
}

// Разбирает frontmatter SKILL.md. Принимается только «---» + YAML (без ---js и других движков),
// значения — только строки/числа/булевы и один уровень вложенности. Бросает ошибку на всё остальное.
export function parseFrontmatter(raw) {
  const text = raw.replace(/^﻿/, '');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) {
    if (/^---\S/.test(text)) throw new Error('frontmatter с нестандартным движком (например ---js) запрещён');
    return { data: {}, content: text };
  }
  if (Buffer.byteLength(m[1]) > MAX_FRONTMATTER_BYTES) throw new Error('frontmatter слишком большой');
  const data = yaml.load(m[1], { schema: yaml.CORE_SCHEMA }) ?? {};
  if (typeof data !== 'object' || Array.isArray(data)) throw new Error('frontmatter должен быть YAML-объектом');
  const scalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
  for (const [key, value] of Object.entries(data)) {
    if (scalar(value)) continue;
    const nested = Array.isArray(value) ? value : typeof value === 'object' ? Object.values(value) : [value];
    if (!nested.every(scalar)) throw new Error(`frontmatter: слишком глубокая вложенность в «${key}»`);
  }
  return { data, content: text.slice(m[0].length) };
}

export function stringifyFrontmatter(data, content) {
  return `---\n${yaml.dump(data, { lineWidth: -1, schema: yaml.CORE_SCHEMA })}---\n\n${content.replace(/^\n+/, '')}`;
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

export function detectLicense(text) {
  if (!text) return null;
  if (/Apache License/i.test(text)) return 'Apache-2.0';
  if (/MIT License|Permission is hereby granted, free of charge/i.test(text)) return 'MIT';
  if (/All rights reserved|Proprietary/i.test(text)) return 'proprietary';
  return 'other';
}
