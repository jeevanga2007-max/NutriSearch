// /api/products routes

const express = require("express");
const { searchProducts, getProduct, addProduct } = require("../services/productDb");

const router = express.Router();


// GET /api/products/search?q=maggi
router.get("/search", async function (req, res, next) {

    const query = String(req.query.q || "").trim();

    if (query.length < 2 || query.length > 60) {
        return res.status(400).json({ error: "Type 2 to 60 characters to search." });
    }

    try {
        const products = await searchProducts(query);
        res.json({ query: query, count: products.length, products: products });
    } catch (error) {
        next(error);
    }
});


// GET /api/products/3017624010701
router.get("/:code", async function (req, res, next) {

    const code = req.params.code;

    // A barcode is only digits (8 to 14 of them)
    if (!/^\d{8,14}$/.test(code)) {
        return res.status(400).json({ error: "That does not look like a valid barcode." });
    }

    try {
        const product = await getProduct(code);
        res.json(product);
    } catch (error) {
        next(error);
    }
});

// POST /api/products   (add a product that is missing)
// Simple limit: 10 additions per hour per visitor
const addAttempts = new Map();

function tooManyAdds(ip) {
    const now = Date.now();
    const entry = addAttempts.get(ip);

    if (!entry || entry.resetAt < now) {
        addAttempts.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
        return false;
    }

    entry.count++;
    return entry.count > 10;
}

router.post("/", async function (req, res, next) {

    if (tooManyAdds(req.ip)) {
        return res.status(429).json({ error: "Too many products added. Try again later." });
    }

    try {
        const result = await addProduct(req.body || {});
        res.status(201).json(result);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
