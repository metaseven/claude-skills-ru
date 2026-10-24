// Проверяет данные в data/skills: схему ru.json, сохранность кода/ссылок/frontmatter в SKILL.ru.md
// и прогоняет оригинал и перевод через сканер (инъекция могла «переехать» в перевод).
//   npm run validate                     — все скилы
//   npm run validate -- anthropics/pdf   — выборочно
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { APPROVALS_FILE, DATA_DIR, loadSkills, parseFrontmatter, readJson } from './lib.mjs';
import { scanText } from './scanner.mjs';

const categories = new Set(readJson(join(DATA_DIR, 'categories.json')).map((c) => c.id));
const approvals = readJson(APPROVALS_FILE, {});
const only = process.argv.slice(2);

const RU_KEYS = ['sourceHash', 'model', 'translatedAt', 'title', 'description', 'summary', 'category', 'tags'];
const ALLOWED_FILES = new Set(['meta.json', 'SKILL.en.md', 'ru.json', 'SKILL.ru.md']);
const fences = (md) => md.match(/^(```|~~~)[\s\S]*?^\1/gm) ?? [];
const links = (md) => md.match(/\]\([^)]+\)/g) ?? [];

function check({ dir, meta, ru }) {
  const errors = [];
  const warnings = [];
  const id = `${meta.source}/${meta.slug}`;

  // Только одобренное содержимое может лежать в data/.
  if (approvals[id]?.treeHash !== meta.treeHash) errors.push('скил не одобрен (нет записи в data/approvals.json для этого содержимого)');
  for (const f of readdirSync(dir)) if (!ALLOWED_FILES.has(f)) errors.push(`посторонний файл в папке скила: ${f}`);

  const en = readFileSync(join(dir, 'SKILL.en.md'), 'utf8');
  for (const f of scanText(en, 'SKILL.en.md')) (f.severity === 'block' ? errors : warnings).push(`оригинал: ${f.message}`);

  if (!ru) return { errors: [...errors, 'нет ru.json'], warnings };

  const extra = Object.keys(ru).filter((k) => !RU_KEYS.includes(k));
  if (extra.length) errors.push(`ru.json: лишние поля ${extra.join(', ')}`);
  for (const field of ['sourceHash', 'model', 'title', 'description', 'category']) {
    if (typeof ru[field] !== 'string' || !ru[field]) errors.push(`ru.json: пустое поле ${field}`);
  }
  for (const field of ['what', 'when', 'example']) {
    if (typeof ru.summary?.[field] !== 'string' || !ru.summary[field]) errors.push(`ru.json: пустое поле summary.${field}`);
  }
  if (ru.title?.length > 80) errors.push('ru.json: title длиннее 80 символов');
  if (ru.description?.length > 4000) errors.push('ru.json: description слишком длинный');
  if (ru.category && !categories.has(ru.category)) errors.push(`ru.json: неизвестная категория ${ru.category}`);
  if (!Array.isArray(ru.tags) || ru.tags.length === 0 || ru.tags.length > 10 || ru.tags.some((t) => typeof t !== 'string' || t.length > 40)) {
    errors.push('ru.json: теги — от 1 до 10 строк до 40 символов');
  }
  if (ru.sourceHash && ru.sourceHash !== meta.hash) warnings.push('перевод устарел (оригинал изменился)');
  if (typeof ru.description === 'string' && !/[а-яё]/i.test(ru.description)) errors.push('ru.json: description не переведён');

  const ruText = [ru.title, ru.description, ru.summary?.what, ru.summary?.when, ru.summary?.example, ...(ru.tags ?? [])].join('\n');
  for (const f of scanText(ruText, 'ru.json')) (f.severity === 'block' ? errors : warnings).push(`перевод: ${f.message}`);

  const ruFile = join(dir, 'SKILL.ru.md');
  if (meta.translationScope !== 'full') {
    if (existsSync(ruFile)) errors.push(`SKILL.ru.md не должен публиковаться (${meta.scopeReason})`);
    return { errors, warnings };
  }
  if (!existsSync(ruFile)) return { errors: [...errors, 'нет SKILL.ru.md'], warnings };

  const ruMd = readFileSync(ruFile, 'utf8');
  let ruMatter;
  try {
    ruMatter = parseFrontmatter(ruMd);
  } catch (e) {
    return { errors: [...errors, `SKILL.ru.md: ${e.message}`], warnings };
  }
  if (ruMatter.data.name !== meta.name) errors.push(`SKILL.ru.md: name «${ruMatter.data.name}» ≠ «${meta.name}»`);

  const enFences = fences(en);
  const ruFences = fences(ruMd);
  if (enFences.length !== ruFences.length) {
    errors.push(`блоков кода: оригинал ${enFences.length}, перевод ${ruFences.length}`);
  } else {
    const changed = enFences.filter((block, i) => block !== ruFences[i]).length;
    // Код в переводе обязан совпадать с оригиналом: иначе переводчик мог что-то подменить.
    if (changed) errors.push(`изменено блоков кода: ${changed} (код должен совпадать с оригиналом символ в символ)`);
  }
  const enLinks = links(en).sort().join('\n');
  const ruLinkTargets = links(ruMd).sort().join('\n');
  const targets = (s) => s.split('\n').map((l) => l.replace(/^\]\(/, '')).sort().join('\n');
  if (targets(enLinks) !== targets(ruLinkTargets)) errors.push('адреса ссылок в переводе отличаются от оригинала');

  for (const f of scanText(ruMd, 'SKILL.ru.md')) {
    // Находки, которые есть и в оригинале, уже учтены при одобрении; новые — повод насторожиться.
    const inOriginal = scanText(en, 'SKILL.en.md').some((o) => o.rule === f.rule && o.message === f.message);
    if (f.severity === 'block') errors.push(`перевод: ${f.message}`);
    else if (!inOriginal) errors.push(`в переводе появилось то, чего нет в оригинале: ${f.message}${f.sample ? ` «${f.sample}»` : ''}`);
  }

  const ratio = ruMd.length / en.length;
  if (ratio < 0.6) errors.push(`перевод подозрительно короткий (${Math.round(ratio * 100)}% от оригинала)`);
  if (ratio > 2.5) errors.push(`перевод подозрительно длинный (${Math.round(ratio * 100)}% от оригинала)`);
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
