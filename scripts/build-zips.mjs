// Собирает zip оригиналов скилов с открытой лицензией в public/downloads/.
// Архив собирается строго из одобренной версии: скачивается коммит из meta.json, и содержимое
// сверяется с treeHash из data/approvals.json. Несовпадение, символические ссылки и т.п. — скил пропускается.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, rmSync, cpSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { APPROVALS_FILE, GIT_ENV, GIT_SAFE, ROOT, SAFE_ID, loadSkills, readJson } from './lib.mjs';
import { treeHash } from './tree-hash.mjs';
import { scanSkillDir } from './scanner.mjs';

const PINNED_DIR = join(ROOT, '.cache', 'pinned');
const outDir = join(ROOT, 'public', 'downloads');
const approvals = readJson(APPROVALS_FILE, {});
const git = (args, cwd) => execFileSync('git', [...GIT_SAFE, ...args], { cwd, encoding: 'utf8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] });

function checkoutPinned(repo, commit) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`некорректный коммит ${commit}`);
  const dir = join(PINNED_DIR, `${repo.replace('/', '__')}@${commit}`);
  if (existsSync(join(dir, '.git'))) return dir;
  mkdirSync(dir, { recursive: true });
  git(['init', '-q'], dir);
  git(['remote', 'add', 'origin', `https://github.com/${repo}.git`], dir);
  git(['fetch', '--depth', '1', '--no-recurse-submodules', 'origin', commit], dir);
  git(['checkout', '-q', 'FETCH_HEAD'], dir);
  return dir;
}

function hasSymlinks(dir) {
  return readdirSync(dir).some((name) => {
    const st = lstatSync(join(dir, name));
    return st.isSymbolicLink() || (st.isDirectory() && hasSymlinks(join(dir, name)));
  });
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let count = 0;
let skipped = 0;
for (const { meta } of loadSkills()) {
  if (!meta.redistributable) continue;
  const id = `${meta.source}/${meta.slug}`;
  try {
    if (!SAFE_ID.test(meta.slug) || !SAFE_ID.test(meta.source)) throw new Error('недопустимое имя');
    if (approvals[id]?.treeHash !== meta.treeHash) throw new Error('нет одобрения для этой версии');
    const repoDir = checkoutPinned(meta.repo, meta.commit);
    const skillDir = join(repoDir, meta.path);
    if (!existsSync(skillDir) || hasSymlinks(skillDir)) throw new Error('папка отсутствует или содержит ссылки');
    if (treeHash(skillDir) !== meta.treeHash) throw new Error('содержимое не совпадает с одобренным');
    if (scanSkillDir(skillDir).some((f) => f.severity === 'block')) throw new Error('сканер блокирует содержимое');

    // Копия во временную папку, чтобы добавить LICENSE репозитория, не трогая кэш.
    const stage = join(ROOT, '.cache', 'zip-stage', meta.slug);
    rmSync(join(ROOT, '.cache', 'zip-stage'), { recursive: true, force: true });
    cpSync(skillDir, stage, { recursive: true, verbatimSymlinks: true });
    const repoLicense = join(repoDir, 'LICENSE');
    const hasOwnLicense = meta.files.some((f) => /^LICENSE/i.test(f));
    if (!hasOwnLicense && existsSync(repoLicense) && lstatSync(repoLicense).isFile()) cpSync(repoLicense, join(stage, 'LICENSE'));

    // Архив содержит папку <slug>/ — его можно сразу распаковать в ~/.claude/skills/.
    // -y: ссылки (если бы они были) сохраняются как ссылки, а не как содержимое файлов, на которые указывают.
    const zipPath = join(outDir, `${meta.source}--${meta.slug}.zip`);
    execFileSync('zip', ['-rqyX', zipPath, meta.slug, '-x', '*/.DS_Store'], { cwd: join(stage, '..') });
    count++;
  } catch (e) {
    console.warn(`пропущен ${id}: ${e.message}`);
    skipped++;
  }
}
rmSync(join(ROOT, '.cache', 'zip-stage'), { recursive: true, force: true });
console.log(`Собрано архивов: ${count}${skipped ? `, пропущено: ${skipped}` : ''}`);
if (skipped) process.exitCode = 1;
