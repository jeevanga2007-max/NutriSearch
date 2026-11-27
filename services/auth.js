const { MongoClient } = require("mongodb");
const { promisify } = require("node:util");
const crypto = require("node:crypto");

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = "nutrisearch_session";
const SESSION_AGE = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_ADMIN_EMAIL = "jeevanmr1542001@gmail.com";
let clientPromise;
let googleKeys;
let googleKeysFetchedAt = 0;

function getUsers() {
    if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not configured.");
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
    if (!clientPromise) {
        const client = new MongoClient(process.env.MONGODB_URI);
        clientPromise = client.connect().then(async function () {
            const users = client.db(process.env.MONGODB_DB || "nutriscan").collection("users");
            await users.createIndex({ email: 1 }, { unique: true });
            await users.createIndex({ googleId: 1 }, { unique: true, sparse: true });
            return users;
        }).catch(function (error) { clientPromise = null; throw error; });
    }
    return clientPromise;
}

function normalizeEmail(email) { return String(email || "").trim().toLowerCase(); }

function hashResetToken(token) {
    return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

async function sendPasswordResetEmail(toEmail, userName, resetUrl) {
    const smtpUser = String(process.env.SMTP_USER || "").trim();
    const smtpPass = process.env.SMTP_HOST
        ? String(process.env.SMTP_PASS || "")
        : String(process.env.SMTP_PASS || "").replace(/\s+/g, "");

    if (!smtpUser || !smtpPass) {
        console.log("Password reset link for " + toEmail + ": " + resetUrl);
        return { emailed: false };
    }

    const nodemailer = require("nodemailer");
    const transportConfig = process.env.SMTP_HOST
        ? {
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT || 587),
            secure: process.env.SMTP_SECURE === "true",
            auth: { user: smtpUser, pass: smtpPass }
        }
        : {
            service: "gmail",
            auth: { user: smtpUser, pass: smtpPass }
        };

    const transporter = nodemailer.createTransport(transportConfig);
    try {
        await transporter.sendMail({
            from: process.env.SMTP_FROM || smtpUser,
            to: toEmail,
            subject: "Reset your NutriSearch password",
            text: "Hi " + (userName || "there") + ",\n\nReset your NutriSearch password using this link (valid for 15 minutes):\n" + resetUrl + "\n\nIf you did not request this, you can ignore this email."
        });
        return { emailed: true };
    } catch (error) {
        if (error && error.code === "EAUTH" && process.env.NODE_ENV !== "production") {
            console.warn("SMTP authentication failed (EAUTH); falling back to local reset link:", resetUrl);
            return { emailed: false, smtpError: true };
        }
        throw error;
    }
}

async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const key = await scrypt(password, salt, 64);
    return salt + ":" + key.toString("hex");
}

async function verifyPassword(password, stored) {
    const [salt, hash] = String(stored || "").split(":");
    if (!salt || !hash) return false;
    const expected = Buffer.from(hash, "hex");
    const actual = await scrypt(password, salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function signSession(userId) {
    const payload = Buffer.from(JSON.stringify({ sub: String(userId), exp: Date.now() + SESSION_AGE })).toString("base64url");
    const signature = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url");
    return payload + "." + signature;
}

function verifySession(token) {
    if (!token || !process.env.SESSION_SECRET) return null;
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;
    const expected = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest();
    let actual;
    try { actual = Buffer.from(signature, "base64url"); } catch (_) { return null; }
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    try {
        const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        return session.exp > Date.now() ? session.sub : null;
    } catch (_) { return null; }
}

function sessionCookieOptions() {
    return { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_AGE };
}

function setSession(res, userId) { res.cookie(SESSION_COOKIE, signSession(userId), sessionCookieOptions()); }

async function getGoogleKeys() {
    if (googleKeys && Date.now() - googleKeysFetchedAt < 60 * 60 * 1000) return googleKeys;
    const response = await fetch("https://www.googleapis.com/oauth2/v3/certs");
    if (!response.ok) throw new Error("Google sign-in could not be verified.");
    googleKeys = await response.json();
    googleKeysFetchedAt = Date.now();
    return googleKeys;
}

async function verifyGoogleCredential(token) {
    if (!process.env.GOOGLE_CLIENT_ID) throw new Error("Google sign-in is not configured.");
    const parts = String(token || "").split(".");
    if (parts.length !== 3) throw new Error("Google sign-in failed. Try again.");
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (header.alg !== "RS256") throw new Error("Google sign-in failed. Try again.");
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    let keys = await getGoogleKeys();
    let jwk = keys.keys.find(function (key) { return key.kid === header.kid && key.kty === "RSA"; });
    if (!jwk) {
        googleKeysFetchedAt = 0;
        keys = await getGoogleKeys();
        jwk = keys.keys.find(function (key) { return key.kid === header.kid && key.kty === "RSA"; });
    }
    if (!jwk) throw new Error("Google sign-in failed. Try again.");
    const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
    const validSignature = crypto.verify("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]), publicKey, Buffer.from(parts[2], "base64url"));
    const issuerOk = ["accounts.google.com", "https://accounts.google.com"].includes(claims.iss);
    if (!validSignature || !issuerOk || claims.aud !== process.env.GOOGLE_CLIENT_ID || claims.exp * 1000 <= Date.now() || !claims.email_verified || !claims.email) {
        throw new Error("Google sign-in failed. Try again.");
    }
    return { googleId: claims.sub, email: normalizeEmail(claims.email), name: String(claims.name || claims.email).slice(0, 100) };
}

function isDefaultAdmin(email) {
    return normalizeEmail(email) === DEFAULT_ADMIN_EMAIL;
}

function isAdminUser(user) {
    return Boolean(user && (isDefaultAdmin(user.email) || user.isAdmin === true));
}

async function publicUser(user) {
    return {
        id: String(user._id),
        name: user.name,
        email: user.email,
        authProviders: Array.isArray(user.authProviders) ? user.authProviders : [],
        profile: user.profile || null,
        isAdmin: isAdminUser(user),
        isOwnerAdmin: isDefaultAdmin(user.email)
    };
}

async function currentUser(req) {
    const id = verifySession(req.cookies && req.cookies[SESSION_COOKIE]);
    if (!id) return null;
    const { ObjectId } = require("mongodb");
    if (!ObjectId.isValid(id)) return null;
    const user = await (await getUsers()).findOne({ _id: new ObjectId(id) }, { projection: { name: 1, email: 1, authProviders: 1, profile: 1, isAdmin: 1 } });
    return user ? publicUser(user) : null;
}

module.exports = { getUsers, normalizeEmail, hashPassword, verifyPassword, hashResetToken, sendPasswordResetEmail, setSession, SESSION_COOKIE, sessionCookieOptions, verifyGoogleCredential, DEFAULT_ADMIN_EMAIL, isDefaultAdmin, isAdminUser, publicUser, currentUser };
