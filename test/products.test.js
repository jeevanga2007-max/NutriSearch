// Run with: npm test
// Product API tests use an in-memory MongoDB collection.

const test = require("node:test");
const assert = require("node:assert/strict");
const { MongoClient } = require("mongodb");

process.env.MONGODB_URI = "mongodb://127.0.0.1:27017";
process.env.SESSION_SECRET = "test-session-secret-with-more-than-32-characters";

const products = [
    {
        code: "8901058000290",
        product_name: " Maggi 2-Minute Masala Noodles ",
        brands: "Maggi,Nestle",
        quantity: "70 g",
        categories_en: "Noodles",
        categories_tags: ["en:noodles"],
        nutriscore_grade: "d",
        image_small_url: "https://img.example/maggi.jpg",
        ingredients_text: "Wheat flour (59%), Palm oil, Salt, Spices (turmeric, cumin), Sugar",
        allergens: "Wheat",
        allergens_tags: ["en:wheat"],
        traces: "May contain soy",
        traces_tags: ["en:soy"],
        ingredients_analysis_tags: ["en:vegan"],
        "energy-kcal_100g": 427,
        "fat_100g": 16.54,
        "saturated-fat_100g": 7.4,
        "carbohydrates_100g": 60,
        "sugars_100g": 3.2,
        "proteins_100g": 9.3,
        "salt_100g": 2.8
    },
    {
        code: "8901058851458",
        product_name: "Maggi Oats Noodles",
        brands: "Maggi",
        quantity: "72 g",
        categories_en: "Noodles",
        categories_tags: ["en:noodles"],
        nutriscore_grade: "not-applicable"
    },
    { code: "111", product_name: "", brands: "No name" }
];

function matches(doc, query) {
    if (!query) return true;
    if (query.$text) {
        const words = query.$text.$search.toLowerCase().split(/\s+/);
        const text = (doc.product_name + " " + (doc.brands || "")).toLowerCase();
        return words.every(function (word) { return text.includes(word); });
    }
    if (query.$or) return query.$or.some(function (clause) { return matches(doc, clause); });
    return Object.entries(query).every(function ([key, value]) {
        if (key === "code" && value && value.$ne) return doc.code !== value.$ne;
        if (value instanceof RegExp) return value.test(String(doc[key] || ""));
        return doc[key] === value;
    });
}

function projected(doc, projection) {
    if (!projection) return { ...doc };
    if (!Object.values(projection).some(Boolean)) return { ...doc };
    const result = {};
    for (const [key, include] of Object.entries(projection)) {
        if (include && key !== "_id" && key !== "score" && doc[key] !== undefined) result[key] = doc[key];
    }
    return result;
}

const collection = {
    find(query, options) {
        let rows = products.filter(function (item) { return matches(item, query); })
            .map(function (item) { return projected(item, options && options.projection); });
        return {
            sort() { return this; },
            limit(count) { rows = rows.slice(0, count); return this; },
            async toArray() { return rows; }
        };
    },
    async findOne(query, options) {
        const doc = products.find(function (item) { return matches(item, query); });
        return doc ? projected(doc, options && options.projection) : null;
    }
};

MongoClient.prototype.connect = async function () { return this; };
MongoClient.prototype.db = function () {
    return { collection: function () { return collection; } };
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

test("search returns normalized catalog products and skips products without a name", async function () {
    const res = await fetch(base + "/api/products/search?q=maggi");
    const body = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.count, 2);
    assert.strictEqual(body.products[0].name, "Maggi 2-Minute Masala Noodles");
    assert.strictEqual(body.products[0].brand, "Maggi");
    assert.strictEqual(body.products[0].assessmentFacts.category, "Noodles");
    assert.deepStrictEqual(body.products[0].assessmentFacts.nutrition.sugars, {
        value: 3.2,
        unit: "g",
        basis: "per 100 g"
    });
    assert.strictEqual(body.products[1].score, null);
});

test("search rejects empty or too-short words", async function () {
    const res = await fetch(base + "/api/products/search?q=a");
    assert.strictEqual(res.status, 400);

    const res2 = await fetch(base + "/api/products/search");
    assert.strictEqual(res2.status, 400);
});

test("product detail returns ingredients, nutrition, and assessment fields", async function () {
    const res = await fetch(base + "/api/products/8901058000290");
    const body = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.name, "Maggi 2-Minute Masala Noodles");
    assert.deepStrictEqual(body.ingredients,
        ["Wheat flour (59%)", "Palm oil", "Salt", "Spices (turmeric, cumin)", "Sugar"]);
    assert.deepStrictEqual(body.nutrition[1], { label: "Fat", value: 16.5, unit: "g" });
    assert.strictEqual(body.assessmentFacts.allergens, "Wheat");
    assert.deepStrictEqual(body.assessmentFacts.traceTags, ["en:soy"]);

    const texts = body.highlights.map(function (highlight) { return highlight.text; });
    assert.ok(texts.includes("High saturated fat"));
    assert.ok(texts.includes("High salt"));
    assert.ok(texts.includes("Low sugar"));
});

test("product assessment requires the existing signed-in session", async function () {
    const res = await fetch(base + "/api/products/8901058000290/assessment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
    });
    assert.strictEqual(res.status, 401);
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
