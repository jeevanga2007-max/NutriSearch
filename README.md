# NutriSearch

NutriSearch searches food products using the Open Food Facts API and displays
product ingredients, nutrition facts, and highlights.

## Run the app

1. Install Node.js 20.19.0 or newer.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env` and set `MONGODB_URI` and a private `SESSION_SECRET` (generate one with `openssl rand -hex 32`). Set `GOOGLE_CLIENT_ID` to enable Google sign-in.
4. Start the server with `npm start` and open http://localhost:3000.

## Accounts and Google sign-in

Signup and login use the MongoDB `users` collection in `MONGODB_DB`. Passwords are stored as salted scrypt hashes, never as plain text. Successful login sets a signed, HTTP-only, same-site cookie that expires after seven days. Google sign-in verifies the credential signature and claims against Google's published keys; create an OAuth 2.0 Web client ID in Google Cloud Console and authorize the app's origin (for local development, `http://localhost:3000`), then put the client ID in `.env` as `GOOGLE_CLIENT_ID`.

The first account request creates the unique email and Google ID indexes. MongoDB must be running and reachable before signup or login. Keep `.env` private; do not commit real secrets or OAuth credentials.

The API uses Open Food Facts directly. The optional importer in
`scripts/import_products.py` loads the dataset in `data/` into MongoDB and
requires `MONGODB_URI` plus Python packages `pandas`, `pymongo`, and `python-dotenv`.

## Project files

- `server.js` starts Express and serves `public/`.
- `routes/products.js` defines product search and detail API endpoints.
- `services/openFoodFacts.js` fetches and formats API results.
- `services/productDb.js` provides optional MongoDB product queries.
- `public/` contains the website pages, styles, and browser script.
- `scripts/import_products.py` imports products from the local dataset.
- `test/products.test.js` contains the Node test suite.

Run the tests with `npm test`.
