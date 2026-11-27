const ALIASES = {
    "peanut": ["peanut", "peanuts", "groundnut", "groundnuts", "arachis"],
    "peanuts": ["peanut", "peanuts", "groundnut", "groundnuts", "arachis"],
    "tree nut": ["almond", "hazelnut", "walnut", "cashew", "pecan", "pistachio", "macadamia", "brazil nut"],
    "gluten": ["gluten", "wheat", "barley", "rye", "malt", "triticale"],
    "dairy": ["milk", "casein", "whey", "lactose", "butter", "cream", "cheese", "ghee"],
    "soy": ["soy", "soya", "soybean"],
    "egg": ["egg", "albumin", "ovalbumin"],
    "fish": ["fish", "anchovy", "cod", "salmon", "tuna"],
    "shellfish": ["shellfish", "shrimp", "prawn", "crab", "lobster", "mollusc"]
};

const FOCUS_RULES = {
    "Low sugar": { key: "sugars", label: "sugar", direction: "lower", threshold: 5, unit: "g", id: "sugar" },
    "Low sodium": { key: "sodium", label: "sodium", direction: "lower", threshold: 0.12, unit: "g", id: "sodium" },
    "High protein": { key: "proteins", label: "protein", direction: "higher", threshold: 10, unit: "g", id: "protein" },
    "Low fat": { key: "fat", label: "fat", direction: "lower", threshold: 3, unit: "g", id: "fat" }
};

function normalizeText(value) {
    return String(value || "").normalize("NFKD").toLowerCase()
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, " ").trim();
}

function containsTerm(text, term) {
    const haystack = " " + normalizeText(text) + " ";
    const needle = " " + normalizeText(term) + " ";
    return needle.length > 2 && haystack.includes(needle);
}

function list(value) {
    if (Array.isArray(value)) return value.filter(function (item) { return typeof item === "string" && item.trim(); });
    return [];
}

function profileAllergies(profile) {
    return list(profile && profile.allergies).map(function (item) { return item.trim(); }).filter(Boolean);
}

function hasProductPreferences(profile) {
    return profileAllergies(profile).length > 0 ||
        list(profile && profile.focusOn).some(function (focus) { return Boolean(FOCUS_RULES[focus]); }) ||
        Boolean(profile && profile.diet && profile.diet !== "Non-veg");
}

function allergenSources(facts) {
    const safeFacts = facts || {};
    return {
        ingredients: safeFacts.ingredientsText || null,
        allergens: safeFacts.allergens || null,
        allergenTags: list(safeFacts.allergenTags).join(" "),
        traces: safeFacts.traces || null,
        traceTags: list(safeFacts.traceTags).join(" ")
    };
}

function hasPossibleAllergenMatch(avoidList, sources) {
    const sourceText = Object.values(sources).filter(Boolean).join(" ");
    for (const avoidItem of avoidList) {
        const key = normalizeText(avoidItem);
        const keyVariants = new Set([key]);
        if (key.endsWith("s")) keyVariants.add(key.slice(0, -1));
        else keyVariants.add(key + "s");
        const terms = new Set(keyVariants);
        for (const keyVariant of keyVariants) {
            const aliases = ALIASES[keyVariant];
            if (aliases) aliases.forEach(function (item) { terms.add(item); });
        }
        for (const [group, variants] of Object.entries(ALIASES)) {
            if (Array.from(keyVariants).some(function (keyVariant) { return variants.includes(keyVariant); })) {
                terms.add(group);
                variants.forEach(function (item) { terms.add(item); });
            }
        }
        if (Array.from(terms).some(function (term) { return containsTerm(sourceText, term); })) return true;
    }
    return false;
}

function numberFact(facts, key) {
    const nutrition = facts && facts.nutrition && facts.nutrition[key];
    if (!nutrition || !Number.isFinite(Number(nutrition.value))) return null;
    return {
        value: Number(nutrition.value),
        unit: nutrition.unit || "g",
        basis: nutrition.basis || "per 100 g"
    };
}

function showValue(fact) {
    return fact.value.toLocaleString("en", { maximumFractionDigits: 2 }) + " " + fact.unit + " " + fact.basis;
}

