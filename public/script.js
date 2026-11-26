/* =========================
   NutriSearch — page logic
   (look and feel is in style.css, content is in the .html files)
========================= */


/* =========================
   1. SEARCH (index.html + results.html)
========================= */

const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");

// Go to the results page with the search word in the address
function goToResults(query) {
    window.location.href = "results.html?q=" + encodeURIComponent(query.trim());
}

if (searchForm) {
    searchForm.addEventListener("submit", function (event) {
        event.preventDefault();
        goToResults(searchInput.value);
    });
}

// "Try: Maggi, Amul ..." buttons on the home page
document.querySelectorAll(".suggestion-chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
        goToResults(chip.dataset.query);
    });
});


/* =========================
   HELPERS (used by the results and product pages)
========================= */

// Ask our own backend for data. Returns the JSON, or throws a readable error.
async function getFromServer(url) {

    let response;

    try {
        response = await fetch(url);
    } catch (error) {
        throw new Error("Could not reach the server. Start it with 'npm start' and open http://localhost:3000");
    }

    const data = await response.json().catch(function () { return {}; });

    if (!response.ok) {
        throw new Error(data.error || "Something went wrong. Please try again.");
    }

    return data;
}

// Fill a Nutri-Score badge: letter + colour (grey "?" when unknown)
function setBadge(badge, score, extraClass) {
    badge.textContent = score ? score.toUpperCase() : "?";
    badge.className = "nutri-badge " + (extraClass ? extraClass + " " : "") +
        (score ? "nutri-" + score : "nutri-unknown");
}

// Only show images that come from a secure web address
function isSafeImage(url) {
    return typeof url === "string" && url.startsWith("https://");
}

function showStatus(message, isError) {
    const status = document.getElementById("status");
    status.textContent = message;
    status.classList.toggle("error", Boolean(isError));
}


/* =========================
   2. RESULTS PAGE (results.html)
========================= */

const productGrid = document.getElementById("productGrid");

if (productGrid) {

    const cardTemplate = document.getElementById("productCardTemplate");
    const resultsTitle = document.getElementById("resultsTitle");
    const filterChips = document.querySelectorAll(".filter-chip");

    const query = new URLSearchParams(window.location.search).get("q") || "";
    let allProducts = [];
    let scoreFilter = "all";

    searchInput.value = query;

    // Build one card from the template
    function makeCard(product) {

        const card = cardTemplate.content.firstElementChild.cloneNode(true);

        card.querySelector(".product-brand").textContent = product.brand;
        card.querySelector("h3").textContent = product.name;
        card.querySelector(".product-size").textContent = product.size;
        setBadge(card.querySelector(".nutri-badge"), product.score);

        if (isSafeImage(product.image)) {
            const image = card.querySelector("img");
            image.src = product.image;
            image.hidden = false;
            card.querySelector(".thumb-fallback").hidden = true;
        }

        // Clicking a card opens the product page for that barcode
        card.addEventListener("click", function () {
            window.location.href =
                "product.html?code=" + product.code + "&q=" + encodeURIComponent(query);
        });

        return card;
    }

    // Show the products that match the chosen Nutri-Score filter
    function showProducts() {

        const shown = allProducts.filter(function (product) {
            return scoreFilter === "all" || product.score === scoreFilter;
        });

        productGrid.replaceChildren(...shown.map(makeCard));

        const word = shown.length === 1 ? "product" : "products";
        resultsTitle.textContent = shown.length + " " + word + " found for “" + query + "”";

        showStatus(shown.length === 0 ? "No products match. Try another name, brand or score." : "");
    }

    filterChips.forEach(function (chip) {
        chip.addEventListener("click", function () {
            scoreFilter = chip.dataset.filter;

            filterChips.forEach(function (c) {
                c.classList.toggle("active", c === chip);
            });

            showProducts();
        });
    });

    // Load the products from our backend
    async function loadResults() {

        if (query.trim().length < 2) {
            showStatus("Type a product or brand in the search box above.");
            return;
        }

        showStatus("Searching...");

        try {
            const data = await getFromServer("/api/products/search?q=" + encodeURIComponent(query));
            allProducts = data.products;
            showProducts();
        } catch (error) {
            showStatus(error.message, true);
        }
    }

    loadResults();
}


/* =========================
   3. PRODUCT PAGE (product.html)
========================= */

