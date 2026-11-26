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

if (loginForm) {
    loginForm.addEventListener("submit", function (event) {
        event.preventDefault();
        window.location.href = "profile.html";
    });
}

if (signupForm) {
    signupForm.addEventListener("submit", function (event) {
        event.preventDefault();

        const password = document.getElementById("password").value;
        const confirm = document.getElementById("confirm").value;

        if (password !== confirm) {
            alert("Passwords do not match.");
            return;
        }

        window.location.href = "profile.html";
    });
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

const logoutBtn = document.getElementById("logoutBtn");

if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
        window.location.href = "login.html";
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