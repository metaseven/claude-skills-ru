// Подтягивает источники скилов и обновляет data/skills/<source>/<slug>/{meta.json,SKILL.en.md}.
// Переводы (ru.json, SKILL.ru.md) не трогает — только сообщает, что устарело.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import matter from 'gray-matter';
import {
  CACHE_DIR, DATA_DIR, SKILLS_DIR, MAX_FULL_TRANSLATION_BYTES, OPEN_LICENSES,
  readJson, writeJson, sha256, detectLicense, loadSkills, pendingWork,
} from './lib.mjs';

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function fetchSource(source) {
  const dir = join(CACHE_DIR, source.id);
  const url = `https://github.com/${source.repo}.git`;
  if (existsSync(join(dir, '.git'))) {
    git(['fetch', '--depth', '1', 'origin', source.branch], dir);
    git(['reset', '--hard', `origin/${source.branch}`], dir);
  } else {
    mkdirSync(CACHE_DIR, { recursive: true });
    git(['clone', '--depth', '1', '--branch', source.branch, url, dir]);
  }
  return { dir, commit: git(['rev-parse', 'HEAD'], dir) };
}

function readLicenseFile(dir) {
  for (const name of ['LICENSE.txt', 'LICENSE', 'LICENSE.md']) {
    const path = join(dir, name);
    if (existsSync(path)) return readFileSync(path, 'utf8');
  }
  return null;
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...listFiles(path, base));
    else out.push(relative(base, path));
  }
  return out.sort();
}

// Путь скила в репозитории → имя плагина из marketplace.json (для команды установки).
function pluginsByPath(repoDir, source) {
  const map = new Map();
  if (!source.marketplace) return map;
  const marketplace = readJson(join(repoDir, source.marketplace), { plugins: [] });
  for (const plugin of marketplace.plugins) {
    for (const skillPath of plugin.skills ?? []) {
      map.set(skillPath.replace(/^\.\//, ''), plugin.name);
    }
  }
  return map;
}

function syncSource(source) {
  const { dir: repoDir, commit } = fetchSource(source);
  const repoLicense = source.repoLicense ?? detectLicense(readLicenseFile(repoDir)) ?? 'unknown';
  const plugins = pluginsByPath(repoDir, source);
  const skillsRoot = join(repoDir, source.skillsPath);
  const seen = new Set();

  for (const slug of readdirSync(skillsRoot).sort()) {
    const skillDir = join(skillsRoot, slug);
    const skillFile = join(skillDir, 'SKILL.md');
    if (!existsSync(skillFile)) continue;

    const raw = readFileSync(skillFile, 'utf8');
    const { data: frontmatter } = matter(raw);
    const repoPath = `${source.skillsPath}/${slug}`;
    const license = detectLicense(readLicenseFile(skillDir)) ?? repoLicense;
    const bytes = Buffer.byteLength(raw);
    const openLicense = OPEN_LICENSES.includes(license);

    let translationScope = 'full';
    let scopeReason = null;
    if (!openLicense) {
      translationScope = 'summary';
      scopeReason = 'license';
    } else if (bytes > MAX_FULL_TRANSLATION_BYTES) {
      translationScope = 'summary';
      scopeReason = 'too-large';
    }

    const plugin = plugins.get(repoPath);
    const install = (source.install ?? [])
      .filter((line) => !line.includes('{plugin}') || plugin)
      .map((line) => line.replace('{plugin}', plugin));

    const outDir = join(SKILLS_DIR, source.id, slug);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'SKILL.en.md'), raw);
    writeJson(join(outDir, 'meta.json'), {
      source: source.id,
      slug,
      name: frontmatter.name ?? slug,
      description: String(frontmatter.description ?? '').trim(),
      license,
      redistributable: openLicense,
      translationScope,
      scopeReason,
      bytes,
      files: listFiles(skillDir).filter((f) => f !== 'SKILL.md'),
      repo: source.repo,
      branch: source.branch,
      path: repoPath,
      url: `https://github.com/${source.repo}/tree/${source.branch}/${repoPath}`,
      commit,
      hash: sha256(raw),
      plugin: plugin ?? null,
      install,
    });
    seen.add(slug);
  }

  // Скилы, исчезнувшие из источника, удаляем вместе с переводами.
  const sourceOut = join(SKILLS_DIR, source.id);
  for (const slug of readdirSync(sourceOut)) {
    if (!seen.has(slug)) {
      rmSync(join(sourceOut, slug), { recursive: true, force: true });
      console.log(`  удалён: ${source.id}/${slug}`);
    }
  }
  console.log(`${source.id}: ${seen.size} скилов (${commit.slice(0, 7)})`);
}

const sources = readJson(join(DATA_DIR, 'sources.json'));
for (const source of sources) syncSource(source);

const pending = loadSkills().filter((skill) => pendingWork(skill).length > 0);
console.log(pending.length
  ? `\nНужен перевод: ${pending.length}. Подробности: npm run status`
  : '\nВсе переводы актуальны.');
