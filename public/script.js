/* =========================
   NutriSearch — page logic
   (look and feel is in style.css, content is in the .html files)
========================= */


/* =========================
   0. THEME (Light / Dark)
========================= */

const THEME_STORAGE_KEY = "nutrisearch_theme";

function getPreferredTheme() {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const toggleBtn = document.querySelector(".theme-toggle");
    if (toggleBtn) {
        const isDark = theme === "dark";
        toggleBtn.textContent = isDark ? "☀️ Light" : "🌙 Dark";
        toggleBtn.setAttribute("aria-pressed", String(isDark));
        toggleBtn.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
    }
}

applyTheme(getPreferredTheme());

(function initThemeToggle() {
    const navLinks = document.querySelector(".navbar .nav-links");
    if (!navLinks || navLinks.querySelector(".theme-toggle")) return;
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "theme-toggle";
    const loginBtn = navLinks.querySelector(".login-btn");
    navLinks.insertBefore(toggleBtn, loginBtn || null);
    applyTheme(document.documentElement.dataset.theme || "light");
    toggleBtn.addEventListener("click", function () {
        const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        localStorage.setItem(THEME_STORAGE_KEY, next);
        applyTheme(next);
    });
})();


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
    authMessage.classList.remove("is-success");
    authMessage.textContent = message;
    authMessage.hidden = false;
}

function showAuthSuccess(message) {
    if (!authMessage) return;
    authMessage.classList.add("is-success");
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

function readProfileForm() {
    const data = {
        age: Number(document.getElementById("age").value),
        sex: document.getElementById("sex").value,
        height: Number(document.getElementById("height").value),
        weight: Number(document.getElementById("weight").value)
    };
    document.querySelectorAll(".option-group[data-profile-field]").forEach(function (group) {
        const field = group.dataset.profileField;
        const activeTexts = Array.from(group.querySelectorAll(".option-chip.active")).map(function (c) {
            return c.textContent.trim();
        });
        data[field] = group.dataset.select === "single" ? (activeTexts[0] || "") : activeTexts;
    });
    return data;
}

function updateDailyTargets(p) {
    const caloriesEl = document.getElementById("targetCalories");
    const proteinEl = document.getElementById("targetProtein");
    const sugarEl = document.getElementById("targetSugar");
    const sodiumEl = document.getElementById("targetSodium");
    if (!caloriesEl || !p) return;

    const age = Number(p.age) || 25;
    const height = Number(p.height) || 170;
    const weight = Number(p.weight) || 65;
    const sexOffset = p.sex === "Female" ? -161 : p.sex === "Male" ? 5 : -78;
    const bmr = 10 * weight + 6.25 * height - 5 * age + sexOffset;
    const activityMap = { "Sedentary": 1.2, "Lightly active": 1.375, "Moderately active": 1.55, "Very active": 1.725 };
    const goalOffset = p.goal === "Lose weight" ? -400 : p.goal === "Build muscle" ? 250 : 0;
    const calories = Math.max(1200, Math.round((bmr * (activityMap[p.activityLevel] || 1.55) + goalOffset) / 50) * 50);

    const focus = Array.isArray(p.focusOn) ? p.focusOn : [];
    const proteinFactor = (p.goal === "Build muscle" || focus.includes("High protein")) ? 1.6 : 1.0;
    const protein = Math.round(weight * proteinFactor);
    const sugar = focus.includes("Low sugar") ? 30 : Math.round((calories * 0.1) / 4);
    const sodium = focus.includes("Low sodium") ? 1500 : 2000;

    caloriesEl.textContent = calories.toLocaleString() + " kcal";
    proteinEl.textContent = protein + " g";
    sugarEl.textContent = sugar + " g";
    sodiumEl.textContent = sodium.toLocaleString() + " mg";
}

function applyProfileForm(p) {
    if (!p) return;
    if (p.age !== undefined) document.getElementById("age").value = p.age;
    if (p.sex !== undefined) document.getElementById("sex").value = p.sex;
    if (p.height !== undefined) document.getElementById("height").value = p.height;
    if (p.weight !== undefined) document.getElementById("weight").value = p.weight;

    document.querySelectorAll(".option-group[data-profile-field]").forEach(function (group) {
        const field = group.dataset.profileField;
        if (p[field] === undefined) return;
        const selected = Array.isArray(p[field]) ? p[field] : [p[field]];
        group.querySelectorAll(".option-chip").forEach(function (chip) {
            chip.classList.toggle("active", selected.includes(chip.textContent.trim()));
        });
    });

    updateDailyTargets(p);
}

function injectAdminNavLink(user) {
    if (!user || !user.isAdmin) return;
    const navLinks = document.querySelector(".navbar .nav-links");
    if (!navLinks || navLinks.querySelector(".admin-nav-link")) return;
    const anchor = navLinks.querySelector(".theme-toggle") || navLinks.querySelector(".login-btn");

    const invLink = document.createElement("a");
    invLink.href = "inventory.html";
    invLink.className = "inventory-nav-link";
    invLink.textContent = "Inventory";
    if (window.location.pathname.endsWith("/inventory.html")) invLink.classList.add("active");
    navLinks.insertBefore(invLink, anchor || null);

    const link = document.createElement("a");
    link.href = "admin.html";
    link.className = "admin-nav-link";
    link.textContent = "Admin";
    if (window.location.pathname.endsWith("/admin.html")) link.classList.add("active");
    navLinks.insertBefore(link, anchor || null);
}

if (profile) {
    getFromServer("/api/auth/me").then(function (data) {
        injectAdminNavLink(data.user);
        document.querySelector(".profile-id h1").textContent = data.user.name;
        document.querySelector(".profile-id p").textContent = data.user.email;
        document.querySelector(".profile-avatar").textContent = data.user.name.charAt(0).toUpperCase();

        const accName = document.getElementById("accName");
        const accEmail = document.getElementById("accEmail");
        if (accName) accName.value = data.user.name;
        if (accEmail) accEmail.value = data.user.email;

        if (data.user.profile) {
            applyProfileForm(data.user.profile);
        } else {
            updateDailyTargets(readProfileForm());
        }

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
        injectAdminNavLink(data.user);
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
            if (profile) updateDailyTargets(readProfileForm());
        });
    });
});

