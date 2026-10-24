// Статическая проверка содержимого скилов перед импортом и после перевода.
// Это не замена ручного просмотра, а подсветка того, на что смотреть в первую очередь.
//   block  — импорт невозможен (символические ссылки, скрытые символы, исполняемый frontmatter…)
//   review — подозрительно: нужен ручной просмотр и явное одобрение
//   info   — к сведению (скрипты и бинарные файлы, которые попадут в zip)
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { MAX_SKILL_BYTES, parseFrontmatter } from './lib.mjs';

// Невидимые и «переворачивающие» символы — классический способ спрятать инструкции от человека.
const HIDDEN_CHARS = /[​-‏‪-‮⁠-⁤⁦-⁩­͏᠎￹-￻]|﻿(?!^)|[\u{E0000}-\u{E007F}]|[\u{E0100}-\u{E01EF}]/gu;
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

const RULES = [
  // --- prompt injection: обращения к модели-переводчику и попытки сменить её инструкции ---
  ['injection', /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|preceding|system|all)\b[^.\n]{0,20}\b(instructions?|prompts?|messages?|rules|context)\b/i, 'Попытка отменить инструкции модели'],
  ['injection', /\b(as an?|you are (now )?an?|attention,?|note to (the )?|message (for|to) (the )?)\s*(ai |llm |language model )?(translator|translation (model|agent|assistant))/i, 'Обращение к модели-переводчику'],
  ['injection', /\b(when|while|before|after|instead of) translating\b/i, 'Инструкция «при переводе…»'],
  ['injection', /\b(note|message|instructions?) (to|for) (the )?(ai|llm|model|assistant|agent|claude)\b/i, 'Скрытое обращение к модели'],
  ['injection', /\b(new|updated|real|actual|hidden) (system )?instructions?\s*:/i, '«Новые инструкции:»'],
  ['injection', /\b(do not|don't|never)\s+(tell|inform|notify|mention|reveal|show)\b[^.\n]{0,20}\b(the )?user\b/i, 'Требование скрыть действие от пользователя'],
  ['injection', /\bwithout (telling|informing|notifying|alerting) (the )?user\b/i, 'Действие «без ведома пользователя»'],
  ['injection', /<\|?\/?(system|im_start|im_end|instructions?|assistant|human)\|?>|\[\/?INST\]|<<\/?SYS>>/i, 'Разметка служебных ролей модели'],
  ['injection', /\b(jailbreak|DAN mode|developer mode enabled)\b/i, 'Jailbreak-формулировки'],
  ['injection', /(игнорируй|забудь|отмени)[^.\n]{0,40}(предыдущ|прошл|вышеуказанн|системн|все)[^.\n]{0,20}(инструкц|указани|правил)/i, 'Попытка отменить инструкции (RU)'],
  ['injection', /(переводчик|при переводе|перед переводом|после перевода|вместо перевода)/i, 'Обращение к переводчику (RU)'],
  ['injection', /не (сообщай|говори|показывай|рассказывай)[^.\n]{0,20}пользовател/i, 'Требование скрыть от пользователя (RU)'],
  ['config', /dangerously-?skip-?permissions|bypassPermissions|--dangerously|permission-mode\s+bypass/i, 'Отключение проверок разрешений Claude Code'],
  ['config', /\.claude\/(settings(\.local)?\.json|hooks|agents|commands)\b|\bCLAUDE_PROJECT_DIR\b/i, 'Изменение настроек/хуков/агентов Claude Code'],

  // --- выполнение загруженного кода ---
  ['exec', /\b(curl|wget|iwr|Invoke-WebRequest|Invoke-RestMethod)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b/i, 'Загрузка и запуск скрипта из сети (curl | sh)'],
  ['exec', /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(python3?|node|perl|ruby|php)\b/i, 'Загрузка и запуск кода из сети'],
  ['exec', /base64\s+(-d|--decode|-D)\b[^\n]*\|\s*(sudo\s+)?(ba|z)?sh/i, 'Запуск закодированного base64-кода'],
  ['exec', /\b(eval|exec|Function)\s*\(\s*(atob|Buffer\.from|base64|bytes\.fromhex|codecs\.decode|zlib)/i, 'eval закодированных данных'],
  ['exec', /\bIEX\b|Invoke-Expression|powershell[^\n]*-enc(odedcommand)?\b/i, 'PowerShell: выполнение строки/закодированной команды'],
  ['exec', /\b(nc|ncat|netcat)\b[^\n]*\s-[ec]\s|\/dev\/tcp\/|\bsocat\b[^\n]*exec:/i, 'Обратная оболочка (reverse shell)'],
  ['exec', /\brm\s+-[a-z]*r[a-z]*f?\s+(--no-preserve-root\s+)?(~|\/|\$HOME|\/\*)(\s|$)/i, 'Удаление домашней или корневой папки'],
  ['exec', /\bchmod\s+[0-7]*[+]?[sx]?\s+[^\n]*&&[^\n]*\.\//i, 'Скачивание, chmod +x и запуск'],

  // --- доступ к секретам и закрепление в системе ---
  ['secrets', /(~|\$HOME|\/Users\/[^/\s]+|\/home\/[^/\s]+)\/\.(ssh|aws|gnupg|kube|docker|netrc|npmrc|pypirc|git-credentials|config\/gh|azure|gcloud)\b/i, 'Обращение к папкам с ключами и токенами'],
  ['secrets', /\bid_(rsa|ed25519|ecdsa|dsa)\b|\/etc\/(shadow|sudoers)\b|\bLogin\.keychain|security\s+find-(generic|internet)-password|\bkeychain\b[^\n]*dump/i, 'Чтение ключей/паролей'],
  ['secrets', /\$\{?(GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|SSH_AUTH_SOCK)\b/, 'Использование токенов из окружения'],
  ['secrets', /\b(printenv|env)\b\s*(\||>)|process\.env\s*\)|os\.environ\s*\)/i, 'Выгрузка всех переменных окружения'],
  ['persistence', /(>>?|tee\s+(-a\s+)?)\s*(~|\$HOME)\/\.(bashrc|zshrc|zshenv|profile|bash_profile|zprofile|config\/fish)/i, 'Запись в автозагрузку оболочки'],
  ['persistence', /\bcrontab\b|\blaunchctl\s+(load|bootstrap)|LaunchAgents|LaunchDaemons|systemctl\s+(--user\s+)?enable|schtasks|\\CurrentVersion\\Run/i, 'Автозапуск/планировщик'],
  ['persistence', /\bosascript\b|\bsudo\s+(-S|su\b)|\bvisudo\b/i, 'Повышение прав / AppleScript'],

  // --- утечка данных наружу ---
  ['exfil', /\b(webhook\.site|requestbin|pipedream\.net|ngrok(-free)?\.(io|app|dev)|pastebin\.com|transfer\.sh|interact\.sh|burpcollaborator|oast\.(fun|pro|live|site|online|me)|hookbin|beeceptor|canarytokens)\b/i, 'Сервис для приёма украденных данных'],
  ['exfil', /\b(curl|wget|http|Invoke-WebRequest)\b[^\n]*(--data(-binary|-raw)?|-d|-F|--upload-file|-T)\s+[^\n]*(@|\$\(|`|<\s*~)/i, 'Отправка локальных файлов/вывода команд в сеть'],
  ['exfil', /!\[[^\]]*\]\(https?:\/\/[^)\s]*\?[^)\s]*=/i, 'Внешняя картинка с параметрами (утечка через загрузку изображения)'],

  // --- обфускация ---
  ['obfuscation', /[A-Za-z0-9+/]{300,}={0,2}/, 'Длинный base64-блок'],
  ['obfuscation', /\b(?:[0-9a-fA-F]{2}){200,}\b/, 'Длинный hex-блок'],
  ['obfuscation', /(\\x[0-9a-f]{2}){20,}|(\\u[0-9a-f]{4}){20,}/i, 'Экранированная строка (\\x.. / \\u....)'],
];

// HTML, опасный при отображении (проверяем только вне блоков кода).
const HTML_RULES = [
  [/<\s*(script|iframe|object|embed|form)\b|<\s*base\s+href|<\s*meta\s+http-equiv|<\s*link\s+[^>]*rel=["']?import/i, 'HTML-тег, исполняющий код или подменяющий страницу'],
  [/<[a-z][^>]*\son[a-z]+\s*=/i, 'HTML-обработчик события (onclick=…)'],
  [/\]\(\s*(javascript|vbscript|data:text\/html)/i, 'Ссылка с javascript:/data:'],
  [/<!--([\s\S]*?)-->/, 'Скрытый HTML-комментарий (не виден при чтении)'],
];

const SCRIPT_EXT = new Set(['.sh', '.bash', '.zsh', '.py', '.js', '.mjs', '.cjs', '.ts', '.rb', '.pl', '.php', '.ps1', '.bat', '.cmd', '.applescript', '.scpt', '.command']);
const RISKY_NAMES = /(^|\/)(hooks\.json|settings(\.local)?\.json|\.mcp\.json|\.claude|\.git(hub)?|\.env|\.npmrc|package\.json|Makefile|setup\.py|pyproject\.toml)$/i;

export function sanitizeForTerminal(text, max = 140) {
  const clean = text
    .replace(HIDDEN_CHARS, (c) => `<U+${c.codePointAt(0).toString(16).toUpperCase()}>`)
    .replace(/\x1B/g, '<ESC>')
    .replace(CONTROL_CHARS, '?')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

// Диапазоны блоков кода — внутри них HTML безопасен (на сайте экранируется маркдауном).
function fenceRanges(md) {
  const ranges = [];
  for (const m of md.matchAll(/^(```|~~~)[\s\S]*?^\1/gm)) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}

export function scanText(text, file) {
  const findings = [];
  const push = (severity, rule, message, index, sample) =>
    findings.push({ severity, rule, message, file, line: index == null ? null : lineOf(text, index), sample: sample == null ? null : sanitizeForTerminal(sample) });

  for (const m of text.matchAll(HIDDEN_CHARS)) {
    if (m.index === 0 && m[0] === '﻿') continue;
    push('block', 'hidden-chars', 'Невидимые/управляющие символы Unicode (могут прятать текст)', m.index, text.slice(Math.max(0, m.index - 30), m.index + 30));
    break;
  }
  const ctrl = text.search(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/);
  if (ctrl !== -1) push('block', 'control-chars', 'Управляющие символы (в т.ч. ESC-последовательности терминала)', ctrl, text.slice(Math.max(0, ctrl - 30), ctrl + 30));

  for (const [rule, re, message] of RULES) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    for (const m of text.matchAll(g)) {
      push('review', rule, message, m.index, text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40));
      break; // одной находки на правило достаточно, чтобы привлечь внимание
    }
  }

  if (/\.(md|markdown|html?)$/i.test(file)) {
    const fences = fenceRanges(text);
    const inFence = (i) => fences.some(([a, b]) => i >= a && i < b);
    for (const [re, message] of HTML_RULES) {
      const g = new RegExp(re.source, re.flags + 'g');
      for (const m of text.matchAll(g)) {
        if (inFence(m.index)) continue;
        if (message.startsWith('Скрытый') && !m[1]?.trim()) continue;
        push('review', 'html', message, m.index, m[0]);
        break;
      }
    }
  }
  return findings;
}

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = lstatSync(path);
    out.push({ path, rel: relative(base, path), st });
    if (st.isDirectory()) walk(path, base, out);
  }
  return out;
}