function assessFocus(focus, facts) {
    const rule = FOCUS_RULES[focus];
    const fact = numberFact(facts, rule.key);
    if (!fact) {
        if (focus === "Low sodium") {
            const salt = numberFact(facts, "salt");
            if (salt) {
                const match = salt.value <= 0.3;
                return {
                    id: "focus-sodium-" + (match ? "match" : "not-match"),
                    status: match ? "match" : "not_match",
                    focus,
                    value: salt,
                    threshold: { value: 0.3, unit: "g", basis: "per 100 g", comparator: "<=" },
                    text: "Salt is " + showValue(salt) + " and is used as a sodium proxy; the selected low-sodium comparison threshold is <= 0.3 g salt per 100 g."
                };
            }
        }
        return {
            id: "focus-" + rule.id + "-unknown",
            status: "unknown",
            focus,
            text: rule.label.charAt(0).toUpperCase() + rule.label.slice(1) + " data is not available, so this selected focus cannot be assessed."
        };
    }
    const match = rule.direction === "lower" ? fact.value <= rule.threshold : fact.value >= rule.threshold;
    const comparator = rule.direction === "lower" ? "<=" : ">=";
    return {
        id: "focus-" + rule.id + "-" + (match ? "match" : "not-match"),
        status: match ? "match" : "not_match",
        focus,
        value: fact,
        threshold: { value: rule.threshold, unit: rule.unit, basis: "per 100 g", comparator },
        text: rule.label.charAt(0).toUpperCase() + rule.label.slice(1) + " is " + showValue(fact) +
            "; selected comparison threshold is " + comparator + " " + rule.threshold + " " + rule.unit + " per 100 g."
    };
}

function dietStatus(diet, facts) {
    if (!diet || diet === "Non-veg") return { status: "not_applicable" };
    const tags = list(facts && facts.dietLabels).concat(list(facts && facts.ingredientAnalysisTags))
        .map(normalizeText);
    const has = function (tag) {
        return tags.some(function (value) { return value === tag || value.endsWith(" " + tag); });
    };
    if (diet === "Vegan") {
        if (has("non vegan")) return { status: "conflict", text: "Product classification includes a non-vegan label." };
        if (has("vegan")) return { status: "match", text: "Product data includes a vegan classification." };
        return { status: "unknown", text: "No confirmed vegan classification is available; ingredients may be incomplete." };
    }
    if (has("non vegetarian")) return { status: "conflict", text: "Product classification includes a non-vegetarian label." };
    if (diet === "Vegetarian" && has("non vegan") && !has("vegetarian")) {
        return { status: "unknown", text: "Product data does not confirm vegetarian compatibility." };
    }
    if (has("vegetarian") || has("vegan")) return { status: "match", text: "Product data includes a vegetarian classification." };
    return { status: "unknown", text: "No confirmed vegetarian classification is available; ingredients may be incomplete." };
}

function assessProduct(product, profile) {
    const facts = product && product.assessmentFacts ? product.assessmentFacts : {};
    const allergies = profileAllergies(profile);
    const sources = allergenSources(facts);
    const ingredientEvidence = Boolean(sources.ingredients);
    const allergenEvidence = Boolean(sources.allergens || sources.allergenTags);
    const traceEvidence = Boolean(sources.traces || sources.traceTags);
    const allergyIncomplete = allergies.length > 0 && !(ingredientEvidence && allergenEvidence && traceEvidence);
    const allergyConflict = allergies.length > 0 && hasPossibleAllergenMatch(allergies, sources);
    const reasons = [];
    const focusResults = {};
    let hasUnknown = false;
    let hasMatch = false;

    if (allergies.length) {
        if (allergyConflict) {
            reasons.push({
                id: "allergy-possible-conflict",
                kind: "caution",
                text: "Caution: a possible match for an item on your avoid-list appears in available ingredient, allergen or trace information. Check the package and allergen information."
            });
        } else if (allergyIncomplete) {
            reasons.push({
                id: "allergy-data-incomplete",
                kind: "unknown",
                text: "Caution: ingredient, allergen or trace information is incomplete. Check the package; missing data does not establish safety."
            });
        } else {
            reasons.push({
                id: "allergy-no-text-match",
                kind: "caution",
                text: "No possible text match was found in the available ingredient, allergen and trace fields. This does not establish that the product is safe for you."
            });
        }
    }

    const diet = dietStatus(profile && profile.diet, facts);
    if (diet.status === "match") {
        hasMatch = true;
        reasons.push({ id: "diet-match", kind: "match", text: diet.text });
    } else if (diet.status === "conflict") {
        reasons.push({ id: "diet-conflict", kind: "caution", text: diet.text });
    } else if (diet.status === "unknown") {
        hasUnknown = true;
        reasons.push({ id: "diet-unknown", kind: "unknown", text: diet.text });
    }

    const focuses = list(profile && profile.focusOn);
    focuses.forEach(function (focus) {
        if (!FOCUS_RULES[focus]) return;
        const result = assessFocus(focus, facts);
        focusResults[focus] = result;
        if (result.status === "match") hasMatch = true;
        if (result.status === "unknown") hasUnknown = true;
        reasons.push({
            id: result.id,
            kind: result.status === "match" ? "match" : result.status === "unknown" ? "unknown" : "neutral",
            text: result.text
        });
    });

    let status = "insufficient_data";
    if (allergyConflict || diet.status === "conflict") status = "caution";
    else if (allergies.length || allergyIncomplete || hasUnknown || diet.status === "unknown") status = "insufficient_data";
    else if (hasMatch) status = "matches_preferences";

    if (!profile || (!allergies.length && !focuses.length && !profile.diet)) {
        reasons.push({ id: "no-product-preferences", kind: "unknown", text: "No product-matching preferences were selected." });
        status = "insufficient_data";
    }

    return {
        status,
        allergyStatus: !allergies.length ? "not_applicable" : allergyConflict ? "possible_conflict" :
            allergyIncomplete ? "incomplete" : "no_possible_match",
        dietStatus: diet.status,
        reasons,
        cautions: reasons.filter(function (reason) { return reason.kind === "caution" || reason.kind === "unknown"; })
            .map(function (reason) { return reason.text; }),
        focusResults
    };
}