if (profile) {
    ["age", "sex", "height", "weight"].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.addEventListener("change", function () { updateDailyTargets(readProfileForm()); });
    });
}

const saveProfileBtn = document.getElementById("saveProfileBtn");
const profileMessage = document.getElementById("profileMessage");

function showProfileMessage(message, isSuccess) {
    if (!profileMessage) return;
    profileMessage.textContent = message;
    profileMessage.classList.toggle("is-success", Boolean(isSuccess));
    profileMessage.hidden = false;
}

if (saveProfileBtn) {
    saveProfileBtn.addEventListener("click", async function () {
        if (profileMessage) profileMessage.hidden = true;
        saveProfileBtn.disabled = true;
        const originalText = saveProfileBtn.textContent;
        saveProfileBtn.textContent = "Saving...";
        try {
            const profileData = readProfileForm();
            const data = await authRequest("/api/auth/me", { profile: profileData }, "PATCH");
            applyProfileForm(data.user.profile);
            showProfileMessage("Profile preferences saved.", true);
        } catch (error) {
            showProfileMessage(error.message, false);
        } finally {
            saveProfileBtn.disabled = false;
            saveProfileBtn.textContent = originalText;
        }
    });
}

const saveAccountBtn = document.getElementById("saveAccountBtn");
const accountMessage = document.getElementById("accountMessage");

function showAccountMessage(message, isSuccess) {
    if (!accountMessage) return;
    accountMessage.textContent = message;
    accountMessage.classList.toggle("is-success", Boolean(isSuccess));
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

            if (data.status === "pending") {
                showStatus(data.message || "Submitted for admin review!");
                addForm.reset();
            } else {
                window.location.href = "product.html?code=" + encodeURIComponent(data.code);
            }
        } catch (error) {
            showStatus(error.message, true);
        }
    });
}


