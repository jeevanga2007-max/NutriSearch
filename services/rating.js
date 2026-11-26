// Turns a product's data into traffic-light tags and a short plain-language summary.
// Simple rules only, general guidance and not medical advice.
const { buildHighlights, cleanScore } = require("./helpers");

// Additives people commonly look out for
const WATCH_ADDITIVES = {
    e102: { name: "Tartrazine (colour)",           note: "may affect activity and attention in some children" },
    e104: { name: "Quinoline Yellow (colour)",     note: "may affect activity and attention in some children" },
    e110: { name: "Sunset Yellow (colour)",        note: "may affect activity and attention in some children" },
    e122: { name: "Carmoisine (colour)",           note: "may affect activity and attention in some children" },
    e124: { name: "Ponceau 4R (colour)",           note: "may affect activity and attention in some children" },
    e129: { name: "Allura Red (colour)",           note: "may affect activity and attention in some children" },
    e211: { name: "Sodium benzoate (preservative)", note: "a preservative common in soft drinks and sauces" },
    e250: { name: "Sodium nitrite (preservative)", note: "used in processed meats, best eaten in moderation" },
    e621: { name: "MSG (flavour enhancer)",        note: "some people are sensitive to it" },
    e951: { name: "Aspartame (sweetener)",         note: "not suitable for people with phenylketonuria" }
};

const SCORE_TEXT = {
    a: "Nutri-Score A: one of the more favourable choices.",
    b: "Nutri-Score B: a fairly good choice.",
    c: "Nutri-Score C: fine in moderation.",
    d: "Nutri-Score D: best kept as an occasional food.",
    e: "Nutri-Score E: best kept as an occasional treat."
};

// Accepts "en:milk,en:gluten" or ["en:milk", "en:gluten"]
function listOf(value) {
    if (Array.isArray(value)) return value;
    return String(value || "").split(",").map(function (item) { return item.trim(); }).filter(Boolean);
}

// "en:soybeans" -> "soybeans", "en:e150d" -> "e150d"
function cleanTag(tag) {
    return String(tag).replace(/^[a-z]{2}:/, "").replace(/-/g, " ").toLowerCase();
}

function joinWords(items) {
    if (items.length <= 1) return items.join("");
    return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

function analyse(doc) {

    const score = cleanScore(doc.nutriscore_grade);
    const highlights = buildHighlights(doc);          // sugar, fat, saturated fat, salt

    const allergens = listOf(doc.allergens).map(cleanTag);
    const additives = listOf(doc.additives_tags).map(cleanTag);
    const flagged = additives.filter(function (code) { return WATCH_ADDITIVES[code]; });
    const nova = Number(doc.nova_group);

    allergens.forEach(function (name) {
        highlights.push({ text: "Contains " + name, type: "warn" });
    });

    flagged.forEach(function (code) {
        highlights.push({ text: "Additive: " + WATCH_ADDITIVES[code].name, type: "warn" });
    });

    if (additives.length >= 5) {
        highlights.push({ text: additives.length + " additives", type: "warn" });
    }

    if (nova === 4) highlights.push({ text: "Ultra-processed", type: "warn" });
    if (nova === 1) highlights.push({ text: "Minimally processed", type: "good" });

    // Plain-language summary
    const high = highlights.filter(function (h) { return h.text.startsWith("High "); })
                           .map(function (h) { return h.text.slice(5); });
    const low = highlights.filter(function (h) { return h.text.startsWith("Low "); })
                          .map(function (h) { return h.text.slice(4); });

    const sentences = [];
    sentences.push(score ? SCORE_TEXT[score] : "This product has no Nutri-Score yet.");
    if (high.length) sentences.push("It is high in " + joinWords(high) + ".");
    if (low.length) sentences.push("It is low in " + joinWords(low) + ".");
    if (nova === 4) sentences.push("It is ultra-processed (NOVA group 4).");
    if (allergens.length) sentences.push("Allergens: " + joinWords(allergens) + ".");

    flagged.slice(0, 3).forEach(function (code) {
        sentences.push(WATCH_ADDITIVES[code].name + ": " + WATCH_ADDITIVES[code].note + ".");
    });

    return { highlights: highlights, summary: sentences.join(" ") };
}

module.exports = { analyse };