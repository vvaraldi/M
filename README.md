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
| `stock/*` (lines, no prices, no location) | admin and any invited, active user |
| `prices/<TIER>` e.g. `SHOP_CAD` | admin, and only users whose invitation names that tier |
| `admin/*` (warehouse locations) | admin only |
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
Demo, Old graphics and Defect items also show "Price on request" until clearance pricing is added (phase 3).

### Add or change a shop
Admin page → **Shops**: name, currency, price type (Shop / Retail / Export), language, up to 3 addresses,
and the email addresses allowed to sign in. Save, then press **Send sign-in email** next to each address.
A shop can have several users; each user keeps their own language choice.

### New season
Edit `currentSeasonCode` and `currentSeasonLabel` in `tools/portal-settings.json`, then export again.

## One-time setup (already done for this project unless noted)

1. **GitHub Pages:** repository Settings → Pages → *Deploy from a branch* → `main` / `/docs`.
2. **Firebase Authentication:** Sign-in method → Email/Password → enable **Email link (passwordless sign-in)**.
   Authorised domains must include `vvaraldi.github.io` (and `localhost` for local tests).
   Optional: Authentication → Templates → *Email address sign-in*: set the sender name and wording
   (Firebase localises the standard text for `fr` and `it`).
3. **Deploy the rules:** `firebase deploy --only firestore --project m-dealer-portal` (needs `firebase login`).
4. **Export tool:** Python 3 with `openpyxl` (`run-export.bat` installs it on first run).
   Copy `tools/local-config.example.json` to `tools/local-config.json` and set the workbook path (the file is git-ignored).

## Repository layout

```
docs/                   the website (served by GitHub Pages)
  index.html            sign-in + stock page for shops
  admin.html            owner-only page: shops, users, stock upload
  assets/css|js|img|fonts   theme, code, logos, self-hosted fonts (no third-party requests except Google's Firebase SDK)
tools/
  export_stock.py       reads the workbook (read-only) and writes tools/output/stock.json
  portal-settings.json  season, units, price tiers (safe to commit)
  run-export.bat        double-click launcher
firestore.rules         security rules      firebase.json, .firebaserc   Firebase config
```

## Privacy and security notes

- Sign-in is by emailed one-time link; only addresses invited by the admin can read anything.
- The Firebase web config in `docs/assets/js/firebase-config.js` is public by design. The API key should be restricted to the
  site's address in Google Cloud Console (APIs & Services → Credentials → HTTP referrers: `vvaraldi.github.io/*`).
- `docs/` pages send a Content-Security-Policy and `noindex`; fonts are hosted on the site itself.
- The admin address appears in `firestore.rules` and `docs/assets/js/firebase-config.js`; it is not a secret and grants nothing
  without control of that mailbox.

## Roadmap

1. **Phase 1 (this):** sign-in, shops and users, stock page, export + upload.
2. **Phase 2:** quote requests that reserve stock for 7 days, emails, request management.
3. **Phase 3:** price lists and catalogs per currency, product images, clearance pricing.
4. **Phase 4:** automation (CDEC shipment email, invoice drafting, ledger).

Fonts: Source Sans 3 and Nunito Sans, SIL Open Font License (see `docs/assets/fonts/LICENSE-*.txt`).