/* =========================
   7. ADMIN DASHBOARD (admin.html)
========================= */

const adminPage = document.getElementById("adminPage");

if (adminPage) {
    let allSuggestions = [];
    let suggestionFilter = "pending";

    function setAdminMsg(el, message, isSuccess) {
        if (!el) return;
        el.textContent = message;
        el.classList.toggle("is-success", Boolean(isSuccess));
        el.hidden = !message;
    }

    function renderSuggestions() {
        const listEl = document.getElementById("suggestionsList");
        const pendingCount = allSuggestions.filter(function (s) { return s.status === "pending"; }).length;
        const approvedCount = allSuggestions.filter(function (s) { return s.status === "approved"; }).length;
        document.getElementById("statPending").textContent = pendingCount;
        document.getElementById("statApproved").textContent = approvedCount;

        const visible = allSuggestions.filter(function (s) {
            return suggestionFilter === "all" || s.status === suggestionFilter;
        });

        if (visible.length === 0) {
            listEl.replaceChildren();
            const empty = document.createElement("p");
            empty.className = "status-message";
            empty.textContent = suggestionFilter === "pending"
                ? "No pending product suggestions to review."
                : "No product suggestions found.";
            listEl.appendChild(empty);
            return;
        }

        listEl.replaceChildren(...visible.map(function (item) {
            const row = document.createElement("div");
            row.className = "admin-item";

            const info = document.createElement("div");
            info.className = "admin-item-info";

            const head = document.createElement("div");
            head.className = "admin-item-head";
            const title = document.createElement("strong");
            title.textContent = item.name;
            const badge = document.createElement("span");
            badge.className = "role-badge " + (item.status === "approved" ? "is-healthy" : item.status === "rejected" ? "is-rejected" : "is-pending");
            badge.textContent = item.status.charAt(0).toUpperCase() + item.status.slice(1);
            head.append(title, badge);

            const meta1 = document.createElement("div");
            meta1.className = "admin-item-meta";
            meta1.textContent = [
                "Barcode: " + item.code,
                item.brand ? "Brand: " + item.brand : "",
                item.size ? "Size: " + item.size : "",
                "Submitted by: " + item.submittedBy
            ].filter(Boolean).join(" · ");

            info.append(head, meta1);

            if (item.ingredients) {
                const meta2 = document.createElement("div");
                meta2.className = "admin-item-meta";
                meta2.textContent = "Ingredients: " + item.ingredients;
                info.appendChild(meta2);
            }

            const actions = document.createElement("div");
            actions.className = "admin-actions";

            if (item.status === "pending") {
                const approveBtn = document.createElement("button");
                approveBtn.type = "button";
                approveBtn.className = "btn-primary";
                approveBtn.textContent = "Approve";
                approveBtn.addEventListener("click", async function () {
                    approveBtn.disabled = true;
                    try {
                        await authRequest("/api/admin/suggestions/" + encodeURIComponent(item.id) + "/approve", {});
                        setAdminMsg(document.getElementById("adminSuggestionMsg"), "Approved and published \"" + item.name + "\".", true);
                        await loadSuggestions();
                    } catch (err) {
                        setAdminMsg(document.getElementById("adminSuggestionMsg"), err.message, false);
                        approveBtn.disabled = false;
                    }
                });

                const rejectBtn = document.createElement("button");
                rejectBtn.type = "button";
                rejectBtn.className = "btn-danger";
                rejectBtn.textContent = "Reject";
                rejectBtn.addEventListener("click", async function () {
                    rejectBtn.disabled = true;
                    try {
                        await authRequest("/api/admin/suggestions/" + encodeURIComponent(item.id) + "/reject", {});
                        setAdminMsg(document.getElementById("adminSuggestionMsg"), "Rejected \"" + item.name + "\".", true);
                        await loadSuggestions();
                    } catch (err) {
                        setAdminMsg(document.getElementById("adminSuggestionMsg"), err.message, false);
                        rejectBtn.disabled = false;
                    }
                });

                actions.append(approveBtn, rejectBtn);
            }

            row.append(info, actions);
            return row;
        }));
    }

    async function loadSuggestions() {
        const data = await getFromServer("/api/admin/suggestions");
        allSuggestions = data.suggestions || [];
        renderSuggestions();
    }

    async function loadAdminUsers() {
        const data = await getFromServer("/api/admin/users");
        const users = data.users || [];
        const adminsCount = users.filter(function (u) { return u.isAdmin; }).length;
        document.getElementById("statAdmins").textContent = adminsCount;

        const listEl = document.getElementById("adminUsersList");
        listEl.replaceChildren(...users.map(function (u) {
            const row = document.createElement("div");
            row.className = "admin-item";

            const info = document.createElement("div");
            info.className = "admin-item-info";

            const head = document.createElement("div");
            head.className = "admin-item-head";
            const nameEl = document.createElement("strong");
            nameEl.textContent = u.name;
            const badge = document.createElement("span");
            badge.className = "role-badge " + (u.isOwnerAdmin ? "is-owner" : u.isAdmin ? "is-healthy" : "");
            badge.textContent = u.isOwnerAdmin ? "Default Admin" : u.isAdmin ? "Admin" : "User";
            head.append(nameEl, badge);

            const meta = document.createElement("div");
            meta.className = "admin-item-meta";
            meta.textContent = u.email + (u.authProviders && u.authProviders.length ? " · " + u.authProviders.join(", ") : "");
            info.append(head, meta);

            const actions = document.createElement("div");
            actions.className = "admin-actions";

            if (!u.isOwnerAdmin) {
                const toggleBtn = document.createElement("button");
                toggleBtn.type = "button";
                toggleBtn.className = u.isAdmin ? "btn-danger" : "btn-outline";
                toggleBtn.textContent = u.isAdmin ? "Revoke admin" : "Make admin";
                toggleBtn.addEventListener("click", async function () {
                    toggleBtn.disabled = true;
                    try {
                        await authRequest("/api/admin/users/" + encodeURIComponent(u.id) + "/admin", { isAdmin: !u.isAdmin }, "PATCH");
                        setAdminMsg(document.getElementById("adminUsersMsg"), "Updated admin access for " + u.email + ".", true);
                        await loadAdminUsers();
                    } catch (err) {
                        setAdminMsg(document.getElementById("adminUsersMsg"), err.message, false);
                        toggleBtn.disabled = false;
                    }
                });

                const deleteBtn = document.createElement("button");
                deleteBtn.type = "button";
                deleteBtn.className = "btn-danger";
                deleteBtn.textContent = "Delete user";
                deleteBtn.addEventListener("click", async function () {
                    if (!window.confirm("Delete " + u.email + " permanently from the database? This cannot be undone.")) return;
                    deleteBtn.disabled = true;
                    try {
                        await authRequest("/api/admin/users/" + encodeURIComponent(u.id), {}, "DELETE");
                        setAdminMsg(document.getElementById("adminUsersMsg"), "Deleted user " + u.email + " from database.", true);
                        await loadAdminUsers();
                    } catch (err) {
                        setAdminMsg(document.getElementById("adminUsersMsg"), err.message, false);
                        deleteBtn.disabled = false;
                    }
                });

                actions.append(toggleBtn, deleteBtn);
            }

            row.append(info, actions);
            return row;
        }));
    }

    document.querySelectorAll("[data-suggestion-filter]").forEach(function (btn) {
        btn.addEventListener("click", function () {
            suggestionFilter = btn.dataset.suggestionFilter;
            document.querySelectorAll("[data-suggestion-filter]").forEach(function (b) {
                b.classList.toggle("active", b === btn);
            });
            renderSuggestions();
        });
    });

    getFromServer("/api/auth/me").then(async function (data) {
        if (!data.user || !data.user.isAdmin) {
            window.location.href = "index.html";
            return;
        }
        adminPage.hidden = false;
        document.getElementById("adminAvatar").textContent = data.user.name.charAt(0).toUpperCase();
        document.getElementById("adminIdentity").textContent = data.user.name + " (" + data.user.email + ")";
        document.getElementById("adminRoleBadge").textContent = data.user.isOwnerAdmin ? "Default Admin" : "Admin";

        await loadSuggestions();
        if (data.user.isOwnerAdmin) {
            document.getElementById("statUsersCard").hidden = false;
            document.getElementById("adminAccessCard").hidden = false;
            await loadAdminUsers();
        }
    }).catch(function () {
        window.location.href = "login.html";
    });
}


