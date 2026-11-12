# M dealer portal

A login-only web portal where invited partner shops see M's current stock, prices in their own currency,
in English, French or Italian.

- **Site:** static HTML/JS in [`docs/`](docs), published with GitHub Pages at `https://vvaraldi.github.io/M/`
- **Back end:** Firebase project `m-dealer-portal` (Authentication email-link sign-in, Firestore database `m-dealer-db`)
- **Source of truth:** the owner's Excel workbook. It is only ever *read*; nothing is written back to it.

> This repository is **public and holds code only**. Never commit workbooks, exports, keys or passwords
> (`.gitignore` already blocks the usual ones). Business data lives in Firestore behind sign-in.

## How it works

```
Excel workbook ──(tools/run-export.bat)──> tools/output/stock.json ──(Admin page, owner only)──> Firestore
                                                                                                    │
                                    invited shop signs in with an emailed link ──> sees its own currency's prices
```

Firestore security rules ([`firestore.rules`](firestore.rules)) are what protect the data:

| Data | Who can read it |
|---|---|
| `users/<email>` (an invitation) | the admin, and that person for their own record |
| `shops/<id>` | the admin, and users of that shop |
| `stock/meta` (date, contact) | admin and any invited, active user |
| `stock/items__<brand>` (lines, no prices, no location), plus `items__<brand>__w1` / `__w2` for shops limited to one warehouse | admin, and only users whose invitation lists that brand, and (for `__w1`/`__w2`) whose warehouse choice is that one |
| `prices/<TIER>__<brand>` e.g. `SHOP_CAD__skitrab` | admin, and only users whose invitation names that tier **and** that brand |
| `reserved/<brand>` (quantities held by open requests; `reserved/<brand>__w1` / `__w2` for restricted shops) | admin, and users who may see that brand with the matching warehouse choice; written only by Cloud Functions |
| `requests/<R-0001>` | admin, and users of the shop that sent it; written only by Cloud Functions |
| `requestsPrivate/*`, `admin/*` (warehouse locations, brand list, upload details) | admin only |
| everything else | nobody |

## Everyday use

### Publish new stock
1. In Excel: open the workbook, refresh the **Stock** sheet, **save and close** it.
2. Double-click [`tools/run-export.bat`](tools/run-export.bat). Read the report it prints
   (items without a price, items with no catalogue match, a warning if the Stock sheet is old).
3. Open the portal's **Admin** page, tab **Stock upload**, choose `tools/output/stock.json`, check the summary, **Publish**.

Prices come from the Catalogue sheet line valid for the season set in
[`tools/portal-settings.json`](tools/portal-settings.json) (`currentSeasonCode`; 26 = 26-27).
A price ending in `.99` is shown with an "est." tag. Items without a current-season price show "Price on request".
Used, Demo and Defect items show "Price on request" (you price them case by case on the invoice). Mounted ski + binding kits
(`Mounted & New`, `Mounted & Used`) are not shown on the portal at all (`hideConditions` in `portal-settings.json`).

### Previous-season rebates
Older collections are sold with a standard rebate that depends on the brand and on the **age** of the collection (current season minus the last season the item is in
the Catalogue). **The percentages live in one place only: the workbook** (Settings sheet, table `tAgeRules`, plus the list `Age rule conditions`), and the
workbook's Stock sheet carries each item's age. To change a percentage: edit `tAgeRules`, open the Stock sheet (it refreshes), save, run `run-export.bat`, upload `stock.json`.
- The export prices a **New** item aged 1 year or more from the item's **latest** Catalogue price (per price column, by barcode then part number), minus the brand's rebate:
  the *retail* % on the Retail price lists and the *shop* % on the Shop **and Export EUR** lists. Age 0, brands without rules and conditions outside the rule keep the normal logic.
