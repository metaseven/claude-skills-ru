// Шаг 1 обновления: скачать источники, проверить новые/изменённые скилы и подготовить их к ручному просмотру.
// В data/ попадают только скилы, одобренные через `npm run approve` (одобрение привязано к хешу содержимого).
//   npm run sync
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync, lstatSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  APPROVALS_FILE, CACHE_DIR, DATA_DIR, REVIEW_DIR, SKILLS_DIR, MAX_FULL_TRANSLATION_BYTES, OPEN_LICENSES, SAFE_ID,
  GIT_SAFE, GIT_ENV, readJson, writeJson, sha256, detectLicense, parseFrontmatter, loadSkills, pendingWork,
} from './lib.mjs';
import { scanSkillDir, summarize, formatFindings, sanitizeForTerminal } from './scanner.mjs';
import { importCandidate } from './importer.mjs';
import { treeHash } from './tree-hash.mjs';

const git = (args, cwd) => execFileSync('git', [...GIT_SAFE, ...args], { cwd, encoding: 'utf8', env: GIT_ENV }).trim();

function fetchSource(source) {
  const dir = join(CACHE_DIR, source.id);
  if (existsSync(join(dir, '.git'))) {
    git(['fetch', '--depth', '1', '--no-recurse-submodules', 'origin', source.branch], dir);
    git(['reset', '--hard', 'FETCH_HEAD'], dir);
    git(['clean', '-ffdx'], dir);
  } else {
    mkdirSync(CACHE_DIR, { recursive: true });
    git(['clone', '--depth', '1', '--no-recurse-submodules', '--branch', source.branch, `https://github.com/${source.repo}.git`, dir]);
  }
  return { dir, commit: git(['rev-parse', 'HEAD'], dir) };
}

function readLicenseFile(dir) {
  for (const name of ['LICENSE.txt', 'LICENSE', 'LICENSE.md']) {
    const path = join(dir, name);
    if (existsSync(path) && lstatSync(path).isFile()) return readFileSync(path, 'utf8');
  }
  return null;
}

