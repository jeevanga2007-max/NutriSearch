// Run with: npm test
// These tests use a fake Open Food Facts, so they work without internet.

const test = require("node:test");
const assert = require("node:assert");

const realFetch = global.fetch;
let offCalls = [];

// Fake Open Food Facts answers
global.fetch = async function (url, options) {

    if (!String(url).includes("openfoodfacts.org")) {
        return realFetch(url, options);       // our own server: pass through
    }

    offCalls.push(String(url));

    if (String(url).includes("/cgi/search.pl")) {
        return Response.json({
            products: [
                { code: "8901058000290", product_name: " Maggi 2-Minute Masala Noodles ", brands: "Maggi,Nestle",
                  quantity: "70 g", nutriscore_grade: "d", image_front_small_url: "https://img.example/maggi.jpg" },
                { code: "8901058851458", product_name: "Maggi Oats Noodles", brands: "Maggi",
                  quantity: "72 g", nutriscore_grade: "not-applicable" },
                { code: "111", product_name: "", brands: "No name" }          // should be skipped
            ]
        });
    }

    if (String(url).includes("/api/v2/product/8901058000290")) {
        return Response.json({
            status: 1,
            product: {
                code: "8901058000290",
                product_name: "Maggi 2-Minute Masala Noodles",
                brands: "Maggi",
                quantity: "70 g",
                countries: "India",
                nutriscore_grade: "d",
                ingredients_text: "Wheat flour (59%), Palm oil, Salt, Spices (turmeric, cumin), Sugar",
                nutriments: {
                    "energy-kcal_100g": 427, "fat_100g": 16.54, "saturated-fat_100g": 7.4,
                    "carbohydrates_100g": 60, "sugars_100g": 3.2, "proteins_100g": 9.3, "salt_100g": 2.8
                }
            }
        });
    }

    return Response.json({ status: 0 });      // product not found
};

const app = require("../server");
let server;
let base;

test.before(async function () {
    await new Promise(function (resolve) {
        server = app.listen(0, resolve);
    });
    base = "http://localhost:" + server.address().port;
});

test.after(function () {
    server.close();
});


test("search returns clean products and skips ones without a name", async function () {
    const res = await fetch(base + "/api/products/search?q=maggi");
    const body = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.count, 2);
    assert.deepStrictEqual(body.products[0], {
        code: "8901058000290",
        name: "Maggi 2-Minute Masala Noodles",
        brand: "Maggi",
        size: "70 g",
        score: "d",
        image: "https://img.example/maggi.jpg"
    });
    assert.strictEqual(body.products[1].score, null);   // "not-applicable" -> unknown
});

test("searching the same word twice only asks Open Food Facts once", async function () {
    offCalls = [];
    await fetch(base + "/api/products/search?q=noodles");
    await fetch(base + "/api/products/search?q=NOODLES");

    assert.strictEqual(offCalls.length, 1);
});

test("search rejects empty or too-short words", async function () {
    const res = await fetch(base + "/api/products/search?q=a");
    assert.strictEqual(res.status, 400);

    const res2 = await fetch(base + "/api/products/search");
    assert.strictEqual(res2.status, 400);
});

test("product detail returns ingredients, nutrition and highlights", async function () {
    const res = await fetch(base + "/api/products/8901058000290");
    const body = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.name, "Maggi 2-Minute Masala Noodles");
    assert.deepStrictEqual(body.ingredients,
        ["Wheat flour (59%)", "Palm oil", "Salt", "Spices (turmeric, cumin)", "Sugar"]);
    assert.deepStrictEqual(body.nutrition[1], { label: "Fat", value: 16.5, unit: "g" });

    const texts = body.highlights.map(function (h) { return h.text; });
    assert.ok(texts.includes("High saturated fat"));
    assert.ok(texts.includes("High salt"));
    assert.ok(texts.includes("Low sugar"));
});

test("an unknown barcode gives 404", async function () {
    const res = await fetch(base + "/api/products/99999999");
    assert.strictEqual(res.status, 404);
});

test("a barcode with letters is rejected", async function () {
    const res = await fetch(base + "/api/products/abc123");
    assert.strictEqual(res.status, 400);
});

test("unknown API addresses give a JSON 404", async function () {
    const res = await fetch(base + "/api/nothing");
    assert.strictEqual(res.status, 404);
    assert.deepStrictEqual(await res.json(), { error: "Not found." });
});
