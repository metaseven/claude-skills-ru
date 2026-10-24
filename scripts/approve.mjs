// Шаг 2 обновления: одобрить просмотренные скилы и импортировать их в data/.
//   npm run approve                       — список ожидающих проверки
//   npm run approve -- anthropics/pdf …   — одобрить конкретные скилы
//   npm run approve -- --clean            — одобрить все, где сканер не нашёл ничего подозрительного
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { APPROVALS_FILE, CACHE_DIR, REVIEW_DIR, readJson, writeJson } from './lib.mjs';
import { importCandidate } from './importer.mjs';
import { treeHash } from './tree-hash.mjs';
import { formatFindings } from './scanner.mjs';

const pendingFile = join(REVIEW_DIR, 'pending.json');
const pending = readJson(pendingFile, []);
const args = process.argv.slice(2);

if (!pending.length) {
  console.log('Нет скилов, ожидающих проверки. Сначала: npm run sync');
  process.exit(0);
}
if (!args.length) {
  for (const c of pending) {
    console.log(`${c.id}  block=${c.summary.block} review=${c.summary.review}  дифф: ${c.diff}`);
    const shown = c.findings.filter((f) => f.severity !== 'info');
    if (shown.length) console.log(formatFindings(shown));
  }
  process.exit(0);
}

const clean = args.includes('--clean');
const ids = new Set(args.filter((a) => !a.startsWith('--')));
const approvals = readJson(APPROVALS_FILE, {});
const rest = [];
let failed = false;

for (const c of pending) {
  const wanted = ids.has(c.id) || (clean && c.summary.block === 0 && c.summary.review === 0);
  ids.delete(c.id);
  if (!wanted) {
    rest.push(c);
    continue;
  }
  if (c.summary.block || !c.meta) {
    console.log(`⛔ ${c.id}: заблокирован сканером — одобрить нельзя`);
    rest.push(c);
    failed = true;
    continue;
  }
  // Защита от подмены: содержимое кэша должно совпадать с тем, что было показано при проверке.
  const dir = join(CACHE_DIR, c.meta.source, c.meta.path);
  if (!existsSync(dir) || treeHash(dir) !== c.meta.treeHash) {
    console.log(`⛔ ${c.id}: содержимое изменилось после проверки — запустите npm run sync заново`);
    rest.push(c);
    failed = true;
    continue;
  }
  approvals[c.id] = { treeHash: c.meta.treeHash, commit: c.meta.commit, approvedAt: new Date().toISOString().slice(0, 10), findings: c.summary };
  importCandidate(c);
  console.log(`✓ ${c.id}: одобрен и импортирован`);
}
for (const id of ids) {
  console.log(`? ${id}: нет среди ожидающих проверки`);
  failed = true;
}

writeJson(APPROVALS_FILE, approvals);
writeJson(pendingFile, rest);
console.log(`\nОсталось на проверке: ${rest.length}. Дальше: npm run status, затем /translate-skills`);
if (failed) process.exit(1);