const productLayout = document.getElementById("productLayout");

if (productLayout) {

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");

    // "Back to results" keeps the same search
    document.getElementById("backLink").href =
        "results.html?q=" + encodeURIComponent(params.get("q") || "");

    // Add small text pieces into a container (tags, nutrition rows)
    function fillTags(containerId, items, getClass) {
        const container = document.getElementById(containerId);

        container.replaceChildren(...items.map(function (item) {
            const tag = document.createElement("span");
            tag.className = getClass(item);
            tag.textContent = item.text || item;
            return tag;
        }));
    }

    function fillNutrition(rows) {
        const container = document.getElementById("detailNutrition");

        container.replaceChildren(...rows.map(function (row) {
            const line = document.createElement("div");
            line.className = "nutrition-row";

            const label = document.createElement("span");
            label.textContent = row.label;

            const value = document.createElement("strong");
            value.textContent = row.value + " " + row.unit;

            line.append(label, value);
            return line;
        }));
    }

    const summary = document.getElementById("detailSummary");
    if (summary) summary.textContent = product.summary || "";

    function showProduct(product) {

        document.title = product.name + " — NutriSearch";
        document.getElementById("detailBrand").textContent = product.brand;
        document.getElementById("detailName").textContent = product.name;
        document.getElementById("detailScore").textContent =
            product.score ? "Nutri-Score " + product.score.toUpperCase() : "Nutri-Score not available";
        document.getElementById("detailSize").textContent =
            [product.size, product.countries].filter(Boolean).join(" · ");

        setBadge(document.getElementById("detailBadge"), product.score, "nutri-lg");

        if (isSafeImage(product.image)) {
            const image = document.getElementById("detailImage");
            image.src = product.image;
            image.hidden = false;
            document.getElementById("detailFallback").hidden = true;
        }

        fillTags("detailHighlights", product.highlights, function (item) {
            return "tag " + (item.type === "warn" ? "tag-warn" : "tag-good");
        });
        fillTags("detailIngredients", product.ingredients, function () { return "tag"; });
        fillNutrition(product.nutrition);

        productLayout.hidden = false;
    }

    async function loadProduct() {

        if (!code) {
            showStatus("No product chosen. Go back and pick one from the results.", true);
            return;
        }

        try {
            const product = await getFromServer("/api/products/" + encodeURIComponent(code));
            showStatus("");
            showProduct(product);
        } catch (error) {
            showStatus(error.message, true);
        }
    }

    loadProduct();

    // Save button (saving to your account comes in a later step)
    const saveBtn = document.getElementById("saveBtn");

    saveBtn.addEventListener("click", function () {
        const saved = saveBtn.classList.toggle("saved");
        saveBtn.textContent = saved ? "♥ Saved to your list" : "♡ Save to my list";
    });
}


/* =========================
   4. LOG IN / SIGN UP (login.html, signup.html)
========================= */

const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const forgotPasswordForm = document.getElementById("forgotPasswordForm");
const resetPasswordForm = document.getElementById("resetPasswordForm");
const authMessage = document.getElementById("authMessage");

async function authRequest(url, body, method) {
    const response = await fetch(url, {
        method: method || "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body)
    });
    const data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || "Authentication failed. Please try again.");
    return data;
}

function showAuthError(message) {
    if (!authMessage) return;
    authMessage.style.background = "";
    authMessage.style.borderColor = "";
    authMessage.style.color = "";
    authMessage.textContent = message;
    authMessage.hidden = false;
}

function showAuthSuccess(message) {
    if (!authMessage) return;
    authMessage.style.background = "#effaf1";
    authMessage.style.borderColor = "#a8dfb4";
    authMessage.style.color = "#1c6b2d";
    authMessage.textContent = message;
    authMessage.hidden = false;
}

function clearAuthError() {
    if (!authMessage) return;
    authMessage.textContent = "";
    authMessage.hidden = true;
}

async function logoutAndRedirect(target) {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(function () {});
    window.location.href = target || "index.html";
}