function pluginsByPath(repoDir, source) {
  const map = new Map();
  if (!source.marketplace) return map;
  const path = join(repoDir, source.marketplace);
  if (!existsSync(path) || !lstatSync(path).isFile()) return map;
  const marketplace = JSON.parse(readFileSync(path, 'utf8'));
  for (const plugin of marketplace.plugins ?? []) {
    if (!SAFE_ID.test(String(plugin.name))) continue; // имя попадает в команду установки на сайте
    for (const skillPath of plugin.skills ?? []) map.set(String(skillPath).replace(/^\.\//, ''), plugin.name);
  }
  return map;
}

function buildCandidate(source, repoDir, commit, plugins, slug) {
  const skillDir = join(repoDir, source.skillsPath, slug);
  const findings = scanSkillDir(skillDir);
  const summary = summarize(findings);
  const repoPath = `${source.skillsPath}/${slug}`;
  const base = { id: `${source.id}/${slug}`, source: source.id, slug, skillDir, findings, summary };
  if (summary.block) return { ...base, meta: null };

  const raw = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
  const { data: frontmatter } = parseFrontmatter(raw);
  const repoLicense = source.repoLicense ?? detectLicense(readLicenseFile(repoDir)) ?? 'unknown';
  const license = detectLicense(readLicenseFile(skillDir)) ?? repoLicense;
  const bytes = Buffer.byteLength(raw);
  const openLicense = OPEN_LICENSES.includes(license);
  const scopeReason = !openLicense ? 'license' : bytes > MAX_FULL_TRANSLATION_BYTES ? 'too-large' : null;
  const plugin = plugins.get(repoPath) ?? null;
  const name = String(frontmatter.name ?? slug);

  return {
    ...base,
    meta: {
      source: source.id,
      slug,
      name: SAFE_ID.test(name) ? name : slug,
      description: String(frontmatter.description ?? '').trim().slice(0, 4000),
      license,
      redistributable: openLicense,
      translationScope: scopeReason ? 'summary' : 'full',
      scopeReason,
      bytes,
      files: readdirRecursive(skillDir).filter((f) => f !== 'SKILL.md'),
      repo: source.repo,
      branch: source.branch,
      path: repoPath,
      url: `https://github.com/${source.repo}/tree/${commit}/${repoPath}`,
      commit,
      hash: sha256(raw),
      treeHash: treeHash(skillDir),
      plugin,
      install: (source.install ?? []).filter((l) => !l.includes('{plugin}') || plugin).map((l) => l.replace('{plugin}', plugin)),
    },
  };
}

function readdirRecursive(dir, base = dir) {
  return readdirSync(dir).sort().flatMap((name) => {
    const path = join(dir, name);
    return lstatSync(path).isDirectory() ? readdirRecursive(path, base) : [relative(base, path)];
  });
}

// Дифф SKILL.md для ручного просмотра: что именно изменилось с последней одобренной версии.
function writeDiff(candidate) {
  const out = join(REVIEW_DIR, `${candidate.source}__${candidate.slug}.diff`);
  const old = join(SKILLS_DIR, candidate.source, candidate.slug, 'SKILL.en.md');
  const args = ['diff', '--no-index', '--no-color', '--', existsSync(old) ? old : '/dev/null', join(candidate.skillDir, 'SKILL.md')];
  let diff = '';
  try {
    diff = execFileSync('git', args, { encoding: 'utf8' });
  } catch (e) {
    diff = e.stdout ?? ''; // git diff возвращает 1, если файлы различаются
  }
  writeFileSync(out, diff);
  return relative(process.cwd(), out);
}

// --- main ---
const sources = readJson(join(DATA_DIR, 'sources.json'));
const approvals = readJson(APPROVALS_FILE, {});
const existing = new Map(loadSkills().map((s) => [`${s.meta.source}/${s.meta.slug}`, s.meta]));
rmSync(REVIEW_DIR, { recursive: true, force: true });
mkdirSync(REVIEW_DIR, { recursive: true });

const pending = [];
let unchanged = 0;
let imported = 0;

for (const source of sources) {
  const { dir: repoDir, commit } = fetchSource(source);
  const plugins = pluginsByPath(repoDir, source);
  const skillsRoot = join(repoDir, source.skillsPath);
  const seen = new Set();

  for (const slug of readdirSync(skillsRoot).sort()) {
    const skillDir = join(skillsRoot, slug);
    if (!lstatSync(skillDir).isDirectory() || !existsSync(join(skillDir, 'SKILL.md'))) continue;
    if (!SAFE_ID.test(slug)) {
      console.log(`⛔ ${source.id}/${sanitizeForTerminal(slug, 60)}: недопустимое имя папки — пропущен`);
      continue;
    }
    seen.add(slug);
    const id = `${source.id}/${slug}`;
    const tree = treeHash(skillDir);
    if (existing.get(id)?.treeHash === tree) {
      unchanged++;
      continue;
    }
    const candidate = buildCandidate(source, repoDir, commit, plugins, slug);
    if (candidate.meta && approvals[id]?.treeHash === candidate.meta.treeHash) {
      importCandidate(candidate); // уже одобрен ранее (например, импорт прервался)
      imported++;
      continue;
    }
    candidate.diff = writeDiff(candidate);
    candidate.isNew = !existing.has(id);
    pending.push(candidate);
  }

  // Скилы, исчезнувшие из источника, удаляем вместе с переводами.
  const sourceOut = join(SKILLS_DIR, source.id);
  if (existsSync(sourceOut)) {
    for (const slug of readdirSync(sourceOut)) {
      if (!seen.has(slug)) {
        rmSync(join(sourceOut, slug), { recursive: true, force: true });
        delete approvals[`${source.id}/${slug}`];
        console.log(`  удалён: ${source.id}/${slug}`);
      }
    }
  }
  console.log(`${source.id}: ${seen.size} скилов (${commit.slice(0, 7)})`);
}
writeJson(APPROVALS_FILE, approvals);

// Для approve.mjs сохраняем ровно то, что показали пользователю (без путей к кэшу в findings).
writeJson(join(REVIEW_DIR, 'pending.json'), pending.map(({ skillDir, ...c }) => c));

console.log(`\nБез изменений: ${unchanged}. Импортировано ранее одобренных: ${imported}.`);
if (!pending.length) {
  console.log('Новых или изменённых скилов нет.');
} else {
  console.log(`\nТребуют проверки: ${pending.length}\n`);
  for (const c of pending) {
    const s = c.summary;
    const status = s.block ? '⛔ ЗАБЛОКИРОВАН' : s.review ? `⚠️  подозрительных мест: ${s.review}` : '✓ сканер ничего не нашёл';
    console.log(`${c.isNew ? '[новый]   ' : '[изменён] '}${c.id} — ${status}`);
    const shown = c.findings.filter((f) => f.severity !== 'info');
    if (shown.length) console.log(formatFindings(shown));
    console.log(`    дифф: ${c.diff}\n`);
  }
  console.log('Просмотрите диффы и находки, затем одобрите скилы, которым доверяете:');
  console.log('  npm run approve -- <source/slug> ...');
  console.log('Заблокированные скилы одобрить нельзя.');
}

const needTranslation = loadSkills().filter((s) => pendingWork(s).length > 0).length;
if (needTranslation) console.log(`\nОдобрены, но ждут перевода: ${needTranslation} (npm run status)`);
