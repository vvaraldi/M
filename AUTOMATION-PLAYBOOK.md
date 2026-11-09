# Automation playbook: from a portal request to an invoice

For the assistants (Claude conversations) and scripts that process quote requests from the M dealer portal.
The data format is in [REQUESTS-SCHEMA.md](REQUESTS-SCHEMA.md). This page says **what to do with it, in which order, and what not to do**.

Items marked **TO CONFIRM** are proposals that the owner has not confirmed yet. Ask before relying on them.

Read with: [REQUESTS-SCHEMA.md](REQUESTS-SCHEMA.md) (data format) and `..\SKITRAB-WORKBOOK-REFERENCE.md` (in the `Sharable info` folder, outside this repo because it names customers: workbook structure, stock rules, how to write to the workbook safely, ledger conventions).

## 1. Where a request comes from
- Every new request is emailed to the owner. The **plain-text part is complete** (customer, order details, one block per item) and **ends with the full JSON**. The same JSON is attached as `R-xxxx.json`, and a CSV as `R-xxxx.csv`.
- The Admin page → Requests can also download one request, or **all open requests** in one JSON file.
- Check `schema` is `1` before reading anything. If it is not, stop and tell the owner.

## 2. Find (or create) the customer
1. Match `shop.customerId` (for example `C003`) to `CustomerID` in the workbook's **Customers** sheet. Never match on the shop name alone.
2. If `customerId` is empty, **stop and ask the owner**: do not guess.
3. If the number is not in the sheet, the customer is new. Create it from the request:

| Customers column | From the request |
|---|---|
| Name | `shop.name` |
| Address | `shop.billTo` (billing), otherwise the first of `shop.addresses` |
| Country, Province | `shop.country`, `shop.province` (already spelled as in the sheet; blank for the USA) |
| Email | `contact.email` |
| Currency | `currency` |
| PriceType | from `priceTier`: `SHOP_…` = Shop, `RETAIL_…` = Retail, `EXPORT_…` = Export |
| TaxMode | `shop.taxMode` (QC, GST, None, Manual) |

4. **Taxes are never in the JSON.** The invoice adds them from the customer's TaxMode. If `taxMode` is empty, ask.

## 3. Build the invoice lines
- Match each line to the **Catalogue** by `sku` (the barcode / EAN). A line with an empty `sku` was kept under a `P:` code: match by `code` and `description`, and tell the owner.
- `qty` is the quantity. `unit` is `pair`, `piece` or `m`. For `m` (skin rolls) the price is **per metre**.
- `unitPrice` and `lineTotal` are in `currency`, before tax.
- **`priceTbd: true`** means the portal had no price (Demo, Old graphics, Defect, or no current-season price). The owner prices these lines. Do not invent a price: ask.
- `estimatedPrice: true` means the catalogue price ends in .99, which the workbook treats as an estimate. Point it out to the owner.
- Keep the request number and the customer's PO number on the invoice (`number`, `po`). Notes from the shop are in `notes`.

## 4. Which warehouse ships (TO CONFIRM)
Each line has `stock` per warehouse (`Eastman`, `CDEC`) as of `stockAsOf`:
`onHand` = physical count, `reserved` = held by **draft invoices in the workbook**, `available` = onHand − reserved.

Proposed rule: **ship from Eastman first, and take the rest from CDEC.** Any line that needs CDEC stock needs a shipment email to CDEC (it lists the CDEC lines, quantities, the `shipTo` address, `po` and `shipDate`).
`locations` is the old available-only view of the same numbers.

## 5. Stock numbers: what each one means
| Field | Meaning |
|---|---|
| `stock.<warehouse>.reserved` | Held by draft invoices in the workbook |
| `heldByThisRequest` | This request's own portal hold (= `qty`) |
| `heldByPortal` | Total held in the portal by **all open requests**, this one included |
| `stockAsOf` | When the Stock sheet was refreshed for these numbers. If older than about 36 hours, say so |

The workbook does **not** see portal holds, and the portal only sees the workbook through the uploaded stock file.

## 6. The order of operations (this avoids counting a pair twice)
A portal hold lasts **7 days**. The exact end is `expiresAt` (UTC; the email shows it in Toronto time). If nothing happens before then, the pairs go back to available.

1. **Create the Draft invoice in Excel while the hold is still active.** Now the pairs are reserved in both places.
2. **Refresh the Stock sheet, save, run the export and upload the stock** in Admin. The workbook's Available now already excludes the draft.
3. **Then press "Mark invoiced" on the request** in Admin. This releases the portal hold. Do it **after** step 2: if you release first, the pair briefly looks free to other shops.
4. Need more time? Admin → **Extend 7 days** (counts from the old end, or from today if the hold already ended).

Other statuses: `expired` (the hold ended by itself), `cancelled` (the shop cancelled), `released` (the owner released it), `invoiced`.

## 7. Red flags: stop and tell the owner
- `shop.customerId` or `shop.taxMode` is empty.
- Any line with `priceTbd: true`, or with `estimatedPrice: true`.
- `expiresAt` is less than 24 hours away.
- `stockAsOf` is old, or a line asks for more than `available` in all warehouses together.
- The request is not `reserved` any more.
- A `sku` is not found in the Catalogue.

## 8. What an automation must not do
- **Never write to the portal's database** or change a request's status: the owner does that in Admin.
- Never contact a shop about prices or availability without the owner's approval.
- Never change the workbook's Stock or Catalogue sheets: they are the source of truth and are only read by the export.
- Never keep or print credentials.

## 9. Still to be built
The shipment email to CDEC, the invoice draft and the ledger entry follow this page. Add the rule for section 4 and any change you decide here, so every assistant works the same way.

## 10. Proposed additions (TO CONFIRM — from the review of test requests R-0007 to R-0012, 2026-11-08)
1. **Customer mismatch (red flag).** `shop.customerId` is found but the name or email differs from the workbook's Customers row → stop and ask (the test requests used "Test shop" with C003, which is a different shop in the workbook).
2. **New customer defaults.** The Customers sheet also has Type, Phone, Terms, Notes, Active. Terms need a default for a new shop (Vincent's usual shop terms: "100% of this payment is due prior to shipping the goods."); Type = Shop for portal shops; Active = 1.
3. **Catalogue line choice.** Ski Trab reuses barcodes and one barcode can be on several catalogue lines (one per price season, e.g. NEVE 181 on the 22-23 and 23-24 lines). Match `sku` + `code` + `size`; take the line valid for the current season, otherwise the latest season.
4. **Price on the invoice.** Use the request's `unitPrice` (what the shop saw). If it differs from the workbook's catalogue price for that line, flag it to the owner.
5. **Condition and warehouse on the line.** The invoice line's Condition must be exactly the stock condition (`New`, `Demo`, `Old graphics`…) and From stock = the warehouse (`Eastman` / `CDEC`), because the Stock sheet matches sales by Location¦Condition¦SKU. Lines priced by the owner for Demo / Old graphics also get that rebate reason.
6. **Split lines.** A line served from both warehouses becomes two invoice lines, one per warehouse.
7. **Shipping.** Shipping cost is not in the request; the owner sets it (ask).
8. **Who does what in section 6.** The assistant can create the Draft invoice in the workbook file (Excel closed, latest saved copy, read back after writing). The owner does steps 2–4: open Excel (the Stock sheet refreshes), save, export, upload, then "Mark invoiced".
9. **What may be written.** A draft invoice writes to Invoices, Lines and (for a new customer) Customers only. Stock moves only on the owner's explicit instruction.