- Shops see the net price large, the regular price crossed out, a `-25 %` badge and a **Previous season** label (FR *Saison précédente*, IT *Stagione precedente*),
  a *Previous season only* filter and a *Biggest rebate first* sort. **The age is never shown to shops** (and the age and last season stay in the export file, not in what is published).
  The suggested retail price shown next to a shop price is the retail price after the retail rebate.
- A request line carries `listPrice`, `rebatePct` and `rebateReason: "Previous season"` (see `REQUESTS-SCHEMA.md`) so the invoice draft can carry the rebate on the line.
- `run-export.bat` prints the rebate summary; `tools/output/report.txt` lists aged items without a rule, aged items in other conditions (on request), hidden mounted kits,
  base prices borrowed from another line with the same part number, and any difference of more than a cent from the workbook's own CAD net prices.
  It stops if the workbook's current season and `portal-settings.json` disagree, and warns if the Stock sheet has no (or empty) age columns: open the workbook, open the Stock sheet, save, export again.
- `stock.json` is now schema 2. Publish with the new Admin page (it also accepts schema 1).

### Add or change a shop
Admin page → **Shops**: name, currency, price type (Shop / Retail / Export), language, **brands**, up to 3 addresses,
and the email addresses allowed to sign in. Save, then press **Send sign-in email** next to each address.
A shop can have several users; each user keeps their own language choice.

### Brands
- A shop must have at least one brand ticked; its users only ever receive those brands (enforced by the security rules, not just hidden).
- A user can have their own list: set **Brands: custom** on that user (marked `*` in the shop list). Default is "same as shop".
- Users who may see more than one brand get brand filter chips and the brand name on each card.
- **Where the brand comes from:** the `Brand` column of the **Catalogue** sheet, matched through the barcode. Stock lines that
  have no catalogue match use `brandRules` in `tools/portal-settings.json` (for example any description starting with
  `VILLACAMPA`), otherwise `defaultBrand`. The export report lists every item whose brand was assumed.
- **New brand:** add its lines to the Catalogue sheet with the brand name in the `Brand` column, export, publish, then tick it on the shops that may see it.
  Two names that differ only by punctuation or case (for example `SkiTrab` and `Ski-Trab`) are refused.
- A brand with a different season numbering can be given its own season in `seasonByBrand`.

### Which warehouse a shop can buy from
Admin → **Shops** → Edit → **Stock this shop can buy from**: *All warehouses* (default, the combined stock), *Eastman only* or *CDEC only*.
- A restricted shop only sees (and can only request) the quantity held by that warehouse; items with none there do not appear. **No shop ever sees where stock is**:
  each shop only receives the documents of its own choice, and the internal codes (`w1`, `w2`) do not name a warehouse.
- Reservations stay correct across shops: an Eastman-only shop cannot take Eastman stock that is already held, while an all-warehouses shop's hold only
  reduces a single warehouse when it has to (the exact rule is in `functions/src/scope.js`, with tests).
- The export of each request carries `stockScope` (`all`, `eastman`, `cdec`): ship a restricted shop from its warehouse only.
- After you **publish stock** the portal also refreshes the held quantities of restricted shops (Admin tells you if that step fails; pressing Publish again repeats it).
- Admin → **Shop view** shows a shop with its own warehouse choice, exactly as the shop sees it.

### New season
Edit `currentSeasonCode` and `currentSeasonLabel` in `tools/portal-settings.json`, then export again.

### Requests and reservations (phase 2)
A shop picks quantities on the **Stock** page, reviews them under **My request** (delivery address of its choice, PO number,
requested ship date, notes) and sends. The request is checked and saved by a Cloud Function in one transaction:
- The items are **reserved for 7 days** (America/Toronto). Other shops then see the reduced availability, or "Reserved".
- The shop gets a confirmation email in its language; you get a copy (table, CSV and JSON attached) at your Gmail.
- Items with no price are accepted and flagged **price to be confirmed**; you price them on the invoice.
- Day 5: the shop gets a reminder. Day 7: the hold ends automatically (hourly job) and the items become available again.
- A shop can cancel its request from **History** (you get an email). You can, in Admin → **Requests**:
  **Extend 7 days**, **Release**, **Cancel**, or **Mark invoiced** (releases the hold; do it when the invoice exists in Excel and the stock was re-published).
