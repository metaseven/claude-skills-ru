// Список скилов, которым нужен перевод.
//   npm run status            — таблица в консоль
//   npm run status -- --json  — для команды /translate-skills
//   npm run status -- --md    — тело issue для GitHub Actions
import { relative } from 'node:path';
import { ROOT, loadSkills, pendingWork } from './lib.mjs';

const pending = loadSkills()
  .map((skill) => ({ skill, work: pendingWork(skill) }))
  .filter(({ work }) => work.length > 0)
  .map(({ skill, work }) => ({
    id: `${skill.meta.source}/${skill.meta.slug}`,
    dir: relative(ROOT, skill.dir),
    scope: skill.meta.translationScope,
    bytes: skill.meta.bytes,
    work,
  }));

const arg = process.argv[2];
if (arg === '--json') {
  console.log(JSON.stringify(pending, null, 2));
} else if (arg === '--md') {
  console.log(`Найдено скилов, требующих перевода: **${pending.length}**.\n`);
  console.log('Запустите локально `npm run sync`, затем в Claude Code — `/translate-skills`.\n');
  for (const p of pending) console.log(`- [ ] \`${p.id}\` — ${p.work.join(', ')}`);
} else if (pending.length === 0) {
  console.log('Все переводы актуальны.');
} else {
  for (const p of pending) {
    console.log(`${p.id.padEnd(45)} ${p.scope.padEnd(8)} ${String(p.bytes).padStart(7)} B  ${p.work.join(', ')}`);
  }
  console.log(`\nИтого: ${pending.length}`);
}
