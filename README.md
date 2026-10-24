# Скилы Claude на русском

Статический каталог скилов Claude с русским переводом, поиском и фильтрами. Публикуется на GitHub Pages.

Источники: [anthropics/skills](https://github.com/anthropics/skills) и [obra/superpowers](https://github.com/obra/superpowers) (список — в `data/sources.json`).

## Как это устроено

```
data/
  sources.json, categories.json, glossary.json
  skills/<source>/<slug>/
    meta.json      ← пишет npm run sync (факты об оригинале: лицензия, хеш, ссылки)
    SKILL.en.md    ← оригинал
    ru.json        ← пишет переводчик (название, описание, пересказ, категория, теги)
    SKILL.ru.md    ← полный перевод (только для Apache-2.0/MIT и не больше 60 КБ)
```

Перевод выполняется **локально и бесплатно**: субагентами Claude Code по вашей подписке или через Ollama. GitHub Actions только собирает сайт.

## Обновление переводов

```bash
npm install
npm run sync      # подтянуть источники, увидеть, что изменилось
npm run status    # список скилов, которым нужен перевод
```

Затем в Claude Code, открытом в этой папке:

```
/translate-skills
```

Команда запускает субагента `skill-translator` (Haiku; Sonnet для длинных скилов) на каждый изменённый скил и проверяет результат.

Вариант без Claude — локальная модель через Ollama:

```bash
ollama pull gemma3:27b
npm run translate:local
```

Проверка перед коммитом:

```bash
npm run validate
```

## Локальный просмотр

```bash
npm run zips && npm run build && npm run preview
```

## Публикация на GitHub Pages

1. Создайте публичный репозиторий на GitHub и запушьте в ветку `main`.
2. В репозитории: Settings → Pages → Source: **GitHub Actions**.
3. Каждый push в `main` собирает и публикует сайт (`.github/workflows/deploy.yml`). Адрес — `https://<user>.github.io/<repo>/`.
4. Раз в неделю `.github/workflows/check-sources.yml` проверяет источники и открывает issue «Нужен перевод скилов», если что-то изменилось.

## Добавить источник

Добавьте запись в `data/sources.json` (репозиторий, ветка, папка со скилами, лицензия, команды установки), затем `npm run sync` и `/translate-skills`.
