// Reads products from our own MongoDB database and returns them
// in the same shape the website already expects.
const { MongoClient } = require("mongodb");
const { splitIngredients, buildNutrition, buildHighlights, cleanScore } = require("./openFoodFacts");

let collectionPromise = null;

function getCollection() {
    if (!collectionPromise) {
        const client = new MongoClient(process.env.MONGODB_URI);
        collectionPromise = client.connect().then(function () {
            return client.db("nutriscan").collection("products");
        });
        collectionPromise.catch(function () { collectionPromise = null; });
    }
    return collectionPromise;
}

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstBrand(brands) {
    return String(brands || "").split(",")[0].trim();
}

// The website only shows https images
function safeImage(url) {
    return url ? String(url).replace(/^http:\/\//, "https://") : null;
}

// One product in the results list
function toSummary(doc) {
    return {
        code: doc.code,
        name: String(doc.product_name).trim(),
        brand: firstBrand(doc.brands),
        size: doc.quantity || "",
        score: cleanScore(doc.nutriscore_grade),
        image: safeImage(doc.image_small_url)
    };
}

// One product on the product page
// (our document uses the same field names as the nutriments object,
//  so the old helper functions work on it directly)
function toDetail(doc) {
    return {
        code: doc.code,
        name: String(doc.product_name || "Unnamed product").trim(),
        brand: firstBrand(doc.brands),
        size: doc.quantity || "",
        countries: doc.countries_en || "",
        score: cleanScore(doc.nutriscore_grade),
        image: safeImage(doc.image_url || doc.image_small_url),
        ingredients: splitIngredients(doc.ingredients_text),
        nutrition: buildNutrition(doc),
        highlights: buildHighlights(doc)
    };
}

async function searchProducts(query) {
    const col = await getCollection();
    const fields = { _id: 0, code: 1, product_name: 1, brands: 1, quantity: 1,
                     nutriscore_grade: 1, image_small_url: 1 };

    // 1) whole-word search, best matches first
    let docs = await col
        .find({ $text: { $search: query } },
              { projection: { ...fields, score: { $meta: "textScore" } } })
        .sort({ score: { $meta: "textScore" } })
        .limit(24)
        .toArray();

    // 2) fallback for partial words ("mag" finds "maggi")
    if (docs.length === 0) {
        const rx = new RegExp(escapeRegex(query), "i");
        docs = await col
            .find({ $or: [{ product_name: rx }, { brands: rx }] }, { projection: fields })
            .limit(24)
            .toArray();
    }

    return docs.map(toSummary);
}

async function getProduct(code) {
    const col = await getCollection();
    const doc = await col.findOne({ code: code }, { projection: { _id: 0 } });

    if (!doc) {
        const error = new Error("Product not found.");
        error.status = 404;
        throw error;
    }
    return toDetail(doc);
}

module.exports = { searchProducts, getProduct };