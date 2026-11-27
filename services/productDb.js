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
let suggestionsPromise = null;

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

function getSuggestionsCollection() {
    if (!suggestionsPromise) {
        const client = new MongoClient(process.env.MONGODB_URI);
        suggestionsPromise = client.connect().then(function () {
            return client.db("nutriscan").collection("product_suggestions");
        });
        suggestionsPromise.catch(function () { suggestionsPromise = null; });
    }
    return suggestionsPromise;
}

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstBrand(brands) {
    return String(brands || "").split(",")[0].trim();
}

function stringList(value) {
    if (Array.isArray(value)) return value.map(function (item) { return String(item).trim(); }).filter(Boolean);
    if (typeof value === "string" && value.trim()) return value.split(",").map(function (item) { return item.trim(); }).filter(Boolean);
    return [];
}

function nutritionValue(doc, key) {
    if (doc[key] === undefined || doc[key] === null || doc[key] === "") return null;
    const value = Number(doc[key]);
    return Number.isFinite(value) && value >= 0 ? { value, unit: "g", basis: "per 100 g" } : null;
}

function assessmentFacts(doc) {
    return {
        category: String(doc.categories_en || "").trim() || null,
        categoryTags: stringList(doc.categories_tags),
        ingredientsText: String(doc.ingredients_text || "").trim() || null,
        allergens: String(doc.allergens || "").trim() || null,
        allergenTags: stringList(doc.allergens_tags),
        traces: String(doc.traces || "").trim() || null,
        traceTags: stringList(doc.traces_tags),
        dietLabels: stringList(doc.labels_tags),
        ingredientAnalysisTags: stringList(doc.ingredients_analysis_tags),
        nutrition: {
            sugars: nutritionValue(doc, "sugars_100g"),
            salt: nutritionValue(doc, "salt_100g"),
            sodium: nutritionValue(doc, "sodium_100g"),
            proteins: nutritionValue(doc, "proteins_100g"),
            fat: nutritionValue(doc, "fat_100g")
        }
    };
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
        name: String(doc.product_name || "Unnamed product").trim(),
        brand: firstBrand(doc.brands),
        size: doc.quantity || "",
        score: cleanScore(doc.nutriscore_grade),
        image: safeImage(doc.image_small_url),
        assessmentFacts: assessmentFacts(doc)
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
        summary: rating.summary,
        assessmentFacts: assessmentFacts(doc)
    };
}


/* =========================
   What the routes use
========================= */

