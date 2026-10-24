// Собирает zip оригиналов скилов с открытой лицензией в public/downloads/.
// Требует .cache/sources (сначала npm run sync). Скилы с закрытой лицензией не упаковываются.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, ROOT, loadSkills } from './lib.mjs';

const outDir = join(ROOT, 'public', 'downloads');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let count = 0;
for (const { meta } of loadSkills()) {
  if (!meta.redistributable) continue;
  const repoDir = join(CACHE_DIR, meta.source);
  const skillDir = join(repoDir, meta.path);
  if (!existsSync(skillDir)) {
    console.warn(`пропущен ${meta.source}/${meta.slug}: нет ${skillDir} (запустите npm run sync)`);
    continue;
  }
  const zipPath = join(outDir, `${meta.source}--${meta.slug}.zip`);
  // Архив содержит папку <slug>/ — так его можно сразу распаковать в ~/.claude/skills/.
  execFileSync('zip', ['-rq', zipPath, meta.slug, '-x', '*/.DS_Store'], { cwd: join(skillDir, '..') });
  const hasOwnLicense = meta.files.some((f) => /^LICENSE/i.test(f));
  const repoLicense = join(repoDir, 'LICENSE');
  if (!hasOwnLicense && existsSync(repoLicense)) {
    const tmp = join(outDir, meta.slug);
    mkdirSync(tmp, { recursive: true });
    copyFileSync(repoLicense, join(tmp, 'LICENSE'));
    execFileSync('zip', ['-q', zipPath, `${meta.slug}/LICENSE`], { cwd: outDir });
    rmSync(tmp, { recursive: true, force: true });
  }
  count++;
}
console.log(`Собрано архивов: ${count}`);
