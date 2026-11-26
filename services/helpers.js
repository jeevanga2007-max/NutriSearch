// Small helpers that turn product data into what the website shows.

// Nutri-Score is a letter a-e. Anything else means "unknown".
function cleanScore(grade) {
    const letter = String(grade || "").toLowerCase();
    return ["a", "b", "c", "d", "e"].includes(letter) ? letter : null;
}

function round(value) {
    return Math.round(value * 10) / 10;
}

// Split "Wheat flour (59%), Palm oil, Salt" into separate items,
// but do not split on commas that sit inside brackets.
function splitIngredients(text) {

    const items = [];
    let current = "";
    let depth = 0;

    for (const character of String(text || "")) {

        if (character === "(" || character === "[") depth++;
        if (character === ")" || character === "]") depth = Math.max(0, depth - 1);

        if ((character === "," || character === ";") && depth === 0) {
            items.push(current);
            current = "";
        } else {
            current += character;
        }
    }

    items.push(current);

    return items
        .map(function (item) { return item.replace(/_/g, "").trim(); })
        .filter(Boolean)
        .slice(0, 30);
}

// Nutrition table for the product page (per 100 g)
function buildNutrition(nutriments) {

    const rows = [
        { label: "Energy",        key: "energy-kcal_100g",   unit: "kcal" },
        { label: "Fat",           key: "fat_100g",           unit: "g" },
        { label: "Saturated fat", key: "saturated-fat_100g", unit: "g" },
        { label: "Carbohydrates", key: "carbohydrates_100g", unit: "g" },
        { label: "Sugars",        key: "sugars_100g",        unit: "g" },
        { label: "Fibre",         key: "fiber_100g",         unit: "g" },
        { label: "Protein",       key: "proteins_100g",      unit: "g" },
        { label: "Salt",          key: "salt_100g",          unit: "g" }
    ];

    return rows
        .filter(function (row) { return typeof nutriments[row.key] === "number"; })
        .map(function (row) {
            return { label: row.label, value: round(nutriments[row.key]), unit: row.unit };
        });
}

// Simple "traffic light" tags, using the UK food-label limits per 100 g.
// Plain rules (no AI), general guidance only.
function buildHighlights(nutriments) {

    const values = {
        fat: nutriments["fat_100g"],
        saturates: nutriments["saturated-fat_100g"],
        sugars: nutriments["sugars_100g"],
        salt: nutriments["salt_100g"]
    };

    const rules = [
        { name: "fat",       label: "fat",           high: 17.5, low: 3.0 },
        { name: "saturates", label: "saturated fat", high: 5.0,  low: 1.5 },
        { name: "sugars",    label: "sugar",         high: 22.5, low: 5.0 },
        { name: "salt",      label: "salt",          high: 1.5,  low: 0.3 }
    ];

    const highlights = [];

    rules.forEach(function (rule) {
        const value = values[rule.name];

        if (typeof value !== "number") return;

        if (value > rule.high) {
            highlights.push({ text: "High " + rule.label, type: "warn" });
        } else if (value <= rule.low) {
            highlights.push({ text: "Low " + rule.label, type: "good" });
        }
    });

    return highlights;
}

module.exports = { cleanScore, splitIngredients, buildNutrition, buildHighlights };