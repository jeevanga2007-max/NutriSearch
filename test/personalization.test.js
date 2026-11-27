const test = require("node:test");
const assert = require("node:assert/strict");
const { assessProduct, rankAlternatives } = require("../services/personalization");

function product(code, overrides) {
    return {
        code,
        name: "Catalog product " + code,
        assessmentFacts: {
            ingredientsText: "Rice flour, salt",
            allergens: "None declared",
            allergenTags: [],
            traces: "None declared",
            traceTags: [],
            dietLabels: [],
            ingredientAnalysisTags: ["en:vegan"],
            nutrition: {
                sugars: { value: 2, unit: "g", basis: "per 100 g" },
                salt: { value: 0.2, unit: "g", basis: "per 100 g" },
                sodium: null,
                proteins: { value: 12, unit: "g", basis: "per 100 g" },
                fat: { value: 2, unit: "g", basis: "per 100 g" }
            },
            ...(overrides || {})
        }
    };
}

test("allergy aliases create a prominent possible-conflict caution", function () {
    const item = product("11111111", {
        ingredientsText: "Roasted groundnut oil, rice",
        traces: "May contain other seeds"
    });
    const result = assessProduct(item, { allergies: ["Peanuts"], focusOn: ["Low sugar"] });

    assert.strictEqual(result.status, "caution");
    assert.strictEqual(result.allergyStatus, "possible_conflict");
    assert.ok(result.cautions[0].includes("possible match"));
    assert.ok(result.reasons.some(function (reason) { return reason.id === "allergy-possible-conflict"; }));
});

test("missing allergy and nutrition fields remain unknown, not matches", function () {
    const item = product("22222222", {
        ingredientsText: null,
        allergens: null,
        allergenTags: [],
        traces: null,
        traceTags: [],
        dietLabels: [],
        ingredientAnalysisTags: [],
        nutrition: {}
    });
    const result = assessProduct(item, { allergies: ["Dairy"], diet: "Vegan", focusOn: ["Low sugar"] });

    assert.strictEqual(result.status, "insufficient_data");
    assert.strictEqual(result.allergyStatus, "incomplete");
    assert.ok(result.reasons.some(function (reason) { return reason.id === "allergy-data-incomplete"; }));
    assert.ok(result.reasons.some(function (reason) { return reason.id === "focus-sugar-unknown"; }));
    assert.strictEqual(result.dietStatus, "unknown");
    assert.ok(result.reasons.some(function (reason) { return reason.id === "diet-unknown"; }));
    assert.ok(result.reasons.every(function (reason) { return !reason.text.toLowerCase().includes("safe to eat"); }));
});

test("low sodium uses a labeled salt proxy and stated per-100-g threshold", function () {
    const item = product("33333333", {
        nutrition: {
            sugars: null,
            salt: { value: 0.2, unit: "g", basis: "per 100 g" },
            sodium: null,
            proteins: null,
            fat: null
        }
    });
    const result = assessProduct(item, { focusOn: ["Low sodium"] });
    const reason = result.reasons.find(function (itemReason) { return itemReason.id === "focus-sodium-match"; });

    assert.ok(reason);
    assert.ok(reason.text.includes("sodium proxy"));
    assert.ok(reason.text.includes("0.3 g salt per 100 g"));
});

test("alternatives with conflicts are excluded and incomplete allergy data is withheld", function () {
    const selected = product("44444444");
    const conflict = product("55555555", { ingredientsText: "Wheat flour, peanuts" });
    const incomplete = product("66666666", {
        ingredientsText: null,
        allergens: null,
        allergenTags: [],
        traces: null,
        traceTags: []
    });
    const candidate = product("77777777");
    candidate.assessmentFacts.nutrition.sugars.value = 1;
    const result = rankAlternatives(selected, [conflict, incomplete, candidate], {
        allergies: ["Peanuts"],
        diet: "Vegan",
        focusOn: ["Low sugar"]
    });

    assert.deepStrictEqual(result.eligible.map(function (item) { return item.product.code; }), ["77777777"]);
    assert.strictEqual(result.eligible[0].status, "uncertain");
    assert.ok(result.eligible[0].reasons[0].text.includes("1 g per 100 g versus 2 g per 100 g"));
    assert.deepStrictEqual(result.withheld, [{ code: "66666666", status: "uncertain" }]);
});

test("alternatives with no preference evidence are not recommended", function () {
    const selected = product("88888888");
    const candidate = product("99999999");
    candidate.assessmentFacts.nutrition.proteins.value = 5;

    const result = rankAlternatives(selected, [candidate], { focusOn: ["High protein"] });

    assert.deepStrictEqual(result.eligible, []);
});
