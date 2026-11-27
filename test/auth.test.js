const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const { MongoClient, ObjectId } = require("mongodb");

// In-memory collections for isolated auth + admin tests
function makeCollection(uniqueFields) {
    const items = [];
    function matches(item, query) {
        for (const [k, v] of Object.entries(query || {})) {
            if (k === "_id") {
                if (String(item._id) !== String(v)) return false;
            } else if (k === "resetTokenExpiresAt" && v && v.$gt) {
                if (!item.resetTokenExpiresAt || item.resetTokenExpiresAt <= v.$gt) return false;
            } else if (item[k] !== v) {
                return false;
            }
        }
        return true;
    }
    return {
        items,
        async createIndex() {},
        async findOne(query, options) {
            const doc = items.find(function (item) { return matches(item, query); });
            if (!doc) return null;
            if (!options || !options.projection) return { ...doc };
            const projected = { _id: doc._id };
            for (const [k, v] of Object.entries(options.projection)) {
                if (v) projected[k] = doc[k];
            }
            return projected;
        },
        find(query, options) {
            let results = items.filter(function (item) { return matches(item, query); }).map(function (doc) {
                if (!options || !options.projection) return { ...doc };
                const projected = { _id: doc._id };
                for (const [k, v] of Object.entries(options.projection)) {
                    if (v) projected[k] = doc[k];
                }
                return projected;
            });
            return {
                sort() { return this; },
                limit(n) { results = results.slice(0, n); return this; },
                async toArray() { return results; }
            };
        },
        async insertOne(doc) {
            for (const field of uniqueFields || []) {
                if (doc[field] && items.some(function (u) { return u[field] === doc[field]; })) {
                    const err = new Error("Duplicate key");
                    err.code = 11000;
                    throw err;
                }
            }
            const _id = new ObjectId();
            items.push({ ...doc, _id });
            return { insertedId: _id };
        },
        async updateOne(filter, update) {
            const doc = items.find(function (u) { return String(u._id) === String(filter._id); });
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
        },
        async deleteOne(filter) {
            const idx = items.findIndex(function (u) { return matches(u, filter); });
            if (idx < 0) return { deletedCount: 0 };
            items.splice(idx, 1);
            return { deletedCount: 1 };
        }
    };
}

const collections = {
    users: makeCollection(["email"]),
    products: makeCollection(["code"]),
    product_suggestions: makeCollection([])
};

MongoClient.prototype.connect = async function () {
    return this;
};
MongoClient.prototype.db = function () {
    return {
        collection(name) {
            if (!collections[name]) collections[name] = makeCollection([]);
            return collections[name];
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

test("personalized profile details persist across logout and next login", async function () {
    const loginRes = await fetch(base + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "alice@example.com", password: "newpassword123" })
    });
    assert.strictEqual(loginRes.status, 200);
    const cookie = loginRes.headers.get("set-cookie").split(";")[0];

    const customProfile = {
        age: 29,
        sex: "Female",
        height: 164,
        weight: 58.5,
        activityLevel: "Very active",
        goal: "Lose weight",
        diet: "Vegan",
        focusOn: ["Low sugar", "Low sodium"],
        allergies: ["Dairy", "Soy"]
    };

    const saveRes = await fetch(base + "/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ profile: customProfile })
    });
    assert.strictEqual(saveRes.status, 200);
    const saveBody = await saveRes.json();
    assert.deepStrictEqual(saveBody.user.profile, customProfile);

    await fetch(base + "/api/auth/logout", { method: "POST" });

    // Log in again and verify exact profile details are returned
    const nextLoginRes = await fetch(base + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "alice@example.com", password: "newpassword123" })
    });
    assert.strictEqual(nextLoginRes.status, 200);
    const nextBody = await nextLoginRes.json();
    assert.deepStrictEqual(nextBody.user.profile, customProfile);

    const nextCookie = nextLoginRes.headers.get("set-cookie").split(";")[0];
    const meRes = await fetch(base + "/api/auth/me", { headers: { Cookie: nextCookie } });
    assert.strictEqual(meRes.status, 200);
    assert.deepStrictEqual((await meRes.json()).user.profile, customProfile);
});

