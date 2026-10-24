import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { Marked } from 'marked';

const DATA_DIR = join(process.cwd(), 'data');
const SKILLS_DIR = join(DATA_DIR, 'skills');

export interface Meta {
  source: string;
  slug: string;
  name: string;
  description: string;
  license: string;
  redistributable: boolean;
  translationScope: 'full' | 'summary';
  scopeReason: 'license' | 'too-large' | null;
  bytes: number;
  files: string[];
  repo: string;
  branch: string;
  path: string;
  url: string;
  commit: string;
  hash: string;
  plugin: string | null;
  install: string[];
}

export interface Ru {
  sourceHash: string;
  model: string;
  translatedAt: string;
  title: string;
  description: string;
  summary: { what: string; when: string; example: string };
  category: string;
  tags: string[];
}

export interface Skill {
  id: string;
  meta: Meta;
  ru: Ru | null;
  outdated: boolean;
  title: string;
  description: string;
  category: string;
  tags: string[];
  dir: string;
}

export interface Source { id: string; title: string; repo: string }
export interface Category { id: string; title: string }

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8'));

export const sources: Source[] = readJson(join(DATA_DIR, 'sources.json'));
export const categories: Category[] = readJson(join(DATA_DIR, 'categories.json'));
export const categoryTitle = (id: string) => categories.find((c) => c.id === id)?.title ?? 'Без категории';
export const sourceTitle = (id: string) => sources.find((s) => s.id === id)?.title ?? id;

let cache: Skill[] | null = null;

export function getSkills(): Skill[] {
  if (cache) return cache;
  const skills: Skill[] = [];
  for (const source of readdirSync(SKILLS_DIR)) {
    for (const slug of readdirSync(join(SKILLS_DIR, source))) {
      const dir = join(SKILLS_DIR, source, slug);
      if (!existsSync(join(dir, 'meta.json'))) continue;
      const meta = readJson<Meta>(join(dir, 'meta.json'));
      const ru = existsSync(join(dir, 'ru.json')) ? readJson<Ru>(join(dir, 'ru.json')) : null;
      skills.push({
        id: `${source}/${slug}`,
        meta,
        ru,
        outdated: !!ru && ru.sourceHash !== meta.hash,
        title: ru?.title ?? meta.name,
        description: ru?.description ?? meta.description,
        category: ru?.category ?? 'uncategorized',
        tags: ru?.tags ?? [],
        dir,
      });
    }
  }
  const order = sources.map((s) => s.id);
  skills.sort((a, b) => order.indexOf(a.meta.source) - order.indexOf(b.meta.source) || a.meta.name.localeCompare(b.meta.name));
  cache = skills;
  return skills;
}

// Относительные ссылки в SKILL.md (reference.md, scripts/…) ведут на файлы в GitHub.
function renderer(meta: Meta) {
  const blobBase = `https://github.com/${meta.repo}/blob/${meta.branch}/${meta.path}/`;
  return new Marked({
    gfm: true,
    walkTokens(token) {
      if ((token.type === 'link' || token.type === 'image') && !/^([a-z]+:|#|\/)/i.test(token.href)) {
        token.href = blobBase + token.href.replace(/^\.\//, '');
      }
    },
  });
}

export function renderSkill(skill: Skill, lang: 'ru' | 'en'): string | null {
  const file = join(skill.dir, lang === 'ru' ? 'SKILL.ru.md' : 'SKILL.en.md');
  if (!existsSync(file)) return null;
  const { content } = matter(readFileSync(file, 'utf8'));
  return renderer(skill.meta).parse(content) as string;
}

export const licenseLabel: Record<string, string> = {
  'Apache-2.0': 'Apache 2.0',
  MIT: 'MIT',
  proprietary: 'Закрытая (Anthropic)',
  unknown: 'Не указана',
  other: 'Другая',
};
