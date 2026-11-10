# Проверка кампаний и продолжения QA

Исходная задача: USER-2026-11-09 — реализовать общие улучшения продукта по итогам длительной QA-работы. Контракт: [OpenSpec](../openspec/changes/lab-campaign-continuity/specs/campaign-continuity/spec.md). Все шесть implementation tasks выполнены и проверены; change оставлен активным, без архивации и изменения старых changes.

## Итоговые проверки

- `just lint`: успешно; проверены синтаксис, JSON и Markdown-ссылки.
- `just test`: **102 passed, 0 failed, 0 skipped**, Node v25.8.0. [Полный лог](evidence/campaign-continuity/full-suite.log).
- Три последовательных stability-прогона по 44 теста: все завершились с exit 0. В набор вошли campaign, adapters, environment, lifecycle, native artifacts и сквозной пример.
- `npm run demo -- --out work/campaign-demo-final`: отчёт reconciled, 3 учтённые операции; реальный native-набор дал 1 passed и 1 намеренный skipped; сценарий удаления остался в очереди. Сохранённый пример (`campaign-demo-final/campaign/report.md` в локальном каталоге work, вне поставки).
- `openspec validate lab-campaign-continuity`: valid. `openspec status --change lab-campaign-continuity`: planning artifacts complete. Предупреждение про Source Task относится к будущей синхронизации при archive; source task сохранён в proposal/design/delta.
- Независимое review агентом gpt-6.1-terra high: после исправлений новых actionable findings нет. Отдельного установленного skill code-reviewer не было; выполнена его findings-first роль через независимого агента. Git diff недоступен: рабочий каталог не является Git checkout.

Команды, версии и результаты также сохранены в [машинной сводке](evidence/campaign-continuity/checks.json). Проверки не подтверждают совместимость со всеми Node 22 minor-версиями: фактический runtime указан выше.

## Проверяемые возможности

| Требование | Доказательство |
| --- | --- |
| Постоянные ID, история, версии, конкурентные записи | tests/campaign.test.mjs |
| Полнота учёта, оставшиеся проверки, неизвестные эффекты, source hashes | tests/campaign.test.mjs |
| Наблюдения не становятся pass/confirmed; дефекты закрываются проверкой того же правила | tests/campaign.test.mjs |
| Общий бюджет, binary envelope, duplicate headers, fault permission, продолжение цепочки | tests/adapters.test.mjs и tests/runtime.test.mjs |
| Preserve на ошибках и cleanup; doctor, снимки, restart, ownership и locks | tests/lifecycle.test.mjs и tests/environment.test.mjs |
| JUnit, точные случаи/skips, команды/версии, сбои и отсутствие отчёта | tests/test-artifacts.test.mjs |
| Сквозной общий пример | tests/campaign-demo.test.mjs и examples/campaign-demo.mjs |

## Обнаруженное и исправленное при разработке

- История оставшихся проверок могла теряться при завершении одного наблюдения; теперь обязательства сохраняются, а завершение требует явного учёта.
- Confirmed принимался без подтверждённого нарушения; теперь проверяются точное approved rule, источник, падающая проверка и сохранённое confirmation.
- Blocked/inconclusive можно было переименовать в observed; это отклоняется.
- Повторно открытые и нарушенные сценарии могли выпадать из очереди; теперь они явно queued/held.
- Настоящий JUnit Node содержит testcase непосредственно внутри testsuites; импорт поддерживает эту форму.
- Наследуемый NODE_TEST_CONTEXT мешал отдельному test runner; он удаляется из контекста subprocess.
- Физический путь временного каталога на macOS отличается от /var alias; приложения канонизируются, чтобы не создавать ложные unassigned-artifact.
- Старый успешный result мог закрывать новый дефект; теперь требуется свежее evidence, отсутствовавшее при регистрации finding.
- Повторное использование rule_id с другим смыслом больше не закрывает дефект: сравниваются текст approved rule и источник.
- Переходы confirmed/resolved проверяют исходный manifest hash и хеши supporting attachments, а не только result JSON.
- Если JUnit не появился, созданные collection/coverage всё равно сохраняются. Копии помещаются в уникальный каталог, исключая конфликт с исходным junit.xml.

## Соответствие предложенным улучшениям

1. Единый реестр проверок — scenario/execution events, явные статусы и оставшиеся обязательства.
2. Реестр дефектов — постоянные ID, версии, история и evidence-backed подтверждение/закрытие.
3. Автоматический итог — source inventory, discovery roots, reconciliation gate и версии отчётов.
4. Постоянный стенд — preserve policy, ownership declarations, project probes и lifecycle-команды.
5. Общие адаптеры — injected clients, точные сообщения, shared action budget и сохранение uncertainty.
6. Межэтапная корреляция — stage receipts, состояния видимости и продолжение snapshots.
7. Выбор следующей работы — novelty, remaining work, blockers, impact по components/versions.
8. Короткие маршруты навыка — first run, resume, changed version, execution checkpoints и finish; ограниченные задания агентов.
9. Существующие тесты — native test artifacts с точными случаями, skips, командой, версиями и collection/coverage.

## Границы доказательства

Тесты продукта используют изолированные временные каталоги, реальные локальные HTTP-серверы и child processes, а также injected client fixtures. Это не проверка всех внешних драйверов/сервисов или production-стенда. Диагностика приложения задаётся проектными probes; generic doctor не угадывает правильный mount/schema/endpoint. Snapshots не являются резервной копией внешних данных.

Старые QA-прогоны, Kafka/OpenSearch и другие исторические ресурсы не изменялись. Их автоматическая миграция не заявляется: новые кампании могут регистрировать существующие совместимые run manifests и неизменяемые приложения. Недостающие источники остаются явными пробелами.