async function searchProducts(query) {

    const col = await getCollection();
    const fields = { _id: 0, code: 1, product_name: 1, brands: 1, quantity: 1,
                     nutriscore_grade: 1, image_small_url: 1, categories_en: 1,
                     categories_tags: 1, ingredients_text: 1, allergens: 1,
                     allergens_tags: 1, traces: 1, traces_tags: 1, labels_tags: 1,
                     ingredients_analysis_tags: 1, "sugars_100g": 1, "salt_100g": 1,
                     "sodium_100g": 1, "proteins_100g": 1, "fat_100g": 1 };

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

    return docs.filter(function (doc) { return String(doc.product_name || "").trim(); }).map(toSummary);
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

async function getSimilarProducts(code, facts, limit) {
    const categoryTags = stringList(facts && facts.categoryTags);
    const category = String(facts && facts.category || "").trim();
    const categoryQuery = [];
    if (categoryTags.length) categoryQuery.push({ categories_tags: { $in: categoryTags } });
    if (category) categoryQuery.push({ categories_en: category });
    if (!categoryQuery.length) return [];

    const col = await getCollection();
    const docs = await col.find(
        { code: { $ne: code }, $or: categoryQuery },
        { projection: { _id: 0 } }
    ).limit(Math.min(Math.max(Number(limit) || 30, 1), 50)).toArray();
    return docs.map(toDetail);
}

function cleanText(value, max, label) {
    const text = String(value || "").trim();
    if (text.length > max) throw badRequest(label + " is too long (max " + max + " characters).");
    return text;
}

function validateNutritionFields(input, targetSet, targetUnset) {
    Object.keys(NUMBER_FIELDS).forEach(function (field) {
        if (input[field] === undefined) return;
        const rule = NUMBER_FIELDS[field];

        if (input[field] === "" || input[field] === null) {
            if (targetUnset) targetUnset[rule.key] = "";
            return;
        }

        const value = Number(input[field]);
        if (!Number.isFinite(value) || value < 0 || value > rule.max) {
            throw badRequest("Each nutrition value must be a number from 0 to " + rule.max + ".");
        }
        targetSet[rule.key] = value;
    });
}

function buildProductDoc(input) {
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

    validateNutritionFields(input, doc, null);

    return doc;
}

function toAdminProduct(doc) {
    return {
        id: doc._id ? String(doc._id) : "",
        code: doc.code,
        name: String(doc.product_name || "Unnamed product").trim(),
        brand: doc.brands || "",
        size: doc.quantity || "",
        ingredients: doc.ingredients_text || "",
        score: cleanScore(doc.nutriscore_grade),
        image: safeImage(doc.image_small_url || doc.image_url),
        energy: doc["energy-kcal_100g"] ?? null,
        fat: doc["fat_100g"] ?? null,
        saturatedFat: doc["saturated-fat_100g"] ?? null,
        carbohydrates: doc["carbohydrates_100g"] ?? null,
        sugars: doc["sugars_100g"] ?? null,
        fiber: doc["fiber_100g"] ?? null,
        proteins: doc["proteins_100g"] ?? null,
        salt: doc["salt_100g"] ?? null,
        source: doc.source || "",
        addedAt: doc.addedAt || null,
        updatedAt: doc.updatedAt || null,
        updatedBy: doc.updatedBy || null
    };
}

function applyOptionalText($set, $unset, rawValue, max, label, dbField) {
    if (rawValue === undefined) return;
    const text = cleanText(rawValue, max, label);
    if (text) $set[dbField] = text;
    else $unset[dbField] = "";
}

function buildProductUpdate(input) {
    const $set = {};
    const $unset = {};

    if (input.name !== undefined) {
        const name = cleanText(input.name, 100, "Product name");
        if (name.length < 2) throw badRequest("Please enter the product name.");
        $set.product_name = name;
    }

    applyOptionalText($set, $unset, input.brand, 60, "Brand", "brands");
    applyOptionalText($set, $unset, input.size, 30, "Pack size", "quantity");
    applyOptionalText($set, $unset, input.ingredients, 1500, "Ingredients", "ingredients_text");

    if (input.score !== undefined) {
        if (input.score === "" || input.score === null) {
            $unset.nutriscore_grade = "";
        } else {
            const grade = cleanScore(input.score);
            if (!grade) throw badRequest("Nutri-Score must be A, B, C, D, or E.");
            $set.nutriscore_grade = grade;
        }
    }

    if (input.image !== undefined) {
        const rawImg = cleanText(input.image, 500, "Photo URL");
        if (!rawImg) {
            $unset.image_url = "";
            $unset.image_small_url = "";
        } else {
            if (!/^https?:\/\/.+/i.test(rawImg)) {
                throw badRequest("Photo URL must start with http:// or https://.");
            }
            const normalized = safeImage(rawImg);
            $set.image_url = normalized;
            $set.image_small_url = normalized;
        }
    }

    validateNutritionFields(input, $set, $unset);

    return { $set, $unset };
}

async function suggestProduct(input, submittedBy) {
    const doc = buildProductDoc(input);
    const products = await getCollection();
    const suggestions = await getSuggestionsCollection();

    const existingProduct = await products.findOne({ code: doc.code }, { projection: { _id: 1 } });
    if (existingProduct) {
        const duplicate = new Error("A product with this barcode already exists.");
        duplicate.status = 409;
        throw duplicate;
    }

    const existingPending = await suggestions.findOne({ code: doc.code, status: "pending" }, { projection: { _id: 1 } });
    if (existingPending) {
        const duplicate = new Error("This product is already pending admin review.");
        duplicate.status = 409;
        throw duplicate;
    }

    const suggestion = {
        ...doc,
        status: "pending",
        submittedBy: submittedBy || "guest",
        submittedAt: new Date()
    };

    const result = await suggestions.insertOne(suggestion);
    return {
        id: String(result.insertedId),
        code: doc.code,
        status: "pending",
        message: "Product submitted for admin review."
    };
}

async function addProduct(input) {
    return suggestProduct(input);
}

module.exports = {
    searchProducts,
    getProduct,
    getSimilarProducts,
    addProduct,
    suggestProduct,
    getCollection,
    getSuggestionsCollection,
    escapeRegex,
    toAdminProduct,
    buildProductUpdate
};