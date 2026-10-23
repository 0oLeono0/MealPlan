# Стоимость и бюджет S1-11 / PRICE-01

`calculateMoney(input: MoneyCalculationInput): MoneyCalculation` — чистая функция
из `money.ts`. Принимает готовый `StockCalculation` S1-10 (потребность S1-09 и
исходные вклады уже масштабированы) и один разрешённый справочный набор.
Масштабирование рецептов и распределение запасов не выполняются повторно.
Все деньги и количества — `Rational`; число упаковок — каноническая строка
целого ≥ 0, без промежуточного `number`. Валюта — RUB.

## Вход и граница разрешения

| Поле | Значение / соответствие DTO |
| --- | --- |
| `stock` | `calculateStock` для одного planId/variantId. Только `deficit.kind === available` разрешает окончательную закупку. `uncoveredKnown` и `knownLeftover` для неё не используются |
| `prices` | Числовая проекция одного полного `PriceSetDTO` и разрешённых оценок из того же каталога, включая выборы других ключей |
| `versions` | Ожидаемые `catalogVersion`, точный `priceSetRef`, `pricePolicyVersion` из входа попытки. Несовпадение отклоняется |
| `evaluationDate`, `timeZone` | Явная дата вычисления/оценки и зона. Часы и текущая дата не читаются |
| `budgetRub` | Точный общий L для всех людей/периода. Допустимость пользовательского ввода 500…15000 с шагом 100 проверяет форма/адаптер, не денежная арифметика; отрицательный лимит здесь отклоняется |

`ReferencePriceSet` сохраняет ref, catalogVersion, reference-price-v1, RUB,
setDigest, assessedOn, checkedOn, publishedOn, selections и estimates. Digest
принимается как метаданные проверенного снимка, не вычисляется этим модулем.
Целый DTO каталога не является входным типом функции.

`ReferencePriceSelection`:

- `key: {stateRef, basisRef}` — точный ключ DTO с обеими recordVersion.
- `basis` — разрешённый `QuantityBasis` именно этого ключа.
- `steps` — единственная выбранная упорядоченная цепочка `ConversionStep` из
  `conversionRefs` DTO; включает направление и подтверждение условий.
- `resolution` — available с estimateRef; missing с непустыми missingFields
  и reasons; withdrawn с estimateRef, withdrawnOn/By, evidenceRefs, decisionRef
  и reasons. Числа/estimateRef у missing нет.

`ReferencePriceEstimate` разрешает ref, productRef/stateRef, amountRub,
priceBasis, referenceSale, assessedOn/checkedOn. В indivisible packageContent
точно совпадает с priceBasis по основанию и величине; label/sourceRefs сохранены.
`observations` — проекция ref, observedOn, checkedOn каждого исходного наблюдения.
`zeroPriceEvidenceRefs` — явно разрешённые доказательства настоящей нулевой цены;
пустой массив не позволяет amountRub=0. Полного отдельного такого поля в DTO
нет: адаптер извлекает доказательства из проверенного графа источников.

Пример соответствия реальному опубликованному snapshot.json: amountRub `{n,d}`
преобразуется в `Rational`; `priceBasis`/`packageContent` `{decimal,basisRef}` —
в `Quantity` через `parseDecimalText` и точное разрешение quantityBases. У базы
в каталоге нет productRef: он разрешается через `stateRef → states.productRef`.
Не следует подставлять basisRef/productRef оценки из имени продукта. Проверка
реального формата всех 29 ключей есть в money.test.ts; её локальный мост —
тестовая фикстура, не производственный codec.

Будущий адаптер до вызова обязан:

1. Проверить полный catalog-v2, один принятый priceSet/review, полное замыкание
   точных ссылок и неизменность каждой пары id/recordVersion. Проверить методы
   выбора, происхождение, свидетельства, конкретный товар/съедобное состояние,
   конфликты, даты решения и публикации. Наблюдение не становится runtime-ценой.
2. Проверить digest/versions/freshness, точное совпадение frozen priceSelections
   с целым набором; не фильтровать missing/withdrawn и не достраивать цену локально.
3. Разрешить все ключи, оценки, bases, коэффициенты и свидетельства из этого же
   замороженного каталога. Не передавать старую оценку из другого снимка.
   Обеспечить общие основания потребности до S1-09/S1-10.
4. Сохранить полный DTO и его транзитивное замыкание (в том числе provenance,
   selectionMethod, источники, условия и сроки исторических наблюдений) в
   CalculationBasisDTO/usedCatalogRecords. Числовая проекция не заменяет их.
5. Назначить calculationId/basisDigest, привязать день/слоты/покупки к одному
   расчёту, сериализовать Rational и причины, добавить category и
   requiredGoodsRequirements из меню/каталога. Для S1 один день: его C равен
   money.C; perPersonC = точное C слота / H из сохранённого вклада. Хранение,
   применение, CAS, полный codec и допуск остальных hard-checks — вне модуля.

Модуль дополнительно отклоняет видимые дефекты проекции: дубли ключей/оценок,
неразрешённые обязательные ключи и estimateRef, чужие версии набора/каталога,
конфликты определений bases/коэффициентов, несогласованные вклады R,
повреждённую топологию названных переводов, неверную упаковку/цену/дату.
Исключения `MONEY_PAYLOAD_INVALID`, `MONEY_REFERENCE_MISSING`,
`MONEY_PRICE_SET_MISMATCH`, `MONEY_VERSION_UNSUPPORTED` — техническая ошибка
границы; адаптер сопоставляет их с PAYLOAD_INVALID/SNAPSHOT_CORRUPT,
REFERENCE_MISSING и VERSION_UNSUPPORTED контракта. Это не successful unavailable.
Проверка проекции не заменяет валидацию всего графа, описанную выше.

