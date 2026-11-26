const express = require("express");
const crypto = require("node:crypto");
const { getUsers, normalizeEmail, hashPassword, verifyPassword, hashResetToken, sendPasswordResetEmail, setSession, SESSION_COOKIE, sessionCookieOptions, verifyGoogleCredential, publicUser, currentUser } = require("../services/auth");

const router = express.Router();

router.get("/config", function (req, res) {
    res.set("Cache-Control", "no-store");
    res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null });
});

function authError(res, error) {
    if (error.code === 11000) return res.status(409).json({ error: "An account with that email already exists." });
    if (error.code === "EAUTH") return res.status(502).json({ error: "Email could not be sent: Gmail rejected SMTP_USER / SMTP_PASS. Use a 16-character Google App Password in .env." });
    if (error.message === "Google sign-in is not configured.") return res.status(503).json({ error: error.message });
    if (error.message === "MONGODB_URI is not configured." || error.message === "SESSION_SECRET must contain at least 32 characters.") {
        return res.status(503).json({ error: "Authentication is not configured. Set MONGODB_URI and a SESSION_SECRET of at least 32 characters." });
    }
    console.error("Authentication error:", error);
    res.status(500).json({ error: "Authentication is temporarily unavailable. Check the server configuration." });
}

function validateName(name) {
    const clean = String(name || "").trim();
    if (clean.length < 2 || clean.length > 100) return { error: "Enter a name between 2 and 100 characters." };
    return { value: clean };
}

function validateEmail(rawEmail) {
    const email = normalizeEmail(rawEmail);
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) return { error: "Enter a valid email address." };
    return { value: email };
}

function validatePassword(rawPassword) {
    const password = String(rawPassword || "");
    if (password.length < 8 || password.length > 256) return { error: "Password must be between 8 and 256 characters." };
    return { value: password };
}

router.post("/signup", async function (req, res) {
    const nameCheck = validateName(req.body.name);
    if (nameCheck.error) return res.status(400).json({ error: nameCheck.error });
    const emailCheck = validateEmail(req.body.email);
    if (emailCheck.error) return res.status(400).json({ error: emailCheck.error });
    const passwordCheck = validatePassword(req.body.password);
    if (passwordCheck.error) return res.status(400).json({ error: passwordCheck.error });

    try {
        const users = await getUsers();
        const existing = await users.findOne({ email: emailCheck.value });
        if (existing) return res.status(409).json({ error: "An account with that email already exists." });
        const user = {
            name: nameCheck.value,
            email: emailCheck.value,
            passwordHash: await hashPassword(passwordCheck.value),
            createdAt: new Date(),
            authProviders: ["password"]
        };
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
        if (!user) return res.status(401).json({ error: "Email or password is incorrect." });
        if (!user.passwordHash && Array.isArray(user.authProviders) && user.authProviders.includes("google")) {
            return res.status(401).json({ error: "This account uses Google sign-in. Click Continue with Google to log in." });
        }
        if (!await verifyPassword(password, user.passwordHash)) return res.status(401).json({ error: "Email or password is incorrect." });
        setSession(res, user._id);
        res.json({ user: await publicUser(user) });
    } catch (error) { authError(res, error); }
});

router.post("/google", async function (req, res) {
    try {
        const identity = await verifyGoogleCredential(req.body.credential);
        const users = await getUsers();
        let isNewUser = false;
        let user = await users.findOne({ googleId: identity.googleId });
        if (!user) {
            user = await users.findOne({ email: identity.email });
            if (user) {
                if (user.googleId && user.googleId !== identity.googleId) return res.status(409).json({ error: "This email is linked to another Google account." });
                await users.updateOne({ _id: user._id }, { $set: { googleId: identity.googleId }, $addToSet: { authProviders: "google" } });
                user.googleId = identity.googleId;
                user.authProviders = Array.from(new Set([...(user.authProviders || []), "google"]));
            } else {
                const newUser = { name: identity.name, email: identity.email, googleId: identity.googleId, authProviders: ["google"], createdAt: new Date() };
                const result = await users.insertOne(newUser);
                user = { ...newUser, _id: result.insertedId };
                isNewUser = true;
            }
        }
        setSession(res, user._id);
        res.status(isNewUser ? 201 : 200).json({ user: await publicUser(user), isNewUser });
    } catch (error) { authError(res, error); }
});

