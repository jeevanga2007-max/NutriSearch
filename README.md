# NutriSearch

Search a food product or brand, pick the one you have, and see its ingredients,
nutrition and quick highlights. Data comes from [Open Food Facts](https://world.openfoodfacts.org).

## Run it

1. Install Node.js 18 or newer (check with `node -v`).
2. In this folder run:

       npm install
       copy .env.example .env      (Mac/Linux: cp .env.example .env)
       npm start

3. Open **http://localhost:3000** in your browser.
   (Do not double-click the HTML files. The pages need the server.)

Edit `.env` and put your project name and email in `OFF_USER_AGENT`.
Open Food Facts asks every app to identify itself.

## Folders

    server.js                    starts Express, serves /public, mounts the routes
    routes/products.js           the two API addresses (search, product)
    services/openFoodFacts.js    calls Open Food Facts, cleans the data, caches answers
    public/                      the website: HTML, style.css, script.js
    test/products.test.js        automated tests (npm test)

## API

    GET /api/products/search?q=maggi    -> { query, count, products: [ {code, name, brand, size, score, image} ] }
    GET /api/products/8901058000290     -> { code, name, brand, size, countries, score, image,
                                             ingredients[], nutrition[], highlights[] }

Errors always look like `{ "error": "message" }`.

## Tests

    npm test

The tests use a fake Open Food Facts, so they run without internet.

## Next steps

1. MongoDB + sign up / login (bcrypt, JWT)
2. Profile page saved per user (age, height, weight, goal, diet, allergies)
3. Saved products per user
4. AI summary on the product page (Gemini or Claude API, called only from the server)
5. Deploy to Render (add the .env values in Render's dashboard)