## Арифметика и независимая доступность

Для каждого ключа C, A0 и A1 используют одну оценку, одну (p,v), модель и цепочку.
`convertQuantity` выполняет простые единицы и переданные подтверждённые шаги;
нет поиска пути, неявной плотности/обратного коэффициента. Прямое приведение
g↔kg/ml↔l не требует нового свидетельства. Отсутствие физического перевода,
неподтверждённые условия/направление либо выход за диапазон возвращают
CONVERSION_MISSING с подробностями конвертера, а не ноль. Даже для перехода
состояния это причина недостающего ценового перевода; складские причины из
S1-10 сохраняются отдельно. Диапазоны проверяются для каждого конкретного q, R и d:
их доступность может различаться. Никакого округления количества перед переводом
или ceil нет.

| Результат | Определение |
| --- | --- |
| c(q), C | Линейно q/v×p, включая домашнюю часть; объяснение по каждому исходному ingredientId/slotId, затем суммы строк/слотов/меню. Никакого ceil для C |
| `withoutStockAcquisition`, A0 | F(R), по общей потребности строки |
| `acquisition`, A1 | F(d), только по available deficit S1-10 |
| by_quantity | requested=purchased=x в основании оценки; amountRub=x/v×p, дробная штука допустима |
| indivisible | n=ceil(x/v); purchased=n×v; amountRub=n×p; при x=0 n=0, если всё обязательное основание полно |
| E, T, O | E=A0−A1, T=A1 в S1, O=L−T; отрицательный O допустим |
| K | Сумма amountRub только полностью доступных текущих acquisition. Никакой части неизвестного дефицита. Не подменяет T/E/O |

`CalculatedMoney<T>` имеет available/value либо unavailable с непустыми reasons.
В MoneyReason сохраняются ценовые, складские и конверсионные причины.
Одинаковая причина с тем же путём при объединении удаляется; разные строки и
разные причины остаются. Причины запасов сохраняют исходные entry IDs, R/Sknown;
ценовые — priceSetRef/key/missingFields либо estimateRef/дату/решение отзыва.

Неизвестный d оставляет C/A0 доступными при их полном основании. Независимые
строки/слоты также сохраняют доступность. Missing/withdrawn дают разные причины
и блокируют зависимые деньги, даже при d=0. Архивная оценка, наблюдение и ноль
не являются запасным источником. Строка с unknown d не приобретает одну упаковку
и не оценивается по uncoveredKnown. При нескольких причинах ID строки остаётся
единственным в unresolvedLineIds.

`budgetAssessment` содержит точный actual=T и budgetRub. При полном T:
confirmed для T≤L, violated/BUDGET_EXCEEDED с excessRub=T−L иначе. При неполном T:
unconfirmed с причинами, даже если K уже больше L. Форматирование и epsilon
не участвуют. `formatMoney`/`formatMoneySum` остаются отдельным представлением.

Возраст оценки, истёкшая акция, магазинный остаток, слот и минимальный заказ
не передаются как условия расчёта. Смена evaluationDate сама по себе не отменяет
оценку; все её даты/версии остаются в basis. Будущая публикация относительно
evaluationDate отклоняется. Обновление набора и stale проверяет вызывающий слой.

## Выход и идентификаторы

`MoneyCalculation` сохраняет planId/variantId, basis с полной переданной ценовой
проекцией, versions/evaluationDate/timeZone, lines, slots и money.

- `lines` содержат исходную `StockDemandLine`, priceSelectionRef,
  ingredientCost/contributions и обе acquisition. Исходные R/u/d/остатки и
  распределения доступны без повторного расчёта.
- `slots` сохраняют slotId/order, вклады и ingredientCostC. Исходный вклад содержит
  рецепт, масштаб, H и цепочки S1-09; деньги оценивают готовое quantity.
- `money` соответствует числовой части MoneySummaryDTO: C/A0/A1/E/T/O,
  K, unresolvedLineIds, budgetRub, budgetAssessment.

`moneyLineId('demand'|'shopping', planId, variantId, key)` строит `demand:` либо
`shopping:` + CanonicalJSON-v1 массива строк `[planId,variantId,stateId,basisId]`.
Для такого массива JSON.stringify соответствует каноническому представлению.
Версии сохраняются в точных priceSelectionRef/basis, не в runtime ID. Дубликат
получившегося ID внутри варианта отклоняется. `unresolvedLineIds` — уникальные
shoppingLineId строк с unavailable acquisition. Сортировка/фильтр их не меняют.
Технический demandKey S1-09 не становится DTO ID.

Строки выходят в порядке demandKey (UTF-16), слоты — по явному order, вклады
слота — по ingredientId. Выход — отдельный глубоко замороженный снимок; входные
объекты не изменяются и не замораживаются функцией. Повторы начинают с тех же
потребностей/дефицита; домашние запасы не списываются, упаковочный излишек
автоматически не зачисляется. Ручных строк, отметок, генератора и UI здесь нет.
