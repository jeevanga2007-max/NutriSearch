# NutriSearch

NutriSearch searches its MongoDB `nutriscan.products` catalog and displays
product ingredients, nutrition facts, and highlights.

## Run the app

1. Install Node.js 20.19.0 or newer.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env` and set `MONGODB_URI` and a private `SESSION_SECRET` (generate one with `openssl rand -hex 32`). Set `GOOGLE_CLIENT_ID` to enable Google sign-in. To enable AI-assisted assessment selection, set `GEMINI_API_KEY` and `GEMINI_MODEL` to an available model that supports Interactions structured output; both are server-only and optional.
4. Start the server with `npm start` and open http://localhost:3000.

## Accounts and Google sign-in

Signup and login use the MongoDB `users` collection in `MONGODB_DB`. Passwords are stored as salted scrypt hashes, never as plain text. Successful login sets a signed, HTTP-only, same-site cookie that expires after seven days. Google sign-in verifies the credential signature and claims against Google's published keys; create an OAuth 2.0 Web client ID in Google Cloud Console and authorize the app's origin (for local development, `http://localhost:3000`), then put the client ID in `.env` as `GOOGLE_CLIENT_ID`.

The first account request creates the unique email and Google ID indexes. MongoDB must be running and reachable before signup or login. Keep `.env` private; do not commit real secrets or OAuth credentials.

Product search and details use MongoDB through `services/productDb.js`; the
Open Food Facts service is not the active product route. The optional importer
in `scripts/import_products.py` loads the dataset in `data/` into MongoDB and
requires `MONGODB_URI` plus Python packages `pandas`, `pymongo`, and
`python-dotenv`. The importer drops the existing products collection before
loading, so do not run it without an intentional catalog replacement and
backup.

## Personalization and assessment

The authenticated `GET /api/auth/me` response includes only the signed-in
account's public details and saved profile. `PATCH /api/auth/me` accepts a
`profile` object with optional `age`, `sex`, `height`, `weight`,
`activityLevel`, `goal`, `diet`, `focusOn`, and `allergies` fields. The server
validates and stores it on the account selected by the existing signed session
cookie; the browser cannot select another account.

`POST /api/products/:code/assessment` requires a signed-in account with a saved
at least one product-matching preference. The server loads the selected
product and related catalog products, applies deterministic nutrient,
diet-label, ingredient, allergen and trace checks, and returns factual reasons
plus alternatives. AI uses Google's Interactions API to generate a short
explanation grounded in selected verified reason IDs, prioritize those
reasons, and choose among server-screened product IDs. Unsupported
vocabulary/measurements, unknown reason IDs, and unsafe or medical wording
invalidate the AI output. The model cannot add product facts, change allergy
cautions, or select a conflicting/withheld product. If AI configuration or
the provider is unavailable, the deterministic assessment and alternatives
still work.

The Gemini request contains only server-generated assessment reasons and
screened candidate IDs/reasons, and uses `store: false`; it does not include
account identifiers or unnecessary profile fields. Select `GEMINI_MODEL` from
the models currently available to your Gemini API key.

Nutrition comparisons use per-100-g values when present: low sugar is at most
5 g, low fat at most 3 g, high protein at least 10 g, and low sodium at most
0.12 g sodium (or at most 0.3 g salt when sodium is absent). Values and units
are shown in the assessment. These thresholds are comparison rules, not a
medical recommendation. Missing information is treated as unknown; a possible
avoid-list match is a prominent caution, and absence of a text match is never
described as proof of safety.

Profile age, sex, height and weight are retained only for the profile form and
are not used for product matching or calorie/medical advice. Product data can
be incomplete and this feature provides general food information, not medical
advice. Existing MongoDB catalog documents will not gain category, diet-label,
allergen-tag or trace fields automatically; alternatives and assessments are
limited by the coverage of the loaded catalog.

## Project files

- `server.js` starts Express and serves `public/`.
- `routes/products.js` defines product search and detail API endpoints.
- `services/productDb.js` queries MongoDB product records and creates normalized summaries.
- `services/personalization.js` contains deterministic product checks and alternative screening.
- `services/aiAssessment.js` calls the optional Google Gemini Interactions API and validates ID selections.
- `public/` contains the website pages, styles, and browser script.
- `scripts/import_products.py` imports products from the local dataset.
- `test/products.test.js` contains the Node test suite.

Run the tests with `npm test`.
