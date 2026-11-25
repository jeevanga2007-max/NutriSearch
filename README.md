# NutriSearch

NutriSearch searches food products using the Open Food Facts API and displays
product ingredients, nutrition facts, and highlights.

## Run the app

1. Install Node.js 18 or newer.
2. Install dependencies with `npm install`.
3. Optionally copy `.env.example` to `.env` and set `OFF_USER_AGENT`.
4. Start the server with `npm start` and open http://localhost:3000.

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
