const express = require("express");
const { getUsers, normalizeEmail, hashPassword, verifyPassword, setSession, SESSION_COOKIE, sessionCookieOptions, verifyGoogleCredential, publicUser, currentUser } = require("../services/auth");

const router = express.Router();

router.get("/config", function (req, res) {
    res.set("Cache-Control", "no-store");
    res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null });
});

function authError(res, error) {
    if (error.code === 11000) return res.status(409).json({ error: "An account with that email already exists." });
    if (error.message === "Google sign-in is not configured.") return res.status(503).json({ error: error.message });
    if (error.message === "MONGODB_URI is not configured." || error.message === "SESSION_SECRET must contain at least 32 characters.") {
        return res.status(503).json({ error: "Authentication is not configured. Set MONGODB_URI and a SESSION_SECRET of at least 32 characters." });
    }
    console.error("Authentication error:", error);
    res.status(500).json({ error: "Authentication is temporarily unavailable. Check the server configuration." });
}

router.post("/signup", async function (req, res) {
    const name = String(req.body.name || "").trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    if (name.length < 2 || name.length > 100) return res.status(400).json({ error: "Enter a name between 2 and 100 characters." });
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) return res.status(400).json({ error: "Enter a valid email address." });
    if (password.length < 8 || password.length > 256) return res.status(400).json({ error: "Password must be between 8 and 256 characters." });
    try {
        const users = await getUsers();
        const existing = await users.findOne({ email });
        if (existing) return res.status(409).json({ error: "An account with that email already exists." });
        const user = { name, email, passwordHash: await hashPassword(password), createdAt: new Date(), authProviders: ["password"] };
        const result = await users.insertOne(user);
        setSession(res, result.insertedId);
        res.status(201).json({ user: await publicUser({ ...user, _id: result.insertedId }) });
    } catch (error) { authError(res, error); }
});

router.post("/login", async function (req, res) {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    try {
        const user = await (await getUsers()).findOne({ email });
        if (!user || !await verifyPassword(password, user.passwordHash)) return res.status(401).json({ error: "Email or password is incorrect." });
        setSession(res, user._id);
        res.json({ user: await publicUser(user) });
    } catch (error) { authError(res, error); }
});

router.post("/google", async function (req, res) {
    try {
        const identity = await verifyGoogleCredential(req.body.credential);
        const users = await getUsers();
        let user = await users.findOne({ googleId: identity.googleId });
        if (!user) {
            user = await users.findOne({ email: identity.email });
            if (user) {
                if (user.googleId && user.googleId !== identity.googleId) return res.status(409).json({ error: "This email is linked to another Google account." });
                await users.updateOne({ _id: user._id }, { $set: { googleId: identity.googleId }, $addToSet: { authProviders: "google" } });
                user.googleId = identity.googleId;
            } else {
                const newUser = { name: identity.name, email: identity.email, googleId: identity.googleId, authProviders: ["google"], createdAt: new Date() };
                const result = await users.insertOne(newUser);
                user = { ...newUser, _id: result.insertedId };
            }
        }
        setSession(res, user._id);
        res.json({ user: await publicUser(user) });
    } catch (error) { authError(res, error); }
});

router.get("/me", async function (req, res) {
    try {
        const user = await currentUser(req);
        if (!user) return res.status(401).json({ error: "Please log in." });
        res.json({ user });
    } catch (error) { authError(res, error); }
});

router.post("/logout", function (req, res) {
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
    res.json({ ok: true });
});

module.exports = router;
