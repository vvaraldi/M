# Request export format (schema 1)

Every quote request can be downloaded from the portal Admin page (tab **Requests**, button *Download JSON* or *CSV*),
and each new request is emailed to the owner with the same JSON and CSV attached. Other tools (a shipment email to the
CDEC warehouse, invoice drafting, ledger entry) should read **this** format. It is produced by the same code in the
Cloud Function and in the browser, and a test (`functions/src/exportparity.test.js`) fails if the two ever differ.

Fields never change meaning within a schema version; new fields may be added. `schema` goes up only for a breaking change.

```json
{
  "schema": 1,
  "number": "R-0007",
  "status": "reserved",
  "createdAt": "2026-11-08T15:00:00.000Z",
  "expiresAt": "2026-11-15T15:00:00.000Z",
  "shop":    { "id": "s1", "name": "Cycle et Ski Bilodeau" },
  "contact": { "email": "buyer@bilodeau.test", "language": "fr" },
  "currency": "CAD",
  "priceTier": "SHOP_CAD",
  "shipTo": { "label": "Entrepôt", "text": "12 Chemin du Lac\nMagog QC" },
  "po": "PO-2026-114",
  "notes": "Free text from the shop",
  "shipDate": "2026-11-25",
  "lines": [
    {
      "brand": "SkiTrab", "code": "13216", "sku": "8057803529568",
      "description": "GARA PLUS", "size": "162", "color": "", "condition": "New", "unit": "pair",
      "qty": 2, "unitPrice": 714.97, "lineTotal": 1429.94,
      "priceTbd": false, "estimatedPrice": false,
      "locations": { "Eastman": 1, "CDEC": 4 }
    }
  ],
  "subtotal": 1429.94,
  "hasPriceTbd": false
}
```

| Field | Meaning |
|---|---|
| `status` | `reserved` (items held), `expired`, `cancelled`, `released` (owner released), `invoiced` |
| `createdAt`, `expiresAt` | ISO 8601 UTC. The hold lasts 7 days from sending (or from the last extension). Show dates in America/Toronto. |
| `shipTo` | One of the shop's saved addresses (up to 3), or `null` when the shop has none on file. |
| `shipDate` | Requested ship date, `YYYY-MM-DD`, or `null`. |
| `lines[].sku` | The barcode (EAN) when known, empty for items kept under a `P:` code. |
| `lines[].code` | The item (part) code shown to shops. |
| `lines[].unit` | `pair`, `piece` or `m` (skin rolls are sold and priced per metre). |
| `lines[].unitPrice`, `lineTotal` | In `currency`, before tax. Both `null` when `priceTbd` is true: the owner prices that line on the invoice. |
| `lines[].estimatedPrice` | The catalogue price ends in .99, which the workbook treats as an estimate. |
| `lines[].locations` | **Owner only.** Quantity in stock per warehouse (`Eastman`, `CDEC`) when the request was sent. It is a snapshot, not an allocation: decide which warehouse ships. |
| `subtotal` | Sum of the priced lines, before tax. Add the lines with `priceTbd` yourself. |

Taxes are never included: the invoice adds them from the customer's tax mode.

## CSV

One row per line, UTF-8 with a BOM so Excel opens it correctly. Columns: `request, shop, contact, currency, po, ship_to,
brand, code, barcode, description, size, color, condition, qty, unit, unit_price, line_total, price_tbd, eastman, cdec`.

## Where requests live (for developers)

| Firestore document | Content | Readable by |
|---|---|---|
| `requests/<R-0007>` | the request without warehouse locations | the owner and users of that shop |
| `requestsPrivate/<R-0007>` | `{ lines: { <itemId>: { Eastman, CDEC } } }` | the owner only |
| `reserved/<brand>` | `{ map: { <itemId>: qty held by open requests } }` | users who may see that brand |
| `counters/requests` | `{ next: n }` request number counter | nobody (Cloud Functions only) |

Browsers never write these: all changes go through the Cloud Functions `submitRequest` and `updateRequest`, which check
the stock and write everything in one transaction, so two shops can never reserve the same last pair.
