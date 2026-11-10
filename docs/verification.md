# Проверка реализации — 2026-10-22

`just lint` прошёл; `just test`: 28 passed, 0 failed. Skill validator: valid. OpenSpec change: valid. Python 3.14 внутри реального RAW image проверил синтаксис 11 файлов; host Python 3.9 не поддерживает используемый type alias. Ранее 13 рискованных тестов повторены трижды, каждый прогон прошёл.

Проверены approval integrity, неизменность deadline, общие HTTP request/in-flight limits, независимые роли, bounded polling, redirect refusal, claims, redaction, assertions-based coverage, отчёт и генерация/исполнение регрессий. Сгенерированный HTTP regression падает на сохранённом дефекте и проходит после изменения наблюдаемого поведения.

## Реальный запуск

Согласованы RSA-C2/C3/C5/C7. Изолированный Compose bll-rsa-20261022: RAW consumer/worker, PostgreSQL, Kafka, Data Prepper, OpenSearch, production API, независимые JWT identities. Репозитории приложений не изменялись; исходные изменения пользователя сохранены. Дедлайн исходного run не менялся.

Результат: 8 pass, 1 подтверждённый дефект конкурентной записи, 4 inconclusive; 98 фактических assertions. Это проверки конкретных сценариев, не доказательство всех возможных выполнений. Первые дубли имели слабый completion barrier; последующие точные повторы проверены с committed offsets. Committed offset не доказывает отсутствие ошибок/retry/DLQ: это отдельный пробел.

Подтверждена гонка summary/mapping upsert реальными SELECT/INSERT и двумя транзакциями PostgreSQL. Регрессия падает с IntegrityError. Отдельно воспроизведено противоречие BigInteger/Integer: int32 max проходит, max+1 падает; бизнес-диапазон не согласован. Две native-регрессии сохранены с логами, приложение не исправлялось. Поздний score дошёл до API; summary convergence остаётся inconclusive без SLA/retry проверки.

## Независимое ревью

Два подагента проверяли HTTP helper; замечания исправлены с тестами. Живой harness отдельно просмотрен исполнителем: добавлены точные envelope replays, consumer-offset barriers, deadline cancellation, shared native slots, точный учёт новых offset queries и exclusive claims. Остаточные ограничения приведены в live-отчёте. Dedicated code-reviewer отсутствует в каталоге; использовано независимое findings-first ревью.

UI отсутствует: фронтенд не предоставлен. Kerberos/TLS и production DLQ wiring не покрыты. Summary transport использует production routers/decoder/DI над локальным plaintext Kafka; JWT заменяет только Keycloak authority через документированный test exception. Нагрузка: четыре диалога, максимум два сценария одновременно, не capacity benchmark. Полная матрица ролей не согласована.

Полные доказательства: live summary (`rsa-live-20261022-01/live-summary.md` в локальном каталоге runs, вне поставки), машинный отчёт (`rsa-live-20261022-01/report.json` в локальном каталоге runs, вне поставки).

Финальная правка изоляции summary regression (уникальный ID вместо фиксированного) не исполнена: исходный дедлайн истёк, повтор заблокирован. Исходный реальный failing run подтверждён transcript excerpt и production exception log; полная первая копия test log была перезаписана, это явно отражено в live summary.

## Уточнение подготовки запуска

По уточнению пользователя добавлены task-derived настройки до запуска, раздельные назначения ролей/аккаунтов/исполнителей, same-role concurrency и обязательные релевантные boundary/contract-deviation сценарии. Канонический workflow — skill references/planning.md, шаблон — assets/test-plan.example.md. Проверены ссылки, skill metadata и OpenSpec. Это изменение инструкций; helper API и историческая RSA-приёмка не изменены, новый живой запуск не выполнялся.

## Второй реальный запуск: папки и фильтры

Отчёт (`folders-live-20261022-01/live-summary.md` в локальном каталоге runs, вне поставки): 249 HTTP операций в общем окне максимум 10 минут/250/4, три роли/аккаунта, реальные UI/OIDC/API. 40 сценариев: 26 pass, 12 повторов двух расхождений, 2 oracle-free observations. 98 assertions; history249 завершённых действий, без structural issues/uncertain. Published-name uniqueness и cross-author shared placement расходятся с новым человеческим эталоном; оба native regression исполнены и падают на соответствующих business effects. UI create conflict201/409, cross-author rename200, Users creationdisabled; UI publication/move unavailable и не объявлены пройденными. Shared visibilityUsers200 остаётся вопросом, не бизнес-дефектом.

`just test`: 44 passed, 0 failed. Добавлены11 generator/history тестов (включая compactCLI) и5 proxy tests с реальным локальным upstream. `just lint`, quick_validate и OpenSpec проверяются после итоговых docs. Независимый reviewer подтвердил исправления и границы выводов; dedicated code-reviewer отсутствует. Приложения не исправлялись; frontend рабочее дерево уже имело изменения, hashes/status сохранены.

## Каталог ракурсов — 26 октября 2026

По первичным интернет-источникам подготовлены два research-документа и source-linked library v1.0 из20направлений. Добавлены обязательная агентная матрица применимости по выбранной функции и вывод дополнительных гипотез из текущего кода/бизнес-правил/наблюдений; источник гипотезы не подменяет утверждённый oracle. Матрица Markdown не валидируется runtime helper автоматически. Новый файловый исполнитель, внешние fuzzing/model-based пакеты и сканеры не устанавливались; новый live-run не выполнялся. Исторические44теста helper повторно проверяются как регрессия инструмента, а не доказательство полноты тест-дизайна. Локальные ссылки/skill metadata/OpenSpec проверены; источники проверены датой, stable версии отличены от mutable/latest.

## Расширение runtime — 2 ноября 2026

Текущие механизмы и проверка четырёх улучшений описаны отдельно: [верификация runtime](verification-runtime.md). Исторические результаты выше сохраняют свои исходные границы.
