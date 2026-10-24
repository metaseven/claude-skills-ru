import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sha256 } from './lib.mjs';

// Хеш всего содержимого папки скила: одобрение и zip-архивы привязаны именно к нему.
// Символические ссылки и спецфайлы учитываются как «non-regular» (их всё равно блокирует сканер).
export function treeHash(dir) {
  const lines = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const path = join(d, name);
      const st = lstatSync(path);
      if (st.isDirectory()) walk(path);
      else lines.push(`${relative(dir, path)}\0${st.isFile() ? sha256(readFileSync(path)) : 'non-regular'}`);
    }
  };
  walk(dir);
  return sha256(lines.join('\n'));
}