/* =========================
   8. INVENTORY MANAGEMENT (inventory.html)
========================= */

const inventoryPageEl = document.getElementById("inventoryPage");

if (inventoryPageEl) {
    let inventoryPage = 1;
    let inventoryQuery = "";
    const inventoryLimit = 20;
    let editingProductCode = null;

    const editModal = document.getElementById("inventoryEditModal");
    const editForm = document.getElementById("inventoryEditForm");
    const editPhotoInput = document.getElementById("editProductImage");
    const editPhotoPreview = document.getElementById("editProductPhotoPreview");

    function setInventoryMsg(el, message, isSuccess) {
        if (!el) return;
        el.textContent = message;
        el.classList.toggle("is-success", Boolean(isSuccess));
        el.hidden = !message;
    }

    function renderThumb(container, url, altText) {
        container.replaceChildren();
        const cleanUrl = String(url || "").trim();
        if (!cleanUrl) {
            const fallback = document.createElement("span");
            fallback.textContent = "No photo";
            container.appendChild(fallback);
            return;
        }
        const img = document.createElement("img");
        img.src = cleanUrl;
        img.alt = altText || "Product photo";
        img.loading = "lazy";
        img.addEventListener("error", function () {
            container.replaceChildren();
            const fallback = document.createElement("span");
            fallback.textContent = "No photo";
            container.appendChild(fallback);
        });
        container.appendChild(img);
    }

    function closeEditModal() {
        editingProductCode = null;
        if (editModal) editModal.hidden = true;
        setInventoryMsg(document.getElementById("inventoryEditMsg"), "", true);
    }

    function openEditModal(item) {
        if (!editModal || !editForm) return;
        editingProductCode = item.code;
        document.getElementById("editProductCode").value = item.code || "";
        document.getElementById("editProductImage").value = item.image || "";
        renderThumb(editPhotoPreview, item.image, item.name);
        document.getElementById("editProductName").value = item.name || "";
        document.getElementById("editProductBrand").value = item.brand || "";
        document.getElementById("editProductSize").value = item.size || "";
        document.getElementById("editProductScore").value = item.score || "";
        document.getElementById("editProductIngredients").value = item.ingredients || "";
        document.getElementById("editProductEnergy").value = item.energy ?? "";
        document.getElementById("editProductFat").value = item.fat ?? "";
        document.getElementById("editProductSaturatedFat").value = item.saturatedFat ?? "";
        document.getElementById("editProductCarbs").value = item.carbohydrates ?? "";
        document.getElementById("editProductSugars").value = item.sugars ?? "";
        document.getElementById("editProductFiber").value = item.fiber ?? "";
        document.getElementById("editProductProteins").value = item.proteins ?? "";
        document.getElementById("editProductSalt").value = item.salt ?? "";
        setInventoryMsg(document.getElementById("inventoryEditMsg"), "", true);
        editModal.hidden = false;
        document.getElementById("editProductName").focus();
    }

    if (editPhotoInput && editPhotoPreview) {
        editPhotoInput.addEventListener("input", function () {
            renderThumb(editPhotoPreview, editPhotoInput.value, "Preview");
        });
    }

    function renderInventory(data) {
        const products = data.products || [];
        const total = data.total || 0;
        const page = data.page || 1;
        const limit = data.limit || inventoryLimit;
        const totalPages = Math.max(1, Math.ceil(total / limit));

        if (!inventoryQuery) {
            document.getElementById("statInventory").textContent = total;
        }

        const listEl = document.getElementById("inventoryList");
        const paginationEl = document.getElementById("inventoryPagination");

        if (products.length === 0) {
            listEl.replaceChildren();
            const empty = document.createElement("p");
            empty.className = "status-message";
            empty.textContent = inventoryQuery
                ? "No inventory products match \"" + inventoryQuery + "\"."
                : "No products found in inventory.";
            listEl.appendChild(empty);
            paginationEl.hidden = true;
            return;
        }

        listEl.replaceChildren(...products.map(function (item) {
            const row = document.createElement("div");
            row.className = "admin-item";

            const main = document.createElement("div");
            main.className = "inventory-item-main";

            const thumb = document.createElement("div");
            thumb.className = "inventory-thumb";
            renderThumb(thumb, item.image, item.name);

            const info = document.createElement("div");
            info.className = "admin-item-info";

            const head = document.createElement("div");
            head.className = "admin-item-head";
            const title = document.createElement("strong");
            title.textContent = item.name;
            head.appendChild(title);

            if (item.score) {
                const badge = document.createElement("span");
                badge.className = "role-badge " + (item.score === "a" || item.score === "b" ? "is-healthy" : item.score === "c" ? "is-pending" : "is-rejected");
                badge.textContent = "Nutri-Score " + item.score.toUpperCase();
                head.appendChild(badge);
            }

            const meta1 = document.createElement("div");
            meta1.className = "admin-item-meta";
            meta1.textContent = [
                "Barcode: " + item.code,
                item.brand ? "Brand: " + item.brand : "",
                item.size ? "Size: " + item.size : "",
                item.energy !== null ? "Energy: " + item.energy + " kcal/100g" : ""
            ].filter(Boolean).join(" · ");

            info.append(head, meta1);

            if (item.ingredients) {
                const meta2 = document.createElement("div");
                meta2.className = "admin-item-meta";
                meta2.textContent = "Ingredients: " + (item.ingredients.length > 160 ? item.ingredients.slice(0, 160) + "…" : item.ingredients);
                info.appendChild(meta2);
            }

            main.append(thumb, info);

            const actions = document.createElement("div");
            actions.className = "admin-actions";

            const editBtn = document.createElement("button");
            editBtn.type = "button";
            editBtn.className = "btn-outline";
            editBtn.textContent = "Edit";
            editBtn.addEventListener("click", function () {
                openEditModal(item);
            });

            const deleteBtn = document.createElement("button");
            deleteBtn.type = "button";
            deleteBtn.className = "btn-danger";
            deleteBtn.textContent = "Delete";
            deleteBtn.addEventListener("click", async function () {
                if (!window.confirm("Delete \"" + item.name + "\" (" + item.code + ") from inventory? This cannot be undone.")) return;
                deleteBtn.disabled = true;
                try {
                    await authRequest("/api/admin/products/" + encodeURIComponent(item.code), {}, "DELETE");
                    setInventoryMsg(document.getElementById("adminInventoryMsg"), "Deleted \"" + item.name + "\" from inventory.", true);
                    if (products.length === 1 && inventoryPage > 1) inventoryPage--;
                    await loadInventory();
                } catch (err) {
                    setInventoryMsg(document.getElementById("adminInventoryMsg"), err.message, false);
                    deleteBtn.disabled = false;
                }
            });

            actions.append(editBtn, deleteBtn);
            row.append(main, actions);
            return row;
        }));

        paginationEl.hidden = totalPages <= 1;
        document.getElementById("inventoryPageInfo").textContent = "Page " + page + " of " + totalPages + " (" + total + " items)";
        document.getElementById("inventoryPrevBtn").disabled = page <= 1;
        document.getElementById("inventoryNextBtn").disabled = page >= totalPages;
    }

    async function loadInventory() {
        const params = new URLSearchParams({
            page: String(inventoryPage),
            limit: String(inventoryLimit)
        });
        if (inventoryQuery) params.set("q", inventoryQuery);
        const data = await getFromServer("/api/admin/products?" + params.toString());
        renderInventory(data);
    }

    const inventorySearchForm = document.getElementById("inventorySearchForm");
    const inventorySearchInput = document.getElementById("inventorySearchInput");
    const inventoryClearBtn = document.getElementById("inventoryClearBtn");

    if (inventorySearchForm) {
        inventorySearchForm.addEventListener("submit", function (e) {
            e.preventDefault();
            inventoryQuery = inventorySearchInput.value.trim();
            inventoryPage = 1;
            inventoryClearBtn.hidden = !inventoryQuery;
            loadInventory().catch(function (err) {
                setInventoryMsg(document.getElementById("adminInventoryMsg"), err.message, false);
            });
        });
    }

    if (inventoryClearBtn) {
        inventoryClearBtn.addEventListener("click", function () {
            inventoryQuery = "";
            inventoryPage = 1;
            inventorySearchInput.value = "";
            inventoryClearBtn.hidden = true;
            loadInventory().catch(function (err) {
                setInventoryMsg(document.getElementById("adminInventoryMsg"), err.message, false);
            });
        });
    }

    document.getElementById("inventoryPrevBtn")?.addEventListener("click", function () {
        if (inventoryPage > 1) {
            inventoryPage--;
            loadInventory();
        }
    });

    document.getElementById("inventoryNextBtn")?.addEventListener("click", function () {
        inventoryPage++;
        loadInventory();
    });

    document.getElementById("inventoryEditClose")?.addEventListener("click", closeEditModal);
    document.getElementById("inventoryEditCancel")?.addEventListener("click", closeEditModal);
    editModal?.addEventListener("click", function (e) {
        if (e.target === editModal) closeEditModal();
    });
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && editModal && !editModal.hidden) closeEditModal();
    });

    if (editForm) {
        editForm.addEventListener("submit", async function (e) {
            e.preventDefault();
            if (!editingProductCode) return;

            const saveBtn = document.getElementById("inventoryEditSave");
            saveBtn.disabled = true;
            try {
                const payload = {
                    image: document.getElementById("editProductImage").value,
                    name: document.getElementById("editProductName").value,
                    brand: document.getElementById("editProductBrand").value,
                    size: document.getElementById("editProductSize").value,
                    score: document.getElementById("editProductScore").value,
                    ingredients: document.getElementById("editProductIngredients").value,
                    energy: document.getElementById("editProductEnergy").value,
                    fat: document.getElementById("editProductFat").value,
                    saturatedFat: document.getElementById("editProductSaturatedFat").value,
                    carbohydrates: document.getElementById("editProductCarbs").value,
                    sugars: document.getElementById("editProductSugars").value,
                    fiber: document.getElementById("editProductFiber").value,
                    proteins: document.getElementById("editProductProteins").value,
                    salt: document.getElementById("editProductSalt").value
                };
                const res = await authRequest("/api/admin/products/" + encodeURIComponent(editingProductCode), payload, "PATCH");
                closeEditModal();
                setInventoryMsg(document.getElementById("adminInventoryMsg"), "Updated \"" + res.product.name + "\".", true);
                await loadInventory();
            } catch (err) {
                setInventoryMsg(document.getElementById("inventoryEditMsg"), err.message, false);
            } finally {
                saveBtn.disabled = false;
            }
        });
    }

    getFromServer("/api/auth/me").then(async function (data) {
        if (!data.user || !data.user.isAdmin) {
            window.location.href = "index.html";
            return;
        }
        inventoryPageEl.hidden = false;
        document.getElementById("inventoryAvatar").textContent = data.user.name.charAt(0).toUpperCase();
        document.getElementById("inventoryIdentity").textContent = data.user.name + " (" + data.user.email + ")";
        document.getElementById("inventoryRoleBadge").textContent = data.user.isOwnerAdmin ? "Default Admin" : "Admin";
        await loadInventory();
    }).catch(function () {
        window.location.href = "login.html";
    });
}