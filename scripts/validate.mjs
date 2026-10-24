// Проверяет переводы: схема ru.json и сохранность кода/ссылок/frontmatter в SKILL.ru.md.
//   npm run validate                     — все скилы
//   npm run validate -- anthropics/pdf   — выборочно
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { DATA_DIR, loadSkills, readJson } from './lib.mjs';

const categories = new Set(readJson(join(DATA_DIR, 'categories.json')).map((c) => c.id));
const only = process.argv.slice(2);

const fences = (md) => md.match(/^(```|~~~)[\s\S]*?^\1/gm) ?? [];
const links = (md) => md.match(/\]\([^)]+\)/g) ?? [];

function check({ dir, meta, ru }) {
  const errors = [];
  const warnings = [];
  if (!ru) return { errors: ['нет ru.json'], warnings };

  for (const field of ['sourceHash', 'model', 'title', 'description', 'category']) {
    if (!ru[field]) errors.push(`ru.json: пустое поле ${field}`);
  }
  for (const field of ['what', 'when', 'example']) {
    if (!ru.summary?.[field]) errors.push(`ru.json: пустое поле summary.${field}`);
  }
  if (ru.category && !categories.has(ru.category)) errors.push(`ru.json: неизвестная категория ${ru.category}`);
  if (!Array.isArray(ru.tags) || ru.tags.length === 0) errors.push('ru.json: нет тегов');
  if (ru.sourceHash && ru.sourceHash !== meta.hash) warnings.push('перевод устарел (оригинал изменился)');
  if (/[a-z]{4,}/i.test(ru.description) && !/[а-яё]/i.test(ru.description)) errors.push('ru.json: description не переведён');

  const ruFile = join(dir, 'SKILL.ru.md');
  if (meta.translationScope !== 'full') {
    if (existsSync(ruFile)) errors.push(`SKILL.ru.md не должен публиковаться (${meta.scopeReason})`);
    return { errors, warnings };
  }
  if (!existsSync(ruFile)) return { errors: [...errors, 'нет SKILL.ru.md'], warnings };

  const en = readFileSync(join(dir, 'SKILL.en.md'), 'utf8');
  const ruText = readFileSync(ruFile, 'utf8');
  let ruMatter;
  try {
    ruMatter = matter(ruText);
  } catch (e) {
    return { errors: [...errors, `SKILL.ru.md: битый frontmatter (${e.message})`], warnings };
  }
  if (ruMatter.data.name !== meta.name) errors.push(`SKILL.ru.md: name «${ruMatter.data.name}» ≠ «${meta.name}»`);

  const enFences = fences(en);
  const ruFences = fences(ruText);
  if (enFences.length !== ruFences.length) {
    errors.push(`блоков кода: оригинал ${enFences.length}, перевод ${ruFences.length}`);
  } else {
    const changed = enFences.filter((block, i) => block !== ruFences[i]).length;
    if (changed) warnings.push(`изменено блоков кода: ${changed} (допустимо, если переведены только комментарии)`);
  }
  const enLinks = links(en).length;
  const ruLinks = links(ruText).length;
  if (enLinks !== ruLinks) warnings.push(`ссылок: оригинал ${enLinks}, перевод ${ruLinks}`);

  const ratio = ruText.length / en.length;
  if (ratio < 0.6) errors.push(`перевод подозрительно короткий (${Math.round(ratio * 100)}% от оригинала)`);
  return { errors, warnings };
}

let failed = 0;
for (const skill of loadSkills()) {
  const id = `${skill.meta.source}/${skill.meta.slug}`;
  if (only.length && !only.includes(id)) continue;
  const { errors, warnings } = check(skill);
  if (errors.length) failed++;
  const mark = errors.length ? '✗' : warnings.length ? '!' : '✓';
  console.log(`${mark} ${id}`);
  for (const e of errors) console.log(`    ошибка: ${e}`);
  for (const w of warnings) console.log(`    внимание: ${w}`);
}
if (failed) {
  console.log(`\nС ошибками: ${failed}`);
  process.exit(1);
}
