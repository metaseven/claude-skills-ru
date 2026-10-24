// Бесплатный офлайн-перевод через локальную модель Ollama (запасной вариант к /translate-skills).
//   npm run translate:local                                  — все скилы, которым нужен перевод
//   npm run translate:local -- anthropics/pdf                — выборочно
//   OLLAMA_MODEL=qwen2.5:32b npm run translate:local         — другая модель (по умолчанию gemma3:27b)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { DATA_DIR, loadSkills, pendingWork, readJson, writeJson } from './lib.mjs';

const MODEL = process.env.OLLAMA_MODEL ?? 'gemma3:27b';
const HOST = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
const CHUNK_CHARS = 3500;

const glossary = readJson(join(DATA_DIR, 'glossary.json'));
const categories = readJson(join(DATA_DIR, 'categories.json'));
const terms = Object.entries(glossary.terms).map(([en, ru]) => `${en} → ${ru}`).join('; ');

const SYSTEM = `Ты технический переводчик с английского на русский.
Правила:
${glossary.rules.map((r) => `- ${r}`).join('\n')}
- Не переводить: ${glossary.keepAsIs.join(', ')}.
- Термины: ${terms}.
- Маркеры вида ⟦CODE_0⟧ оставляй на своих местах без изменений.
- Отвечай только переводом, без пояснений.`;

async function chat(messages, format) {
  const res = await fetch(`${HOST}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, stream: false, format, options: { temperature: 0.2, num_ctx: 16384 } }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  return (await res.json()).message.content.trim();
}

// Блоки кода не отдаём модели: заменяем маркерами и возвращаем после перевода.
function protectCode(md) {
  const blocks = [];
  const text = md.replace(/^(```|~~~)[\s\S]*?^\1/gm, (block) => `⟦CODE_${blocks.push(block) - 1}⟧`);
  return { text, restore: (out) => out.replace(/⟦CODE_(\d+)⟧/g, (_, i) => blocks[Number(i)]), count: blocks.length };
}

function splitChunks(md) {
  const sections = md.split(/(?=^#{1,3} )/m);
  const chunks = [];
  for (const section of sections) {
    const last = chunks.at(-1);
    if (last !== undefined && last.length + section.length <= CHUNK_CHARS) chunks[chunks.length - 1] += section;
    else chunks.push(section);
  }
  return chunks;
}

async function translateChunk(chunk) {
  const expected = chunk.match(/⟦CODE_\d+⟧/g) ?? [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await chat([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Переведи этот фрагмент Markdown на русский:\n\n${chunk}` },
    ]);
    if (expected.every((m) => out.includes(m))) return out;
  }
  throw new Error('модель потеряла маркеры блоков кода');
}

async function translateMeta(meta, body) {
  const schema = {
    type: 'object',
    required: ['title', 'description', 'summary', 'category', 'tags'],
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      summary: {
        type: 'object',
        required: ['what', 'when', 'example'],
        properties: { what: { type: 'string' }, when: { type: 'string' }, example: { type: 'string' } },
      },
      category: { type: 'string', enum: categories.map((c) => c.id) },
      tags: { type: 'array', items: { type: 'string' } },
    },
  };
  const prompt = `Скил Claude «${meta.name}».
Описание (EN): ${meta.description}

Начало инструкции скила:
${body.slice(0, 6000)}

Верни JSON:
- title: короткое русское название (2–5 слов)
- description: полный перевод описания на русский
- summary.what: 1–2 предложения — что делает скил
- summary.when: 1–2 предложения — когда он полезен
- summary.example: пример запроса пользователя к Claude на русском
- category: одна из ${categories.map((c) => `${c.id} (${c.title})`).join(', ')}
- tags: 3–6 коротких русских тегов в нижнем регистре`;
  return JSON.parse(await chat([{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }], schema));
}

const only = process.argv.slice(2);
const todo = loadSkills().filter((s) =>
  only.length ? only.includes(`${s.meta.source}/${s.meta.slug}`) : pendingWork(s).length > 0);

console.log(`Модель: ${MODEL}. Скилов к переводу: ${todo.length}`);
for (const { dir, meta } of todo) {
  const id = `${meta.source}/${meta.slug}`;
  try {
    const raw = readFileSync(join(dir, 'SKILL.en.md'), 'utf8');
    const { data, content } = matter(raw);
    const ru = await translateMeta(meta, content);
    writeJson(join(dir, 'ru.json'), {
      sourceHash: meta.hash,
      model: `ollama:${MODEL}`,
      translatedAt: new Date().toISOString().slice(0, 10),
      ...ru,
    });

    if (meta.translationScope === 'full') {
      const { text, restore } = protectCode(content);
      const parts = [];
      for (const chunk of splitChunks(text)) parts.push(await translateChunk(chunk));
      const body = restore(parts.join('\n\n'));
      writeFileSync(join(dir, 'SKILL.ru.md'), matter.stringify(body, { ...data, description: ru.description }));
    }
    console.log(`✓ ${id}`);
  } catch (e) {
    console.log(`✗ ${id}: ${e.message}`);
  }
}
console.log('\nПроверьте результат: npm run validate');
