// Talks to the Open Food Facts API and turns its big, messy answers
// into the small, clean objects our frontend needs.

const BASE_URL = "https://in.openfoodfacts.org";

// Open Food Facts asks every app to identify itself
const USER_AGENT = process.env.OFF_USER_AGENT || "NutriSearch/1.0 (college project)";

// Only ask for the fields we use, so the answers stay small and fast
const SEARCH_FIELDS = "code,product_name,brands,quantity,nutriscore_grade,image_front_small_url";
const PRODUCT_FIELDS =
    "code,product_name,brands,quantity,countries,nutriscore_grade," +
    "image_front_url,ingredients_text,nutriments";


/* =========================
   Small in-memory cache
   Open Food Facts limits searches (about 10 per minute),
   so we remember answers for a while instead of asking again.
========================= */

const cache = new Map();
const MAX_CACHE_ITEMS = 200;

async function cached(key, ttlMs, loadFresh) {

    const hit = cache.get(key);

    if (hit && hit.expires > Date.now()) {
        return hit.value;
    }

    const value = await loadFresh();

    if (cache.size >= MAX_CACHE_ITEMS) {
        cache.delete(cache.keys().next().value);   // drop the oldest item
    }

    cache.set(key, { value, expires: Date.now() + ttlMs });
    return value;
}


/* =========================
   Calling the API
========================= */

async function getJson(url) {

    let response;

    try {
        response = await fetch(url, {
            headers: { "User-Agent": USER_AGENT },
            signal: AbortSignal.timeout(10000)
        });
    } catch (error) {
        const err = new Error("Could not reach Open Food Facts. Try again in a moment.");
        err.status = 502;
        throw err;
    }

    if (!response.ok) {
        const err = new Error("Open Food Facts returned an error (" + response.status + ").");
        err.status = response.status === 429 ? 429 : 502;
        throw err;
    }

    return response.json();
}


/* =========================
   Cleaning up the data
========================= */

// Nutri-Score is a letter a-e. Anything else means "unknown".
function cleanScore(grade) {
    const letter = String(grade || "").toLowerCase();
    return ["a", "b", "c", "d", "e"].includes(letter) ? letter : null;
}

function round(value) {
    return Math.round(value * 10) / 10;
}

// Split "Wheat flour (59%), Palm oil, Salt" into separate items,
// but do not split on commas that sit inside brackets.
function splitIngredients(text) {

    const items = [];
    let current = "";
    let depth = 0;

    for (const character of String(text || "")) {

        if (character === "(" || character === "[") depth++;
        if (character === ")" || character === "]") depth = Math.max(0, depth - 1);

        if ((character === "," || character === ";") && depth === 0) {
            items.push(current);
            current = "";
        } else {
            current += character;
        }
    }

    items.push(current);

    return items
        .map(function (item) { return item.replace(/_/g, "").trim(); })
        .filter(Boolean)
        .slice(0, 30);
}

// One product in the results list
function toSummary(product) {

    if (!product.code || !product.product_name) return null;

    return {
        code: product.code,
        name: product.product_name.trim(),
        brand: (product.brands || "").split(",")[0].trim(),
        size: product.quantity || "",
        score: cleanScore(product.nutriscore_grade),
        image: product.image_front_small_url || null
    };
}

// Nutrition table for the product page (per 100 g)
function buildNutrition(nutriments) {

    const rows = [
        { label: "Energy",        key: "energy-kcal_100g",   unit: "kcal" },
        { label: "Fat",           key: "fat_100g",           unit: "g" },
        { label: "Saturated fat", key: "saturated-fat_100g", unit: "g" },
        { label: "Carbohydrates", key: "carbohydrates_100g", unit: "g" },
        { label: "Sugars",        key: "sugars_100g",        unit: "g" },
        { label: "Fibre",         key: "fiber_100g",         unit: "g" },
        { label: "Protein",       key: "proteins_100g",      unit: "g" },
        { label: "Salt",          key: "salt_100g",          unit: "g" }
    ];

    return rows
        .filter(function (row) { return typeof nutriments[row.key] === "number"; })
        .map(function (row) {
            return { label: row.label, value: round(nutriments[row.key]), unit: row.unit };
        });
}

// Simple "traffic light" tags, using the UK food-label limits per 100 g.
// These are plain rules (no AI) and are only general guidance.
function buildHighlights(nutriments) {

    const values = {
        fat: nutriments["fat_100g"],
        saturates: nutriments["saturated-fat_100g"],
        sugars: nutriments["sugars_100g"],
        salt: nutriments["salt_100g"]
    };

    const rules = [
        { name: "fat",       label: "fat",           high: 17.5, low: 3.0 },
        { name: "saturates", label: "saturated fat", high: 5.0,  low: 1.5 },
        { name: "sugars",    label: "sugar",         high: 22.5, low: 5.0 },
        { name: "salt",      label: "salt",          high: 1.5,  low: 0.3 }
    ];

    const highlights = [];

    rules.forEach(function (rule) {
        const value = values[rule.name];

        if (typeof value !== "number") return;

        if (value > rule.high) {
            highlights.push({ text: "High " + rule.label, type: "warn" });
        } else if (value <= rule.low) {
            highlights.push({ text: "Low " + rule.label, type: "good" });
        }
    });

    return highlights;
}

// One product on the product page
function toDetail(product) {

    const nutriments = product.nutriments || {};

    return {
        code: product.code,
        name: (product.product_name || "Unnamed product").trim(),
        brand: (product.brands || "").split(",")[0].trim(),
        size: product.quantity || "",
        countries: product.countries || "",
        score: cleanScore(product.nutriscore_grade),
        image: product.image_front_url || null,
        ingredients: splitIngredients(product.ingredients_text),
        nutrition: buildNutrition(nutriments),
        highlights: buildHighlights(nutriments)
    };
}


/* =========================
   What the routes use
========================= */

async function searchProducts(query) {

    const key = "search:" + query.toLowerCase();

    return cached(key, 10 * 60 * 1000, async function () {

        const params = new URLSearchParams({
            search_terms: query,
            search_simple: "1",
            action: "process",
            json: "1",
            page_size: "24",
            fields: SEARCH_FIELDS,
            // The India subdomain still exposes the shared catalog, so scope
            // search results to products tagged as sold in India.
            tagtype_0: "countries",
            tag_contains_0: "contains",
            tag_0: "India"
        });

        const data = await getJson(BASE_URL + "/cgi/search.pl?" + params.toString());

        return (data.products || []).map(toSummary).filter(Boolean);
    });
}

async function getProduct(code) {

    return cached("product:" + code, 60 * 60 * 1000, async function () {

        const url = BASE_URL + "/api/v2/product/" + code + ".json?fields=" + PRODUCT_FIELDS;
        const data = await getJson(url);

        if (data.status !== 1 || !data.product) {
            const err = new Error("Product not found.");
            err.status = 404;
            throw err;
        }

        return toDetail(data.product);
    });
}

module.exports = { searchProducts, getProduct, splitIngredients };