- For assistants and scripts that process requests (customer matching, invoice lines, the order of operations), see [AUTOMATION-PLAYBOOK.md](AUTOMATION-PLAYBOOK.md).
- Download any request as JSON or CSV (format in [REQUESTS-SCHEMA.md](REQUESTS-SCHEMA.md)); **Download all open requests** gives one JSON file for your automations.
- Admin → **Shop view** shows exactly what a chosen shop or user sees (brands, prices, language, reservations).

### Catalogs and price lists (Documents)
- Shops have a **Documents** tab: catalogs (cover, title, season, *Open*) and price lists (*Download*), limited to **their brands** and **their region**.
- A shop's region is set in the shop editor (Admin → Shops → Edit → *Region*: Canada, USA or Other countries). Until you choose one it follows the
  currency (CAD = Canada, USD = USA, anything else = Other). Each document lists the regions that may see it, so a Canadian shop never learns that a USA price list exists.
- Covers: double-click [`tools/make-covers.bat`](tools/make-covers.bat). It writes `<catalog>.cover.jpg` next to every PDF in `Sharable info\Documents` (first page, about 30 KB; installs PyMuPDF on first run).
- Add a document: Admin → **Documents** → **Add a document**: title, brand, type (catalog or price list), season, regions, the file (up to 150 MB) and optionally the `.cover.jpg`.
  Replace a file by editing the document and choosing a new one; **Delete** removes the file and the entry.
- **Private documents (price lists, the default for that type):** no download link exists at all. The file stays in Cloud Storage that only you can read; when a
  shop presses **Download**, the `getDocument` Cloud Function checks that the user is active, has the brand and is in the document's region, then sends the file and logs it
  (Admin → Documents → *Recent downloads*). Limit: 7 MB per private file (price lists are about 100 KB). A shop can of course still forward the file it downloaded.
- **Catalogs (shared by link):** shops open a long unguessable download link, published only in the list for their brand and region. Someone given that link by a shop could open it.
  To withdraw a link, edit the document and choose the file again: the old file is deleted and the old link stops working.
- Switching a document between private and link needs the file chosen again (otherwise the old link would keep working).

### If emails do not arrive
- Admin → **Requests** → **Send me a test email** tells you why. A failed request also shows the reason on its **Emails** line, ending with the
  *shape* of the saved password (length and kinds of characters, never the characters).
- `535 Username and Password not accepted` = Gmail refuses the saved app password. It must be exactly the 16 lowercase letters Google showed
  (spaces optional) and created in the sender account. A saved value of another length means something else was pasted: at the
  `firebase functions:secrets:set` prompt **type the 16 letters, do not right-click** (that pastes the clipboard invisibly, often the command itself).
- After changing the secret, answer **Yes** when the tool offers to redeploy the functions; they only read the new value after that.

### If a functions deploy ever goes wrong
- A `package.json` saved with a hidden byte-order mark (BOM) makes Google's build fail with `invalid character '﻿'`. Re-save it as plain UTF-8.
- If a **first** deploy fails after creating the functions, later deploys only *update* them and skip the "public" permission, so browsers get
  `403 Forbidden` (check with a preflight request). Fix: `firebase functions:delete submitRequest updateRequest housekeeping --region us-central1 --force`, then deploy again.
- A function that is public but not signed-in must answer `401 "Please sign in."` to an anonymous call. A 403 from Google's front end means the permission is missing.
- Logs: `firebase functions:log --project m-dealer-portal`.

### Updating the site or the rules (order matters when the data model changes)
1. Commit and push the site files (GitHub Desktop) and wait for Pages to update.
2. Deploy rules and functions: `firebase deploy --only firestore,storage,functions --project m-dealer-portal`
   (`--dry-run` first checks them without releasing anything). `storage` is the Documents file store (Storage was set up once in the Firebase console, already done);
   `functions` adds `getDocument`, which serves private documents.
