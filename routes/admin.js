const express = require("express");
const { ObjectId } = require("mongodb");
const { currentUser, getUsers, publicUser, isDefaultAdmin } = require("../services/auth");
const { getCollection, getSuggestionsCollection } = require("../services/productDb");

const router = express.Router();

async function requireAdmin(req, res, next) {
    try {
        const user = await currentUser(req);
        if (!user) return res.status(401).json({ error: "Please log in." });
        if (!user.isAdmin) return res.status(403).json({ error: "Admin access required." });
        req.adminUser = user;
        next();
    } catch (error) {
        next(error);
    }
}

function requireOwnerAdmin(req, res, next) {
    if (!req.adminUser || !req.adminUser.isOwnerAdmin) {
        return res.status(403).json({ error: "Only the default admin can manage admin access." });
    }
    next();
}

router.use(requireAdmin);

// List user-submitted product suggestions (pending first, newest first)
router.get("/suggestions", async function (req, res, next) {
    try {
        const suggestions = await getSuggestionsCollection();
        const docs = await suggestions.find({}).sort({ submittedAt: -1 }).limit(100).toArray();
        const statusOrder = { pending: 0, approved: 1, rejected: 2 };
        docs.sort(function (a, b) {
            return (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3);
        });
        res.json({
            suggestions: docs.map(function (doc) {
                return {
                    id: String(doc._id),
                    code: doc.code,
                    name: doc.product_name,
                    brand: doc.brands || "",
                    size: doc.quantity || "",
                    ingredients: doc.ingredients_text || "",
                    energy: doc["energy-kcal_100g"] ?? null,
                    fat: doc["fat_100g"] ?? null,
                    sugars: doc["sugars_100g"] ?? null,
                    proteins: doc["proteins_100g"] ?? null,
                    salt: doc["salt_100g"] ?? null,
                    status: doc.status || "pending",
                    submittedBy: doc.submittedBy || "guest",
                    submittedAt: doc.submittedAt,
                    reviewedBy: doc.reviewedBy || null,
                    reviewedAt: doc.reviewedAt || null
                };
            })
        });
    } catch (error) {
        next(error);
    }
});

// Approve a suggested product and publish it to the products collection
router.post("/suggestions/:id/approve", async function (req, res, next) {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid suggestion ID." });

    try {
        const suggestions = await getSuggestionsCollection();
        const suggestion = await suggestions.findOne({ _id: new ObjectId(req.params.id) });
        if (!suggestion) return res.status(404).json({ error: "Suggestion not found." });
        if (suggestion.status !== "pending") return res.status(400).json({ error: "Suggestion has already been reviewed." });

        const products = await getCollection();
        const { _id, status, submittedBy, submittedAt, reviewedBy, reviewedAt, ...productDoc } = suggestion;
        productDoc.approvedBy = req.adminUser.email;
        productDoc.approvedAt = new Date();

        try {
            await products.insertOne(productDoc);
        } catch (error) {
            if (error.code === 11000) {
                return res.status(409).json({ error: "A product with this barcode already exists in the catalog." });
            }
            throw error;
        }

        await suggestions.updateOne(
            { _id: suggestion._id },
            { $set: { status: "approved", reviewedBy: req.adminUser.email, reviewedAt: new Date() } }
        );

        res.json({ ok: true, code: productDoc.code, status: "approved" });
    } catch (error) {
        next(error);
    }
});

// Reject a suggested product
router.post("/suggestions/:id/reject", async function (req, res, next) {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid suggestion ID." });

    try {
        const suggestions = await getSuggestionsCollection();
        const suggestion = await suggestions.findOne({ _id: new ObjectId(req.params.id) });
        if (!suggestion) return res.status(404).json({ error: "Suggestion not found." });
        if (suggestion.status !== "pending") return res.status(400).json({ error: "Suggestion has already been reviewed." });

        await suggestions.updateOne(
            { _id: suggestion._id },
            { $set: { status: "rejected", reviewedBy: req.adminUser.email, reviewedAt: new Date() } }
        );

        res.json({ ok: true, status: "rejected" });
    } catch (error) {
        next(error);
    }
});

// List users for admin access management (default admin only)
router.get("/users", requireOwnerAdmin, async function (req, res, next) {
    try {
        const users = await getUsers();
        const docs = await users
            .find({}, { projection: { name: 1, email: 1, authProviders: 1, isAdmin: 1, createdAt: 1 } })
            .sort({ createdAt: -1 })
            .toArray();

        const list = await Promise.all(docs.map(async function (doc) {
            const pub = await publicUser(doc);
            pub.createdAt = doc.createdAt || null;
            return pub;
        }));
        res.json({ users: list });
    } catch (error) {
        next(error);
    }
});

// Grant or revoke admin access for a user (default admin only)
router.patch("/users/:id/admin", requireOwnerAdmin, async function (req, res, next) {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid user ID." });
    if (typeof req.body.isAdmin !== "boolean") return res.status(400).json({ error: "isAdmin must be a boolean." });

    try {
        const users = await getUsers();
        const target = await users.findOne(
            { _id: new ObjectId(req.params.id) },
            { projection: { name: 1, email: 1, authProviders: 1, isAdmin: 1 } }
        );
        if (!target) return res.status(404).json({ error: "User not found." });
        if (isDefaultAdmin(target.email)) {
            return res.status(400).json({ error: "Default admin access cannot be changed." });
        }

        await users.updateOne({ _id: target._id }, { $set: { isAdmin: req.body.isAdmin } });
        target.isAdmin = req.body.isAdmin;
        res.json({ user: await publicUser(target) });
    } catch (error) {
        next(error);
    }
});

// Permanently delete a user account from MongoDB (default admin only)
router.delete("/users/:id", requireOwnerAdmin, async function (req, res, next) {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid user ID." });

    try {
        const users = await getUsers();
        const target = await users.findOne(
            { _id: new ObjectId(req.params.id) },
            { projection: { email: 1 } }
        );
        if (!target) return res.status(404).json({ error: "User not found." });
        if (isDefaultAdmin(target.email)) {
            return res.status(400).json({ error: "Default admin account cannot be deleted." });
        }

        await users.deleteOne({ _id: target._id });
        res.json({ ok: true, deletedId: String(target._id) });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
