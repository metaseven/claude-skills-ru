---
name: webapp-testing
description: Набор инструментов для взаимодействия с локальными веб-приложениями и их тестирования с помощью Playwright. Поддерживает проверку функциональности фронтенда, отладку поведения интерфейса, создание скриншотов браузера и просмотр логов браузера.
license: Complete terms in LICENSE.txt
---

# Тестирование веб-приложений

Чтобы протестировать локальные веб-приложения, пиши нативные Python-скрипты Playwright.

**Доступные вспомогательные скрипты**:
- `scripts/with_server.py` - управляет жизненным циклом сервера (поддерживает несколько серверов)

**ВСЕГДА запускай скрипты с `--help` в первую очередь**, чтобы увидеть порядок использования. НЕ читай исходный код, пока не попробуешь запустить скрипт и не убедишься, что без индивидуального решения не обойтись. Эти скрипты могут быть очень большими и засорять контекстное окно. Они существуют, чтобы их вызывали напрямую как чёрные ящики, а не загружали в контекстное окно.

## Дерево решений: выбор подхода

```
User task → Is it static HTML?
    ├─ Yes → Read HTML file directly to identify selectors
    │         ├─ Success → Write Playwright script using selectors
    │         └─ Fails/Incomplete → Treat as dynamic (below)
    │
    └─ No (dynamic webapp) → Is the server already running?
        ├─ No → Run: python scripts/with_server.py --help
        │        Then use the helper + write simplified Playwright script
        │
        └─ Yes → Reconnaissance-then-action:
            1. Navigate and wait for networkidle
            2. Take screenshot or inspect DOM
            3. Identify selectors from rendered state
            4. Execute actions with discovered selectors
```

## Пример: использование with_server.py

Чтобы запустить сервер, сначала выполни `--help`, затем используй вспомогательный скрипт:

**Один сервер:**
```bash
python scripts/with_server.py --server "npm run dev" --port 5173 -- python your_automation.py
```

**Несколько серверов (например, бэкенд и фронтенд):**
```bash
python scripts/with_server.py \
  --server "cd backend && python server.py" --port 3000 \
  --server "cd frontend && npm run dev" --port 5173 \
  -- python your_automation.py
```

Чтобы создать скрипт автоматизации, включай только логику Playwright (серверами управляет скрипт автоматически):
```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True) # Always launch chromium in headless mode
    page = browser.new_page()
    page.goto('http://localhost:5173') # Server already running and ready
    page.wait_for_load_state('networkidle') # CRITICAL: Wait for JS to execute
    # ... your automation logic
    browser.close()
```

## Паттерн «разведка, затем действие»

1. **Изучи отрисованный DOM**:
   ```python
   page.screenshot(path='/tmp/inspect.png', full_page=True)
   content = page.content()
   page.locator('button').all()
   ```

2. **Определи селекторы** по результатам изучения

3. **Выполни действия**, используя найденные селекторы

## Частая ошибка

❌ **НЕ** изучай DOM до ожидания `networkidle` в динамических приложениях
✅ **Делай** `page.wait_for_load_state('networkidle')` перед изучением

## Лучшие практики

- **Используй вспомогательные скрипты как чёрные ящики** - для решения задачи проверь, может ли один из скриптов из `scripts/` помочь. Эти скрипты надёжно выполняют типовые сложные процессы и не засоряют контекстное окно. Используй `--help`, чтобы посмотреть порядок использования, затем вызывай скрипт напрямую.
- Используй `sync_playwright()` для синхронных скриптов
- ВСЕГДА закрывай браузер после завершения работы
- Используй понятные селекторы: `text=`, `role=`, CSS-селекторы или ID
- Добавляй подходящие ожидания: `page.wait_for_selector()` или `page.wait_for_timeout()`

## Справочные файлы

- **examples/** - примеры типовых паттернов:
  - `element_discovery.py` - поиск кнопок, ссылок и полей ввода на странице
  - `static_html_automation.py` - использование URL вида file:// для локального HTML
  - `console_logging.py` - сбор логов консоли во время автоматизации