function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

// Полная проверка папки скила из кэша источника.
export function scanSkillDir(dir) {
  const findings = [];
  const skillFile = join(dir, 'SKILL.md');
  const entries = walk(dir);
  let scripts = 0;
  let binaries = 0;

  for (const { path, rel, st } of entries) {
    if (st.isSymbolicLink()) {
      findings.push({ severity: 'block', rule: 'symlink', message: 'Символическая ссылка (может указывать на ваши файлы)', file: rel, line: null, sample: null });
      continue;
    }
    if (!st.isFile() && !st.isDirectory()) {
      findings.push({ severity: 'block', rule: 'special-file', message: 'Специальный файл (FIFO/устройство)', file: rel, line: null, sample: null });
      continue;
    }
    if (st.isDirectory()) continue;
    if (/(^|\/)\./.test(rel) || RISKY_NAMES.test(rel)) {
      findings.push({ severity: 'review', rule: 'risky-file', message: 'Скрытый или конфигурационный файл (может менять поведение инструментов)', file: rel, line: null, sample: null });
    }
    if (st.mode & 0o111) findings.push({ severity: 'info', rule: 'executable', message: 'Исполняемый файл', file: rel, line: null, sample: null });
    if (st.size > 5_000_000) {
      findings.push({ severity: 'review', rule: 'large-file', message: `Большой файл (${Math.round(st.size / 1e6)} МБ)`, file: rel, line: null, sample: null });
      continue;
    }
    const buf = readFileSync(path);
    if (isBinary(buf)) {
      binaries++;
      continue;
    }
    if (SCRIPT_EXT.has(extname(rel).toLowerCase())) scripts++;
    findings.push(...scanText(buf.toString('utf8'), rel));
  }

  if (scripts) findings.push({ severity: 'info', rule: 'scripts', message: `Скриптов в скиле: ${scripts} — попадут в zip и могут быть запущены Claude`, file: null, line: null, sample: null });
  if (binaries) findings.push({ severity: 'info', rule: 'binaries', message: `Бинарных файлов: ${binaries} (не проверяются)`, file: null, line: null, sample: null });

  // Сам SKILL.md: размер, кодировка, безопасный frontmatter.
  if (!entries.some((e) => e.rel === 'SKILL.md' && e.st.isFile())) {
    findings.push({ severity: 'block', rule: 'no-skill', message: 'SKILL.md отсутствует или не является обычным файлом', file: 'SKILL.md', line: null, sample: null });
    return findings;
  }
  const raw = readFileSync(skillFile);
  if (raw.length > MAX_SKILL_BYTES) findings.push({ severity: 'block', rule: 'size', message: `SKILL.md слишком большой (${raw.length} байт)`, file: 'SKILL.md', line: null, sample: null });
  if (isBinary(raw)) findings.push({ severity: 'block', rule: 'binary', message: 'SKILL.md содержит двоичные данные', file: 'SKILL.md', line: null, sample: null });
  try {
    parseFrontmatter(raw.toString('utf8'));
  } catch (e) {
    findings.push({ severity: 'block', rule: 'frontmatter', message: `Небезопасный frontmatter: ${e.message}`, file: 'SKILL.md', line: 1, sample: null });
  }
  return findings;
}

export function summarize(findings) {
  return {
    block: findings.filter((f) => f.severity === 'block').length,
    review: findings.filter((f) => f.severity === 'review').length,
    info: findings.filter((f) => f.severity === 'info').length,
  };
}

export function formatFindings(findings, indent = '    ') {
  const icon = { block: '⛔', review: '⚠️ ', info: 'ℹ️ ' };
  return findings
    .map((f) => `${indent}${icon[f.severity]} ${f.message}${f.file ? ` — ${sanitizeForTerminal(f.file, 80)}${f.line ? `:${f.line}` : ''}` : ''}${f.sample ? `\n${indent}     «${f.sample}»` : ''}`)
    .join('\n');
}