3. Admin page: publish the stock again; if shops show "not set", press **Give them SkiTrab** once.

## One-time setup (already done for this project unless noted)

1. **GitHub Pages:** repository Settings → Pages → *Deploy from a branch* → `main` / `/docs`.
2. **Firebase Authentication:** Sign-in method → Email/Password → enable **Email link (passwordless sign-in)**.
   Authorised domains must include `vvaraldi.github.io` (and `localhost` for local tests).
   Optional: Authentication → Templates → *Email address sign-in*: set the sender name and wording
   (Firebase localises the standard text for `fr` and `it`).
3. **Deploy the rules:** `firebase deploy --only firestore --project m-dealer-portal` (needs `firebase login`).
4. **Phase 2 emails and functions (once):**
   1. Google account → Security → 2-Step Verification must be on. Then <https://myaccount.google.com/apppasswords>: create an app password (name it "M portal").
   2. Store it as a secret (the password is typed into the prompt, never put in a file): `firebase functions:secrets:set GMAIL_APP_PASSWORD --project m-dealer-portal`
   3. Deploy: `firebase deploy --only firestore,functions --project m-dealer-portal` (the first deploy enables a few Google Cloud APIs and takes several minutes).
   4. Optional: set a budget alert in Google Cloud billing. The functions run only when a request is sent plus one hourly check, so the cost is expected to stay at cents.
5. **Export tool:** Python 3 with `openpyxl` (`run-export.bat` installs it on first run).
   Copy `tools/local-config.example.json` to `tools/local-config.json` and set the workbook path (the file is git-ignored).

## Repository layout

```
docs/                   the website (served by GitHub Pages)
  index.html            sign-in + stock page for shops
  admin.html            owner-only page: shops, users, stock upload
  assets/css|js|img|fonts   theme, code, logos, self-hosted fonts (no third-party requests except Google's Firebase SDK)
functions/              Cloud Functions (Node 22): submitRequest, updateRequest, housekeeping
  src/planner.js        the reservation rules as pure code (unit-tested, also used by the browser tests)
  src/emails.js         email texts (EN/FR/IT) and the request export format
  src/index.js          reads and writes Firestore in one transaction, sends the mail   (npm test in this folder)
tools/
  export_stock.py       reads the workbook (read-only) and writes tools/output/stock.json
  portal-settings.json  season, units, price tiers (safe to commit)
  run-export.bat        double-click launcher
  make_covers.py        cover image (first page) for every catalog PDF; launcher: make-covers.bat
firestore.rules, storage.rules   security rules      firebase.json, .firebaserc   Firebase config
```

## Privacy and security notes

- Sign-in is by emailed one-time link; only addresses invited by the admin can read anything.
- The Firebase web config in `docs/assets/js/firebase-config.js` is public by design. The API key should be restricted to the
  site's address in Google Cloud Console (APIs & Services → Credentials → HTTP referrers: `vvaraldi.github.io/*`).
- `docs/` pages send a Content-Security-Policy and `noindex`; fonts are hosted on the site itself.
- The admin address appears in `firestore.rules` and `docs/assets/js/firebase-config.js`; it is not a secret and grants nothing
  without control of that mailbox.

## Roadmap

1. **Phase 1 (this):** sign-in, shops and users, stock page, export + upload, per-shop and per-user brand access.
2. **Phase 2 (built):** quote requests that reserve stock for 7 days, emails, request management, shop view in Admin.
3. **Phase 3:** catalogs and price lists per brand and region (built); previous-season rebates (built); product images (to do).
4. **Phase 4:** automation (CDEC shipment email, invoice drafting, ledger).

Fonts: Source Sans 3 and Nunito Sans, SIL Open Font License (see `docs/assets/fonts/LICENSE-*.txt`).