if (loginForm || signupForm) {
    const googleContainer = document.getElementById("googleSignIn");
    const googleDivider = googleContainer && googleContainer.previousElementSibling;
    fetch("/api/auth/config", { cache: "no-store" }).then(function (response) { return response.json(); }).then(function (config) {
        if (!googleContainer || !config.googleClientId) {
            if (googleDivider && googleDivider.classList.contains("divider")) googleDivider.hidden = true;
            return;
        }
        const googleScript = document.createElement("script");
        googleScript.src = "https://accounts.google.com/gsi/client";
        googleScript.async = true;
        googleScript.defer = true;
        googleScript.onload = function () {
            window.google.accounts.id.initialize({
                client_id: config.googleClientId,
                callback: async function (response) {
                    clearAuthError();
                    try {
                        await authRequest("/api/auth/google", { credential: response.credential });
                        window.location.href = "profile.html";
                    } catch (error) { showAuthError(error.message); }
                }
            });
            window.google.accounts.id.renderButton(googleContainer, {
                theme: "outline",
                size: "large",
                text: signupForm ? "signup_with" : "continue_with",
                shape: "rectangular",
                width: Math.min(360, googleContainer.clientWidth || 360)
            });
        };
        googleScript.onerror = function () { showAuthError("Google sign-in could not load. Please try again."); };
        document.head.appendChild(googleScript);
    }).catch(function () { showAuthError("Could not load sign-in settings."); });
}

if (loginForm) {
    loginForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        clearAuthError();
        const submitBtn = loginForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = "Logging in...";
        try {
            await authRequest("/api/auth/login", {
                email: document.getElementById("email").value,
                password: document.getElementById("password").value
            });
            window.location.href = "profile.html";
        } catch (error) {
            showAuthError(error.message);
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });
}

if (signupForm) {
    signupForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        clearAuthError();

        const password = document.getElementById("password").value;
        const confirm = document.getElementById("confirm").value;

        if (password !== confirm) {
            showAuthError("Passwords do not match.");
            return;
        }

        const submitBtn = signupForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = "Creating account...";
        try {
            await authRequest("/api/auth/signup", {
                name: document.getElementById("name").value,
                email: document.getElementById("email").value,
                password: password
            });
            window.location.href = "profile.html";
        } catch (error) {
            showAuthError(error.message);
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });
}

if (forgotPasswordForm) {
    forgotPasswordForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        clearAuthError();
        const submitBtn = forgotPasswordForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = "Sending...";
        try {
            const data = await authRequest("/api/auth/forgot-password", {
                email: document.getElementById("email").value
            });
            showAuthSuccess(data.message);
            if (data.resetUrl) {
                const link = document.createElement("a");
                link.href = data.resetUrl;
                link.className = "link-green";
                link.textContent = " Open reset link";
                authMessage.appendChild(link);
            }
        } catch (error) {
            showAuthError(error.message);
            if (error.message.includes("User Doesn't Exist")) {
                const signupLink = document.createElement("a");
                signupLink.href = "signup.html";
                signupLink.className = "link-green";
                signupLink.textContent = " Create account";
                authMessage.appendChild(signupLink);
                alert(error.message);
            }
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });
}

if (resetPasswordForm) {
    const resetToken = new URLSearchParams(window.location.search).get("token") || "";
    if (!resetToken) {
        showAuthError("Reset token is missing. Please request a new reset link.");
    }
    resetPasswordForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        clearAuthError();
        const password = document.getElementById("password").value;
        const confirm = document.getElementById("confirm").value;
        if (password !== confirm) {
            showAuthError("Passwords do not match.");
            return;
        }
        const submitBtn = resetPasswordForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = "Updating...";
        try {
            const data = await authRequest("/api/auth/reset-password", {
                token: resetToken,
                password: password
            });
            showAuthSuccess(data.message + " Redirecting to log in...");
            setTimeout(function () { window.location.href = "login.html"; }, 1500);
        } catch (error) {
            showAuthError(error.message);
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });
}

