// Режим перевода: включает защитный хук (scripts/guard-hook.mjs) и запоминает состояние файлов,
// чтобы после перевода показать всё, что изменилось.
//   npm run translate:start   — включить (можно из Claude Code)
//   npm run translate:end     — выключить (ТОЛЬКО из своего терминала — Claude это запрещено хуком)
//   node scripts/translate-mode.mjs status
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readJson, writeJson, sha256 } from './lib.mjs';

const LOCK = join(ROOT, '.cache', 'translate-mode.json');
const ALLOWED = /^data\/skills\/[^/]+\/[^/]+\/(ru\.json|SKILL\.ru\.md)$/;

// Все файлы проекта под контролем git (отслеживаемые и новые, кроме .gitignore) с хешами.
function snapshot() {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT });
  const files = {};
  for (const f of out.toString('utf8').split('\0').filter(Boolean)) {
    const path = join(ROOT, f);
    files[f] = existsSync(path) ? sha256(readFileSync(path)) : null;
  }
  return files;
}

function changes(before) {
  const now = snapshot();
  const all = new Set([...Object.keys(before), ...Object.keys(now)]);
  return [...all].filter((f) => before[f] !== now[f]).sort();
}

const cmd = process.argv[2];
const lock = readJson(LOCK, null);

if (cmd === 'start') {
  if (lock) {
    console.log(`Режим перевода уже включён (с ${lock.startedAt}).`);
  } else {
    writeJson(LOCK, { startedAt: new Date().toISOString(), files: snapshot() });
    console.log('Режим перевода включён: Claude может читать проект и писать только переводы.');
    console.log('После проверки результата выключите его в своём терминале: npm run translate:end');
  }
} else if (cmd === 'status') {
  if (!lock) {
    console.log('Режим перевода выключен.');
  } else {
    const changed = changes(lock.files);
    console.log(`Режим перевода включён с ${lock.startedAt}. Изменено файлов: ${changed.length}`);
  }
} else if (cmd === 'end') {
  if (!lock) {
    console.log('Режим перевода и так выключен.');
    process.exit(0);
  }
  const changed = changes(lock.files);
  const bad = changed.filter((f) => !ALLOWED.test(f));
  console.log(`Изменено файлов: ${changed.length}`);
  for (const f of changed) console.log(`  ${ALLOWED.test(f) ? '✓' : '⛔'} ${f}`);
  if (bad.length && !process.argv.includes('--force')) {
    console.log('\n⛔ Во время перевода изменились файлы вне переводов. Проверьте их (git diff) и, если всё в порядке,');
    console.log('   выключите режим: npm run translate:end -- --force');
    process.exit(1);
  }
  rmSync(LOCK);
  console.log('\nРежим перевода выключен. Перед коммитом: npm run validate и git diff data/skills');
} else {
  console.log('Использование: node scripts/translate-mode.mjs start|status|end');
  process.exit(1);
}