router.get("/me", async function (req, res) {
    try {
        const user = await currentUser(req);
        if (!user) return res.status(401).json({ error: "Please log in." });
        res.json({ user });
    } catch (error) { authError(res, error); }
});

router.patch("/me", async function (req, res) {
    try {
        const user = await currentUser(req);
        if (!user) return res.status(401).json({ error: "Please log in." });

        const updates = {};
        if (req.body.name !== undefined) {
            const nameCheck = validateName(req.body.name);
            if (nameCheck.error) return res.status(400).json({ error: nameCheck.error });
            updates.name = nameCheck.value;
        }
        if (req.body.email !== undefined) {
            const emailCheck = validateEmail(req.body.email);
            if (emailCheck.error) return res.status(400).json({ error: emailCheck.error });
            updates.email = emailCheck.value;
        }

        const addProviders = [];
        if (req.body.password) {
            const passwordCheck = validatePassword(req.body.password);
            if (passwordCheck.error) return res.status(400).json({ error: passwordCheck.error });
            updates.passwordHash = await hashPassword(passwordCheck.value);
            addProviders.push("password");
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: "No changes provided." });
        }

        const { ObjectId } = require("mongodb");
        const users = await getUsers();
        const updateDoc = { $set: updates };
        if (addProviders.length > 0) updateDoc.$addToSet = { authProviders: { $each: addProviders } };

        await users.updateOne({ _id: new ObjectId(user.id) }, updateDoc);
        const updated = await users.findOne({ _id: new ObjectId(user.id) }, { projection: { name: 1, email: 1, authProviders: 1 } });
        res.json({ user: await publicUser(updated) });
    } catch (error) { authError(res, error); }
});

router.post("/forgot-password", async function (req, res) {
    const emailCheck = validateEmail(req.body.email);
    if (emailCheck.error) return res.status(400).json({ error: emailCheck.error });

    try {
        const users = await getUsers();
        const user = await users.findOne({ email: emailCheck.value });
        if (!user) {
            return res.status(404).json({ error: "User Doesn't Exist,Create account" });
        }

        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        await users.updateOne(
            { _id: user._id },
            { $set: { resetTokenHash: hashResetToken(token), resetTokenExpiresAt: expiresAt } }
        );

        const resetUrl = req.protocol + "://" + req.get("host") + "/reset-password.html?token=" + token;
        const delivery = await sendPasswordResetEmail(user.email, user.name, resetUrl);

        if (delivery.emailed) {
            return res.json({ message: "Password reset link sent to your email." });
        }

        const response = {
            message: delivery.smtpError
                ? "Email delivery failed (check Gmail App Password in .env), so use this reset link:"
                : "Reset link created. Click here to reset your password:"
        };
        if (process.env.NODE_ENV !== "production") {
            response.resetUrl = resetUrl;
        }
        res.json(response);
    } catch (error) { authError(res, error); }
});

router.post("/reset-password", async function (req, res) {
    const token = String(req.body.token || "").trim();
    if (!token) return res.status(400).json({ error: "Reset token is missing." });

    const passwordCheck = validatePassword(req.body.password);
    if (passwordCheck.error) return res.status(400).json({ error: passwordCheck.error });

    try {
        const users = await getUsers();
        const user = await users.findOne({
            resetTokenHash: hashResetToken(token),
            resetTokenExpiresAt: { $gt: new Date() }
        });

        if (!user) {
            return res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });
        }

        await users.updateOne(
            { _id: user._id },
            {
                $set: { passwordHash: await hashPassword(passwordCheck.value) },
                $addToSet: { authProviders: "password" },
                $unset: { resetTokenHash: "", resetTokenExpiresAt: "" }
            }
        );

        res.json({ message: "Password updated. You can now log in." });
    } catch (error) { authError(res, error); }
});

router.post("/logout", function (req, res) {
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
    res.json({ ok: true });
});

module.exports = router;
