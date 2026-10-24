import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Marked } from 'marked';
import { parseFrontmatter } from '../../scripts/lib.mjs';

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
  treeHash: string;
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

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// Markdown из чужих репозиториев: «сырой» HTML показываем как текст (никаких <script>, onclick и т.п.),
// ссылки — только http(s)/относительные, картинки не загружаем (могут следить за посетителем).
function renderer(meta: Meta) {
  const blobBase = `https://github.com/${meta.repo}/blob/${meta.commit}/${meta.path}/`;
  const safeHref = (href: string) => {
    if (/^https?:\/\//i.test(href) || href.startsWith('#')) return href;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('/')) return null;
    return blobBase + href.replace(/^\.\//, '');
  };
  const md = new Marked({ gfm: true });
  md.use({
    renderer: {
      html({ text }) {
        return escapeHtml(text);
      },
      link({ href, tokens }) {
        const url = safeHref(href);
        const label = this.parser.parseInline(tokens);
        return url ? `<a href="${escapeHtml(url)}" rel="nofollow noopener noreferrer">${label}</a>` : label;
      },
      image({ href, text }) {
        const url = safeHref(href);
        const label = escapeHtml(text || 'изображение');
        return url ? `<a href="${escapeHtml(url)}" rel="nofollow noopener noreferrer">[${label}]</a>` : `[${label}]`;
      },
    },
  });
  return md;
}

export function renderSkill(skill: Skill, lang: 'ru' | 'en'): string | null {
  const file = join(skill.dir, lang === 'ru' ? 'SKILL.ru.md' : 'SKILL.en.md');
  if (!existsSync(file)) return null;
  const { content } = parseFrontmatter(readFileSync(file, 'utf8'));
  return renderer(skill.meta).parse(content) as string;
}

export const licenseLabel: Record<string, string> = {
  'Apache-2.0': 'Apache 2.0',
  MIT: 'MIT',
  proprietary: 'Закрытая (Anthropic)',
  unknown: 'Не указана',
  other: 'Другая',
};