test("default admin controls admin access and admins review suggested products", async function () {
    // 1. Normal user cannot access admin endpoints
    const aliceLogin = await fetch(base + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "alice@example.com", password: "newpassword123" })
    });
    const aliceBody = await aliceLogin.json();
    assert.strictEqual(aliceBody.user.isAdmin, false);
    assert.strictEqual(aliceBody.user.isOwnerAdmin, false);
    const aliceCookie = aliceLogin.headers.get("set-cookie").split(";")[0];

    const forbiddenSuggestions = await fetch(base + "/api/admin/suggestions", { headers: { Cookie: aliceCookie } });
    assert.strictEqual(forbiddenSuggestions.status, 403);

    // 2. User suggests a product -> goes to pending review, not directly into products
    const suggestRes = await fetch(base + "/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: aliceCookie },
        body: JSON.stringify({ code: "8901234567890", name: "Organic Oats", brand: "NatureCo", size: "500 g" })
    });
    assert.strictEqual(suggestRes.status, 201);
    const suggestBody = await suggestRes.json();
    assert.strictEqual(suggestBody.status, "pending");
    assert.strictEqual(collections.products.items.length, 0);

    // 3. Default admin (jeevanmr1542001@gmail.com) logs in
    const ownerSignup = await fetch(base + "/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Jeevan", email: "jeevanmr1542001@gmail.com", password: "ownerpassword123" })
    });
    assert.strictEqual(ownerSignup.status, 201);
    const ownerBody = await ownerSignup.json();
    assert.strictEqual(ownerBody.user.isAdmin, true);
    assert.strictEqual(ownerBody.user.isOwnerAdmin, true);
    const ownerCookie = ownerSignup.headers.get("set-cookie").split(";")[0];

    // 4. Default admin grants admin access to Alice
    const usersRes = await fetch(base + "/api/admin/users", { headers: { Cookie: ownerCookie } });
    assert.strictEqual(usersRes.status, 200);
    const grantRes = await fetch(base + "/api/admin/users/" + aliceBody.user.id + "/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: ownerCookie },
        body: JSON.stringify({ isAdmin: true })
    });
    assert.strictEqual(grantRes.status, 200);
    assert.strictEqual((await grantRes.json()).user.isAdmin, true);

    // 5. Alice (now admin) can review & approve the suggestion, but still cannot manage admin access
    const aliceUsersRes = await fetch(base + "/api/admin/users", { headers: { Cookie: aliceCookie } });
    assert.strictEqual(aliceUsersRes.status, 403);

    const listRes = await fetch(base + "/api/admin/suggestions", { headers: { Cookie: aliceCookie } });
    assert.strictEqual(listRes.status, 200);
    const suggestions = (await listRes.json()).suggestions;
    assert.strictEqual(suggestions.length, 1);

    const approveRes = await fetch(base + "/api/admin/suggestions/" + suggestions[0].id + "/approve", {
        method: "POST",
        headers: { Cookie: aliceCookie }
    });
    assert.strictEqual(approveRes.status, 200);
    assert.strictEqual(collections.products.items.length, 1);
    assert.strictEqual(collections.products.items[0].code, "8901234567890");

    // 6. Only default admin can permanently delete user accounts (and cannot delete self)
    const aliceDeleteAttempt = await fetch(base + "/api/admin/users/" + ownerBody.user.id, {
        method: "DELETE",
        headers: { Cookie: aliceCookie }
    });
    assert.strictEqual(aliceDeleteAttempt.status, 403);

    const selfDeleteAttempt = await fetch(base + "/api/admin/users/" + ownerBody.user.id, {
        method: "DELETE",
        headers: { Cookie: ownerCookie }
    });
    assert.strictEqual(selfDeleteAttempt.status, 400);

    const deleteAliceRes = await fetch(base + "/api/admin/users/" + aliceBody.user.id, {
        method: "DELETE",
        headers: { Cookie: ownerCookie }
    });
    assert.strictEqual(deleteAliceRes.status, 200);

    const deletedLogin = await fetch(base + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "alice@example.com", password: "newpassword123" })
    });
    assert.strictEqual(deletedLogin.status, 401);
});
