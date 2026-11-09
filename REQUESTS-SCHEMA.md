# Request export format (schema 1)

The owner's email for each request is complete on its own: the plain-text part lists the customer (workbook number, tax mode,
region, billing address), the order details (PO, ship date, ship to, notes) and every line with its barcode, condition, stock per warehouse and
what the portal already holds, and ends with this same JSON in full. The HTML part shows the same and the JSON is also attached as a file.

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
  "shop": {
    "id": "s1", "name": "Example Ski Shop",
    "customerId": "C999", "country": "Canada", "province": "QC", "taxMode": "QC",
    "billTo": "100 Example Street\nSpringfield QC A1A 1A1",
    "addresses": [ { "label": "Store", "text": "100 Example Street\nSpringfield QC" } ]
  },
  "contact": { "email": "buyer@example.test", "language": "fr" },
  "currency": "CAD",
  "priceTier": "SHOP_CAD",
  "shipTo": { "label": "Warehouse", "text": "5 Sample Road\nSpringfield QC" },
  "po": "PO-2026-114",
  "notes": "Free text from the shop",
  "shipDate": "2026-11-25",
  "stockAsOf": "2026-11-08T17:53",
  "lines": [
    {
      "brand": "SkiTrab", "code": "13216", "sku": "8057803529568",
      "description": "GARA PLUS", "size": "162", "color": "", "condition": "New", "unit": "pair",
      "qty": 2, "unitPrice": 714.97, "lineTotal": 1429.94,
      "priceTbd": false, "estimatedPrice": false,
      "locations": { "Eastman": 1, "CDEC": 4 },
      "stock": {
        "Eastman": { "onHand": 1, "reserved": 0, "available": 1 },
        "CDEC":    { "onHand": 6, "reserved": 2, "available": 4 }
      },
      "heldByPortal": 3,
      "heldByThisRequest": 2
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
| `shop.customerId` | The customer number in the workbook's Customers sheet (for example `C008`), entered by the owner on the shop in Admin. `""` until set, so match on it when present. |
| `shop.taxMode` | The workbook's tax modes: `QC` (TPS + TVQ), `GST` (TPS only), `None` (no tax, export), `Manual`, or `""` when not set. |
| `shop.country`, `province`, `billTo` | Private customer details entered by the owner, to create the customer in the workbook if it does not exist yet. `billTo` is the billing address. |
| `shop.addresses` | All delivery addresses saved for the shop (up to 3). `shipTo` is the one chosen for this request. |
| `stockAsOf` | When the Stock sheet was refreshed for the upload that this request's stock numbers come from. If it is old, trust the numbers less. |
| `lines[].locations` | **Owner only.** *Available* quantity per warehouse (`Eastman`, `CDEC`) when the request was sent. A snapshot, not an allocation: decide which warehouse ships. |
| `lines[].stock` | **Owner only.** Per warehouse: `onHand` (physical count), `reserved` (held by draft invoices in the workbook) and `available` (= onHand − reserved). Use `reserved` to avoid counting a pair twice when it is already on a draft invoice. |
| `lines[].heldByThisRequest` | This request's own portal hold for the item: always equal to `qty`. |
| `lines[].heldByPortal` | Total quantity of this item held in the portal by **all open requests**, this one included (not just this request's own hold: see `heldByThisRequest`). Portal holds are separate from `stock.reserved`, which the workbook sees. `null` for requests made before this field existed. |

What to do with a request, step by step, is in [AUTOMATION-PLAYBOOK.md](AUTOMATION-PLAYBOOK.md).
| `subtotal` | Sum of the priced lines, before tax. Add the lines with `priceTbd` yourself. |

Taxes are never included: the invoice adds them from the customer's tax mode.

## CSV

One row per line, UTF-8 with a BOM so Excel opens it correctly. Columns: `request, shop, contact, currency, po, ship_to,
brand, code, barcode, description, size, color, condition, qty, unit, unit_price, line_total, price_tbd, eastman, cdec,
customer_id, province, tax_mode, eastman_on_hand, eastman_reserved, eastman_available, cdec_on_hand, cdec_reserved, cdec_available, held_by_portal, held_by_this_request`.
Requests created before these fields existed leave them empty.

## Where requests live (for developers)

| Firestore document | Content | Readable by |
|---|---|---|
| `requests/<R-0007>` | the request without warehouse locations | the owner and users of that shop |
| `requestsPrivate/<R-0007>` | warehouse stock per line, `held`, `stockAsOf` and the shop's private customer details at the time of sending | the owner only |
| `shopsPrivate/<shopId>` | `{ customerId, taxMode, country, province, billTo }`, edited in Admin → Shops | the owner only |
| `reserved/<brand>` | `{ map: { <itemId>: qty held by open requests } }` | users who may see that brand |
| `counters/requests` | `{ next: n }` request number counter | nobody (Cloud Functions only) |

Browsers never write these: all changes go through the Cloud Functions `submitRequest` and `updateRequest`, which check
the stock and write everything in one transaction, so two shops can never reserve the same last pair.
