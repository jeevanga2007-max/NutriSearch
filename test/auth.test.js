const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const { MongoClient, ObjectId } = require("mongodb");

// In-memory users collection for isolated auth tests
const store = [];
const fakeCollection = {
    async createIndex() {},
    async findOne(query, options) {
        const doc = store.find(function (item) {
            if (query._id) return String(item._id) === String(query._id);
            if (query.email) return item.email === query.email;
            if (query.googleId) return item.googleId === query.googleId;
            if (query.resetTokenHash) {
                const hashMatch = item.resetTokenHash === query.resetTokenHash;
                const notExpired = !query.resetTokenExpiresAt || (item.resetTokenExpiresAt && item.resetTokenExpiresAt > query.resetTokenExpiresAt.$gt);
                return hashMatch && notExpired;
            }
            return false;
        });
        if (!doc) return null;
        if (!options || !options.projection) return { ...doc };
        const projected = { _id: doc._id };
        for (const [k, v] of Object.entries(options.projection)) {
            if (v) projected[k] = doc[k];
        }
        return projected;
    },
    async insertOne(doc) {
        if (store.some(function (u) { return u.email === doc.email; })) {
            const err = new Error("Duplicate key");
            err.code = 11000;
            throw err;
        }
        const _id = new ObjectId();
        store.push({ ...doc, _id });
        return { insertedId: _id };
    },
    async updateOne(filter, update) {
        const doc = store.find(function (u) { return String(u._id) === String(filter._id); });
        if (!doc) return { matchedCount: 0 };
        if (update.$set) Object.assign(doc, update.$set);
        if (update.$unset) {
            for (const key of Object.keys(update.$unset)) delete doc[key];
        }
        if (update.$addToSet && update.$addToSet.authProviders) {
            const toAdd = update.$addToSet.authProviders.$each || [update.$addToSet.authProviders];
            doc.authProviders = Array.from(new Set([...(doc.authProviders || []), ...toAdd]));
        }
        return { matchedCount: 1 };
    }
};

MongoClient.prototype.connect = async function () {
    return this;
};
MongoClient.prototype.db = function () {
    return {
        collection() {
            return fakeCollection;
        }
    };
};

// Generate an RSA keypair for mocking Google ID tokens
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: "jwk" });
publicJwk.kid = "test-google-kid";

const realFetch = global.fetch;
global.fetch = async function (url, options) {
    if (String(url).startsWith("https://www.googleapis.com/oauth2/v3/certs")) {
        return Response.json({ keys: [publicJwk] });
    }
    return realFetch(url, options);
};

function makeGoogleJwt(claims) {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-google-kid" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
        iss: "https://accounts.google.com",
        aud: process.env.GOOGLE_CLIENT_ID,
        exp: Math.floor(Date.now() / 1000) + 3600,
        email_verified: true,
        ...claims
    })).toString("base64url");
    const sig = crypto.sign("RSA-SHA256", Buffer.from(header + "." + payload), privateKey).toString("base64url");
    return header + "." + payload + "." + sig;
}

const app = require("../server");
// Ensure tests use local dev resetUrl mode instead of external SMTP
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
let server;
let base;

test.before(async function () {
    await new Promise(function (resolve) {
        server = app.listen(0, resolve);
    });
    base = "http://localhost:" + server.address().port;
});

test.after(function () {
    server.close();
});

test("GET /api/auth/config returns googleClientId", async function () {
    const res = await fetch(base + "/api/auth/config");
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.googleClientId, process.env.GOOGLE_CLIENT_ID);
});

test("signup, login, me, update, and logout flow", async function () {
    const signupRes = await fetch(base + "/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Alice Test", email: "Alice@Example.com", password: "password123" })
    });
    assert.strictEqual(signupRes.status, 201);
    const signupBody = await signupRes.json();
    assert.strictEqual(signupBody.user.email, "alice@example.com");
    assert.deepStrictEqual(signupBody.user.authProviders, ["password"]);

    const cookie = signupRes.headers.get("set-cookie").split(";")[0];

    const meRes = await fetch(base + "/api/auth/me", { headers: { Cookie: cookie } });
    assert.strictEqual(meRes.status, 200);
    const meBody = await meRes.json();
    assert.strictEqual(meBody.user.name, "Alice Test");

    const patchRes = await fetch(base + "/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ name: "Alice Updated" })
    });
    assert.strictEqual(patchRes.status, 200);
    assert.strictEqual((await patchRes.json()).user.name, "Alice Updated");

    const loginRes = await fetch(base + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "alice@example.com", password: "password123" })
    });
    assert.strictEqual(loginRes.status, 200);

    const badLoginRes = await fetch(base + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "alice@example.com", password: "wrongpassword" })
    });
    assert.strictEqual(badLoginRes.status, 401);

    const logoutRes = await fetch(base + "/api/auth/logout", { method: "POST" });
    assert.strictEqual(logoutRes.status, 200);
});

test("Google signup creates new user and subsequent Google login reuses it", async function () {
    const credential = makeGoogleJwt({
        sub: "google-sub-123",
        email: "bob.google@example.com",
        name: "Bob Google"
    });

    const firstRes = await fetch(base + "/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential })
    });
    assert.strictEqual(firstRes.status, 201);
    const firstBody = await firstRes.json();
    assert.strictEqual(firstBody.isNewUser, true);
    assert.strictEqual(firstBody.user.email, "bob.google@example.com");
    assert.deepStrictEqual(firstBody.user.authProviders, ["google"]);

    const secondRes = await fetch(base + "/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential })
    });
    assert.strictEqual(secondRes.status, 200);
    const secondBody = await secondRes.json();
    assert.strictEqual(secondBody.isNewUser, false);
    assert.strictEqual(secondBody.user.id, firstBody.user.id);

    // Password login on Google-only account returns helpful message
    const pwRes = await fetch(base + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "bob.google@example.com", password: "anything123" })
    });
    assert.strictEqual(pwRes.status, 401);
    const pwBody = await pwRes.json();
    assert.ok(pwBody.error.includes("Google sign-in"));
});

test("forgot-password returns 404 when user does not exist", async function () {
    const res = await fetch(base + "/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "nobody@example.com" })
    });
    assert.strictEqual(res.status, 404);
    const body = await res.json();
    assert.strictEqual(body.error, "User Doesn't Exist,Create account");
});

test("forgot-password and reset-password flow updates password and invalidates token", async function () {
    const forgotRes = await fetch(base + "/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "alice@example.com" })
    });
    assert.strictEqual(forgotRes.status, 200);
    const forgotBody = await forgotRes.json();
    assert.ok(forgotBody.resetUrl);

    const token = new URL(forgotBody.resetUrl).searchParams.get("token");
    assert.ok(token);

    const badReset = await fetch(base + "/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "invalid-token", password: "newpassword123" })
    });
    assert.strictEqual(badReset.status, 400);

    const resetRes = await fetch(base + "/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: "newpassword123" })
    });
    assert.strictEqual(resetRes.status, 200);

    // Reusing the same token must fail
    const reuseRes = await fetch(base + "/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: "anotherpassword123" })
    });
    assert.strictEqual(reuseRes.status, 400);

    // Login with new password succeeds
    const loginRes = await fetch(base + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "alice@example.com", password: "newpassword123" })
    });
    assert.strictEqual(loginRes.status, 200);
});
