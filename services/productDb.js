// Reads and writes products in our own MongoDB database and returns them
// in the shape the website expects.
const { MongoClient } = require("mongodb");
const { splitIngredients, buildNutrition, cleanScore } = require("./helpers");
const { analyse } = require("./rating");

// Form field name -> database key, with the largest value we accept (per 100 g)
const NUMBER_FIELDS = {
    energy:        { key: "energy-kcal_100g",   max: 900 },
    fat:           { key: "fat_100g",           max: 100 },
    saturatedFat:  { key: "saturated-fat_100g", max: 100 },
    carbohydrates: { key: "carbohydrates_100g", max: 100 },
    sugars:        { key: "sugars_100g",        max: 100 },
    fiber:         { key: "fiber_100g",         max: 100 },
    proteins:      { key: "proteins_100g",      max: 100 },
    salt:          { key: "salt_100g",          max: 100 }
};

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

function badRequest(message) {
    const error = new Error(message);
    error.status = 400;
    return error;
}


/* =========================
   Shaping data for the website
========================= */

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

function toDetail(doc) {

    const rating = analyse(doc);

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
        highlights: rating.highlights,
        summary: rating.summary
    };
}


/* =========================
   What the routes use
========================= */

async function searchProducts(query) {

    const col = await getCollection();
    const fields = { _id: 0, code: 1, product_name: 1, brands: 1, quantity: 1,
                     nutriscore_grade: 1, image_small_url: 1 };

    // 1) whole-word search, best matches first
    let docs = [];
    try {
        docs = await col
            .find({ $text: { $search: query } },
                  { projection: { ...fields, score: { $meta: "textScore" } } })
            .sort({ score: { $meta: "textScore" } })
            .limit(24)
            .toArray();
    } catch (error) {
        if (error.code !== 27) throw error;     // 27 = text index missing
    }

    // 2) partial words ("mag" finds "maggi")
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

function cleanText(value, max, label) {
    const text = String(value || "").trim();
    if (text.length > max) throw badRequest(label + " is too long (max " + max + " characters).");
    return text;
}

async function addProduct(input) {

    const code = String(input.code || "").trim();
    if (!/^\d{8,14}$/.test(code)) throw badRequest("Barcode must be 8 to 14 digits.");

    const name = cleanText(input.name, 100, "Product name");
    if (name.length < 2) throw badRequest("Please enter the product name.");

    const doc = { code: code, product_name: name, source: "user", addedAt: new Date() };

    const brand = cleanText(input.brand, 60, "Brand");
    const size = cleanText(input.size, 30, "Pack size");
    const ingredients = cleanText(input.ingredients, 1500, "Ingredients");

    if (brand) doc.brands = brand;
    if (size) doc.quantity = size;
    if (ingredients) doc.ingredients_text = ingredients;

    Object.keys(NUMBER_FIELDS).forEach(function (field) {
        if (input[field] === undefined || input[field] === "") return;

        const rule = NUMBER_FIELDS[field];
        const value = Number(input[field]);

        if (!Number.isFinite(value) || value < 0 || value > rule.max) {
            throw badRequest("Each nutrition value must be a number from 0 to " + rule.max + ".");
        }
        doc[rule.key] = value;
    });

    const col = await getCollection();

    try {
        await col.insertOne(doc);
    } catch (error) {
        if (error.code === 11000) {                  // duplicate barcode
            const duplicate = new Error("A product with this barcode already exists.");
            duplicate.status = 409;
            throw duplicate;
        }
        throw error;
    }

    return { code: code };
}

module.exports = { searchProducts, getProduct, addProduct };