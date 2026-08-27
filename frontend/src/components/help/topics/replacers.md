---
category: reference
order: 2
icon: wand
title: 'Replacers reference'
summary: 'Every {{ template }} you can use in a flow — random data, dates, ids.'
keywords:
  - 'replacer'
  - 'random'
  - 'handlebars'
  - 'template'
  - 'uuid'
  - 'timestamp'
  - 'faker'
  - 'email'
  - 'name'
  - 'barcode'
  - 'oneOf'
  - 'date'
---

Replacers customise requests, and mimicked responses, with values generated on
every run. They are Handlebars templates: write `{{ randomInt0_100 }}` and it
becomes a different number each time the flow runs.

### Numbers, ids and time

| Replacer | Result |
|-|-|
| `timestamp` | Current timestamp in ms — `1633024800000` |
| `datetime` | Current date and time, ISO — `2023-10-01T12:00:00.000Z` |
| `randomInt` | Integer between 0 and 999 |
| `randomInt0_5`, `randomInt0_10`, `randomInt0_100` | Integer under 5 / 10 / 100 |
| `randomInt0_200` … `randomInt0_5000` | Same idea, larger ranges |
| `randomInt0_9999` | Integer under 9999 |
| `uuid` | Random UUID |
| `randomPostmanId` | Random 6-digit integer |

### People

| Replacer | Result |
|-|-|
| `randomEmail` | `user123@example.com` |
| `randomName` | Full name — `John Doe` |
| `randomPersonName` / `randomPersonSurname` / `randomPersonPrefix` | `Jane` / `Smith` / `Mr.` |
| `phoneIntl` | `+1 555-123-4567` |
| `randomString` | 10-character alphanumeric string |

### Places and companies

| Replacer | Result |
|-|-|
| `belgianCityEn` | `Brussels` |
| `randomCompanyName` | `Acme Corporation` |
| `randomStreet` / `randomStreetNumber` / `randomPostalCode` | `Main Street` / `42` / `1000` |

### Dates in the past

`timeAgo`, `timestampAgo` and `tsAgo` take an amount and a unit (`ms`,
`seconds`, `minutes`, `hours`, `days`, `months`, `years`):

    timeAgo 5 "days"        # a Date, 5 days ago
    timestampAgo 2 "hours"  # milliseconds, 2 hours ago
    tsAgo 1 "month"         # YYYYMMDDHHMMSS, a month ago

### Helpers

    barcode(["123456", 3, "789"])   # "123456123789" — numbers add N digits
    oneOf(["a", "b", "c"])          # picks one at random

More replacers can be added in `src/helpers/replacer.js`.
