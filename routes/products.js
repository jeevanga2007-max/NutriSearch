// /api/products routes

const express = require("express");
const { searchProducts, getProduct, getSimilarProducts, suggestProduct } = require("../services/productDb");
const { currentUser } = require("../services/auth");
const { assessProduct, rankAlternatives, hasProductPreferences } = require("../services/personalization");
const { getAiSelection } = require("../services/aiAssessment");

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

router.post("/:code/assessment", async function (req, res, next) {
    const code = req.params.code;
    if (!/^\d{8,14}$/.test(code)) {
        return res.status(400).json({ error: "That does not look like a valid barcode." });
    }

    try {
        const user = await currentUser(req);
        if (!user) return res.status(401).json({ error: "Please log in to personalize this product." });
        if (!user.profile || !hasProductPreferences(user.profile)) {
            return res.status(409).json({
                code: "PROFILE_REQUIRED",
                error: "Save personalization preferences on your profile to get a product assessment."
            });
        }

        const product = await getProduct(code);
        const candidates = await getSimilarProducts(code, product.assessmentFacts, 40);
        const assessment = assessProduct(product, user.profile);
        const ranked = rankAlternatives(product, candidates, user.profile, 8);
        const selection = await getAiSelection({
            status: assessment.status,
            reasons: assessment.reasons.map(function (reason) { return { id: reason.id, text: reason.text, kind: reason.kind }; }),
            candidates: ranked.eligible.map(function (candidate) {
                return {
                    id: candidate.product.code,
                    reasons: candidate.reasons.map(function (reason) { return { id: reason.id, text: reason.text }; })
                };
            }),
            maxRecommendations: 3
        });

        const selectedReasonIds = selection.available ? selection.selectedReasonIds : [];
        const reasonOrder = new Map(selectedReasonIds.map(function (id, index) { return [id, index]; }));
        const reasons = assessment.reasons.slice().sort(function (a, b) {
            const aPriority = a.kind === "caution" || a.kind === "unknown" ? 0 : 1;
            const bPriority = b.kind === "caution" || b.kind === "unknown" ? 0 : 1;
            return aPriority - bPriority ||
                (reasonOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (reasonOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER);
        });
        const eligibleById = new Map(ranked.eligible.map(function (candidate) { return [candidate.product.code, candidate]; }));
        const recommendationIds = selection.available && selection.alternatives.length
            ? selection.alternatives.map(function (alternative) { return alternative.productId; })
            : ranked.eligible.slice(0, 3).map(function (candidate) { return candidate.product.code; });
        const alternatives = recommendationIds.map(function (id) {
            const candidate = eligibleById.get(id);
            if (!candidate) return null;
            const item = candidate.product;
            const aiChoice = selection.available && selection.alternatives.find(function (alternative) {
                return alternative.productId === id;
            });
            const chosenReasons = new Set(aiChoice ? aiChoice.reasonIds : []);
            const candidateReasons = candidate.reasons.slice().sort(function (a, b) {
                return Number(chosenReasons.has(b.id)) - Number(chosenReasons.has(a.id));
            });
            return {
                code: item.code,
                name: item.name,
                brand: item.brand,
                size: item.size,
                score: item.score,
                image: item.image,
                status: candidate.status,
                reasons: candidateReasons.map(function (reason) { return reason.text; })
            };
        }).filter(Boolean);

        res.set("Cache-Control", "no-store");
        res.json({
            assessment: {
                status: assessment.status,
                allergyStatus: assessment.allergyStatus,
                reasons,
                cautions: assessment.cautions
            },
            ai: {
                available: selection.available,
                message: selection.available
                    ? "AI selected the most relevant verified facts and catalog alternatives."
                    : selection.reason,
                explanation: selection.explanation || ""
            },
            alternatives,
            withheldAlternativeCount: ranked.withheld.length,
            alternativesMessage: alternatives.length
                ? ""
                : "No sufficiently supported alternatives were found in this product category."
        });
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
        const user = await currentUser(req).catch(function () { return null; });
        const result = await suggestProduct(req.body || {}, user ? user.email : "guest");
        res.status(201).json(result);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
