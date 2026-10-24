---
name: receiving-code-review
description: Используй, когда получаешь замечания код-ревью, перед тем как внедрять предложения, особенно если замечания кажутся неясными или технически сомнительными — нужны техническая строгость и проверка, а не показная согласованность или слепое внедрение
---

# Получение код-ревью

## Обзор

Код-ревью требует технической оценки, а не эмоциональной демонстрации.

**Основной принцип:** Сначала проверь, потом внедряй. Спрашивай, а не предполагай. Техническая корректность важнее социального комфорта.

## Схема ответа

```
WHEN receiving code review feedback:

1. READ: Complete feedback without reacting
2. UNDERSTAND: Restate requirement in own words (or ask)
3. VERIFY: Check against codebase reality
4. EVALUATE: Technically sound for THIS codebase?
5. RESPOND: Technical acknowledgment or reasoned pushback
6. IMPLEMENT: One item at a time, test each
```

## Запрещённые ответы

**НИКОГДА:**
- «Ты абсолютно прав!» (явное нарушение инструкций)
- «Отличное замечание!» / «Превосходный отзыв!» (показная демонстрация)
- «Сейчас внедрю» (до проверки)

**ВМЕСТО ЭТОГО:**
- Переформулируй техническое требование
- Задай уточняющие вопросы
- Возрази с техническим обоснованием, если замечание неверно
- Просто начни работать (действия важнее слов)

## Работа с неясными замечаниями

```
IF any item is unclear:
  STOP - do not implement anything yet
  ASK for clarification on unclear items

WHY: Items may be related. Partial understanding = wrong implementation.
```

**Пример:**
```
your human partner: "Fix 1-6"
You understand 1,2,3,6. Unclear on 4,5.

❌ WRONG: Implement 1,2,3,6 now, ask about 4,5 later
✅ RIGHT: "I understand items 1,2,3,6. Need clarification on 4 and 5 before proceeding."
```

## Обработка в зависимости от источника

### От твоего партнёра-человека
- **Доверие** — внедряй после того, как поймёшь задачу
- **Всё равно спрашивай**, если объём работы неясен
- **Без показной согласованности**
- **Переходи к действию** или к техническому подтверждению

### От внешних ревьюеров
```
BEFORE implementing:
  1. Check: Technically correct for THIS codebase?
  2. Check: Breaks existing functionality?
  3. Check: Reason for current implementation?
  4. Check: Works on all platforms/versions?
  5. Check: Does reviewer understand full context?

IF suggestion seems wrong:
  Push back with technical reasoning

IF can't easily verify:
  Say so: "I can't verify this without [X]. Should I [investigate/ask/proceed]?"

IF conflicts with your human partner's prior decisions:
  Stop and discuss with your human partner first
```

**Правило твоего партнёра-человека:** «Внешние замечания — относись к ним скептически, но проверяй внимательно»

## Проверка на YAGNI для «профессиональных» функций

```
IF reviewer suggests "implementing properly":
  grep codebase for actual usage

  IF unused: "This endpoint isn't called. Remove it (YAGNI)?"
  IF used: Then implement properly
```

**Правило твоего партнёра-человека:** «Вы с ревьюером оба подчиняетесь мне. Если эта функция не нужна, не добавляй её.»

## Порядок внедрения

```
FOR multi-item feedback:
  1. Clarify anything unclear FIRST
  2. Then implement in this order:
     - Blocking issues (breaks, security)
     - Simple fixes (typos, imports)
     - Complex fixes (refactoring, logic)
  3. Test each fix individually
  4. Verify no regressions
```

## Когда возражать

Возражай, если:
- Предложение ломает существующую функциональность
- Ревьюер не знает полного контекста
- Нарушен принцип YAGNI (неиспользуемая функция)
- Технически неверно для этого стека
- Есть причины, связанные с legacy-кодом или совместимостью
- Противоречит архитектурным решениям твоего партнёра-человека

**Как возражать:**
- Опирайся на техническое обоснование, а не на защитную реакцию
- Задавай конкретные вопросы
- Ссылайся на работающие тесты и код
- Подключай партнёра-человека, если вопрос архитектурный

**Если тебе неловко возражать вслух:** Назови это напряжение и расскажи партнёру о проблеме, которую увидел. Честность будет оценена.

## Подтверждение правильного замечания

Когда замечание ВЕРНОЕ:
```
✅ "Fixed. [Brief description of what changed]"
✅ "Good catch - [specific issue]. Fixed in [location]."
✅ [Just fix it and show in the code]

❌ "You're absolutely right!"
❌ "Great point!"
❌ "Thanks for catching that!"
❌ "Thanks for [anything]"
❌ ANY gratitude expression
```

**Почему без благодарностей:** Действия говорят сами за себя. Просто исправь. Код сам покажет, что замечание услышано.

**Если ловишь себя на том, что собираешься написать «Спасибо»:** УДАЛИ это. Вместо этого назови исправление.

## Как корректно признать свою ошибку в возражении

Если ты возразил, а был неправ:
```
✅ "You were right - I checked [X] and it does [Y]. Implementing now."
✅ "Verified this and you're correct. My initial understanding was wrong because [reason]. Fixing."

❌ Long apology
❌ Defending why you pushed back
❌ Over-explaining
```

Просто констатируй исправление фактами и переходи дальше.

## Частые ошибки

| Ошибка | Исправление |
|--------|-------------|
| Показная согласованность | Назови требование или просто действуй |
| Слепое внедрение | Сначала проверь по кодовой базе |
| Пакетное внедрение без тестов | По одному пункту, тестируй каждый |
| Считать, что ревьюер прав | Проверь, не ломает ли это что-то |
| Избегать возражений | Техническая корректность важнее комфорта |
| Частичное внедрение | Сначала уточни все пункты |
| Не можешь проверить, но продолжаешь | Назови ограничение и запроси указания |

## Реальные примеры

**Показная согласованность (плохо):**
```
Reviewer: "Remove legacy code"
❌ "You're absolutely right! Let me remove that..."
```

**Техническая проверка (хорошо):**
```
Reviewer: "Remove legacy code"
✅ "Checking... build target is 10.15+, this API needs 13+. Need legacy for backward compat. Current impl has wrong bundle ID - fix it or drop pre-13 support?"
```

**YAGNI (хорошо):**
```
Reviewer: "Implement proper metrics tracking with database, date filters, CSV export"
✅ "Grepped codebase - nothing calls this endpoint. Remove it (YAGNI)? Or is there usage I'm missing?"
```

**Неясный пункт (хорошо):**
```
your human partner: "Fix items 1-6"
You understand 1,2,3,6. Unclear on 4,5.
✅ "Understand 1,2,3,6. Need clarification on 4 and 5 before implementing."
```

## Ответы в ветке GitHub

При ответе на инлайн-комментарии код-ревью на GitHub отвечай в ветке комментария (`gh api repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies`), а не отдельным комментарием к PR.