const profile = document.getElementById("profile");
if (profile) {
    getFromServer("/api/auth/me").then(function (data) {
        document.querySelector(".profile-id h1").textContent = data.user.name;
        document.querySelector(".profile-id p").textContent = data.user.email;
        document.querySelector(".profile-avatar").textContent = data.user.name.charAt(0).toUpperCase();

        const accName = document.getElementById("accName");
        const accEmail = document.getElementById("accEmail");
        if (accName) accName.value = data.user.name;
        if (accEmail) accEmail.value = data.user.email;

        const loginLink = document.querySelector(".navbar .login-btn");
        if (loginLink) {
            loginLink.textContent = "Log out";
            loginLink.href = "#logout";
            loginLink.addEventListener("click", function (event) {
                event.preventDefault();
                logoutAndRedirect("index.html");
            });
        }
    }).catch(function () { window.location.href = "login.html"; });
} else {
    fetch("/api/auth/me", { credentials: "same-origin" }).then(function (response) {
        if (!response.ok) return null;
        return response.json();
    }).then(function (data) {
        if (!data || !data.user) return;
        if (loginForm || signupForm) {
            window.location.href = "profile.html";
            return;
        }
        const loginLink = document.querySelector(".navbar .login-btn");
        if (loginLink) {
            loginLink.textContent = data.user.name.split(" ")[0];
            loginLink.href = "profile.html";
        }
    }).catch(function () {});
}

// Show / hide password (login, signup and profile)
document.querySelectorAll("[data-toggle-password]").forEach(function (button) {
    button.addEventListener("click", function () {
        const input = button.closest(".input-box").querySelector("input");
        input.type = input.type === "password" ? "text" : "password";
    });
});


/* =========================
   5. PROFILE PAGE (profile.html)
========================= */

// Option buttons: "single" lets you pick one, "multi" lets you pick many
document.querySelectorAll(".option-group").forEach(function (group) {

    const mode = group.dataset.select;

    group.querySelectorAll(".option-chip").forEach(function (chip) {
        chip.addEventListener("click", function () {

            if (mode === "single") {
                group.querySelectorAll(".option-chip").forEach(function (c) {
                    c.classList.remove("active");
                });
                chip.classList.add("active");
            } else {
                chip.classList.toggle("active");
            }
        });
    });
});

const saveAccountBtn = document.getElementById("saveAccountBtn");
const accountMessage = document.getElementById("accountMessage");

function showAccountMessage(message, isSuccess) {
    if (!accountMessage) return;
    accountMessage.textContent = message;
    accountMessage.style.background = isSuccess ? "#effaf1" : "";
    accountMessage.style.borderColor = isSuccess ? "#a8dfb4" : "";
    accountMessage.style.color = isSuccess ? "#1c6b2d" : "";
    accountMessage.hidden = false;
}

if (saveAccountBtn) {
    saveAccountBtn.addEventListener("click", async function () {
        if (accountMessage) accountMessage.hidden = true;
        const name = document.getElementById("accName").value;
        const email = document.getElementById("accEmail").value;
        const password = document.getElementById("accPass").value;
        const confirmPassword = document.getElementById("accPass2").value;

        if (password && password !== confirmPassword) {
            showAccountMessage("New passwords do not match.", false);
            return;
        }

        const payload = { name: name, email: email };
        if (password) payload.password = password;

        saveAccountBtn.disabled = true;
        try {
            const data = await authRequest("/api/auth/me", payload, "PATCH");
            document.querySelector(".profile-id h1").textContent = data.user.name;
            document.querySelector(".profile-id p").textContent = data.user.email;
            document.querySelector(".profile-avatar").textContent = data.user.name.charAt(0).toUpperCase();
            document.getElementById("accPass").value = "";
            document.getElementById("accPass2").value = "";
            showAccountMessage("Account details updated.", true);
        } catch (error) {
            showAccountMessage(error.message, false);
        } finally {
            saveAccountBtn.disabled = false;
        }
    });
}

const logoutBtn = document.getElementById("logoutBtn");

if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
        logoutAndRedirect("login.html");
    });
}


/* =========================
   6. ADD A PRODUCT (add-product.html)
========================= */

const addForm = document.getElementById("addForm");

if (addForm) {

    // Allows links like add-product.html?code=8901058000000
    const presetCode = new URLSearchParams(window.location.search).get("code");
    if (presetCode) document.getElementById("code").value = presetCode;

    addForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        // Send only the fields the person filled in
        const body = {};
        new FormData(addForm).forEach(function (value, key) {
            if (value !== "") body[key] = value;
        });

        showStatus("Saving...");

        try {
            const response = await fetch("/api/products", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            const data = await response.json().catch(function () { return {}; });

            if (!response.ok) throw new Error(data.error || "Could not save the product.");

            window.location.href = "product.html?code=" + encodeURIComponent(data.code);
        } catch (error) {
            showStatus(error.message, true);
        }
    });
}