function alternativeAssessment(selectedProduct, candidate, profile) {
    const assessment = assessProduct(candidate, profile);
    if (assessment.allergyStatus === "possible_conflict" || assessment.dietStatus === "conflict") {
        return { eligible: false, status: "conflict", assessment, reasons: [] };
    }

    const allergies = profileAllergies(profile);
    if (allergies.length && assessment.allergyStatus === "incomplete") {
        return { eligible: false, status: "uncertain", assessment, reasons: [] };
    }
    if (assessment.dietStatus === "unknown" && profile && ["Vegetarian", "Eggetarian", "Vegan"].includes(profile.diet)) {
        return { eligible: false, status: "uncertain", assessment, reasons: [] };
    }

    const reasons = [];
    const selectedFocus = selectedProduct && selectedProduct.assessmentFacts ? assessProduct(selectedProduct, profile).focusResults : {};
    for (const focus of list(profile && profile.focusOn)) {
        const candidateResult = assessment.focusResults[focus];
        if (!candidateResult) continue;
        const selectedResult = selectedFocus[focus];
        if (selectedResult && selectedResult.value && candidateResult.value &&
            selectedResult.value.unit === candidateResult.value.unit &&
            selectedResult.value.basis === candidateResult.value.basis) {
            const direction = FOCUS_RULES[focus] && FOCUS_RULES[focus].direction ||
                (focus === "Low sodium" ? "lower" : "lower");
            const isBetter = direction === "higher"
                ? candidateResult.value.value > selectedResult.value.value
                : candidateResult.value.value < selectedResult.value.value;
            if (isBetter) {
                const text = "Compared with the selected product, this has " + focus.toLowerCase() + " (" +
                    showValue(candidateResult.value) + " versus " + showValue(selectedResult.value) + ").";
                reasons.push({ id: "comparison-" + candidateResult.id, text });
                continue;
            }
        }
        if (candidateResult.status === "match") {
            reasons.push({ id: candidateResult.id, text: candidateResult.text });
        }
    }
    if (assessment.dietStatus === "match") reasons.push({ id: "diet-match", text: "Product data includes a compatible diet classification." });
    if (!reasons.length) return { eligible: false, status: "not_matched", assessment, reasons: [] };
    assessment.reasons.forEach(function (reason) {
        if (reason.kind === "unknown" || reason.id === "allergy-no-text-match") {
            if (!reasons.some(function (item) { return item.id === reason.id; })) {
                reasons.push({ id: reason.id, text: reason.text });
            }
        }
    });

    const incomplete = assessment.allergyStatus === "incomplete" ||
        assessment.allergyStatus === "no_possible_match" ||
        Object.values(assessment.focusResults).some(function (result) { return result.status === "unknown"; });
    return {
        eligible: true,
        status: incomplete ? "uncertain" : "eligible",
        assessment,
        reasons
    };
}

function rankAlternatives(selectedProduct, candidates, profile, limit) {
    const eligible = [];
    const withheld = [];
    (Array.isArray(candidates) ? candidates : []).forEach(function (candidate) {
        const result = alternativeAssessment(selectedProduct, candidate, profile);
        if (!result.eligible) {
            if (result.status === "uncertain") withheld.push({ code: candidate.code, status: "uncertain" });
            return;
        }
        eligible.push({
            product: candidate,
            status: result.status,
            reasons: result.reasons,
            matchCount: result.reasons.filter(function (reason) {
                return reason.id === "diet-match" || reason.id.startsWith("comparison-") ||
                    /^focus-.*-match$/.test(reason.id);
            }).length
        });
    });
    eligible.sort(function (a, b) {
        return b.matchCount - a.matchCount || a.product.code.localeCompare(b.product.code);
    });
    return { eligible: eligible.slice(0, limit || 8), withheld };
}

module.exports = {
    assessProduct,
    alternativeAssessment,
    rankAlternatives,
    hasProductPreferences,
    hasPossibleAllergenMatch,
    assessFocus,
    dietStatus
};
