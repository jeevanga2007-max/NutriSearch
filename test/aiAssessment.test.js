const test = require("node:test");
const assert = require("node:assert/strict");
const { getAiSelection, selectWithAi, validateSelection } = require("../services/aiAssessment");

const reasons = [
    { id: "sugar-match", text: "Sugar is 2 g per 100 g; selected threshold is <= 5 g." },
    { id: "allergy-caution", text: "Check ingredient and allergen information." }
];
const candidates = [{ id: "89012345", reasons: [{ id: "protein-match", text: "Protein is 12 g per 100 g." }] }];

test("AI selections are restricted to verified reason and product identifiers", async function () {
    let requestBody;
    const client = {
        interactions: {
            async create(request) {
                requestBody = request;
                return {
                    output_text: JSON.stringify({
                        explanation: "Review the selected sugar and allergen information.",
                        reasonIds: ["allergy-caution", "sugar-match"],
                        alternatives: [
                            { productId: "unknown-id", reasonIds: [] },
                            { productId: "89012345", reasonIds: ["protein-match"] }
                        ]
                    })
                };
            }
        }
    };
    const selection = await selectWithAi({
        client,
        model: "test-model",
        status: "caution",
        reasons,
        candidates
    });

    assert.deepStrictEqual(selection, {
        explanation: "Review the selected sugar and allergen information.",
        selectedReasonIds: ["allergy-caution", "sugar-match"],
        alternatives: [{ productId: "89012345", reasonIds: ["protein-match"] }]
    });
    assert.strictEqual(requestBody.response_format.type, "text");
    assert.strictEqual(requestBody.response_format.mime_type, "application/json");
    assert.deepStrictEqual(requestBody.response_format.schema, {
        type: "object",
        properties: {
            explanation: { type: "string" },
            reasonIds: { type: "array", items: { type: "string" } },
            alternatives: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        productId: { type: "string" },
                        reasonIds: { type: "array", items: { type: "string" } }
                    },
                    required: ["productId", "reasonIds"]
                }
            }
        },
        required: ["explanation", "reasonIds", "alternatives"]
    });
    assert.strictEqual(requestBody.store, false);
    assert.strictEqual(requestBody.generation_config.max_output_tokens, 300);
    assert.ok(requestBody.system_instruction.includes("untrusted data"));
});

test("unsupported model reason claims are rejected", function () {
    assert.throws(function () {
        validateSelection(
            { explanation: "Sugar is 2 g per 100 g.", reasonIds: ["invented-fact"], alternatives: [] },
            ["sugar-match"],
            candidates,
            3
        );
    }, /unsupported product reason/);
});

test("unsupported medical or nutrition claims in generated explanations are rejected", function () {
    assert.throws(function () {
        validateSelection(
            { explanation: "This product is healthy and safe.", reasonIds: ["sugar-match"], alternatives: [] },
            reasons,
            candidates,
            3
        );
    }, /unsupported or unsafe wording/);
});

test("generated explanations cannot introduce or restate numeric product facts", function () {
    assert.throws(function () {
        validateSelection(
            { explanation: "Sugar is 5 g per 100 g.", reasonIds: ["sugar-match"], alternatives: [] },
            reasons,
            candidates,
            3,
            "matches_preferences"
        );
    }, /unsupported or unsafe wording/);
});

test("AI explanations cannot contradict a deterministic caution status", function () {
    assert.throws(function () {
        validateSelection(
            { explanation: "This product appears to match your selected preferences.", reasonIds: ["allergy-caution"], alternatives: [] },
            reasons,
            candidates,
            3,
            "caution"
        );
    }, /contradicts the deterministic assessment status/);
});

test("AI provider failures return deterministic-fallback availability instead of throwing", async function () {
    const oldKey = process.env.GEMINI_API_KEY;
    const oldModel = process.env.GEMINI_MODEL;
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_MODEL = "test-model";
    try {
        const result = await getAiSelection({
            status: "matches_preferences",
            reasons,
            candidates,
            client: {
                interactions: {
                    async create() { throw new Error("provider unavailable"); }
                }
            }
        });
        assert.deepStrictEqual(result, {
            available: false,
            reason: "AI commentary and suggestions are temporarily unavailable."
        });
    } finally {
        if (oldKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = oldKey;
        if (oldModel === undefined) delete process.env.GEMINI_MODEL;
        else process.env.GEMINI_MODEL = oldModel;
    }
});

test("invalid Gemini output falls back instead of exposing an unsupported selection", async function () {
    const oldKey = process.env.GEMINI_API_KEY;
    const oldModel = process.env.GEMINI_MODEL;
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_MODEL = "test-model";
    try {
        const result = await getAiSelection({
            status: "caution",
            reasons,
            candidates,
            client: {
                interactions: {
                    async create() {
                        return {
                            output_text: JSON.stringify({
                                explanation: "Review this food label.",
                                reasonIds: ["unknown-reason"],
                                alternatives: []
                            })
                        };
                    }
                }
            }
        });
        assert.deepStrictEqual(result, {
            available: false,
            reason: "AI commentary and suggestions are temporarily unavailable."
        });
    } finally {
        if (oldKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = oldKey;
        if (oldModel === undefined) delete process.env.GEMINI_MODEL;
        else process.env.GEMINI_MODEL = oldModel;
    }
});

test("missing AI configuration uses the deterministic path", async function () {
    const oldKey = process.env.GEMINI_API_KEY;
    const oldModel = process.env.GEMINI_MODEL;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    try {
        const result = await getAiSelection({ reasons, candidates });
        assert.strictEqual(result.available, false);
        assert.ok(result.reason.includes("not configured"));
    } finally {
        if (oldKey !== undefined) process.env.GEMINI_API_KEY = oldKey;
        if (oldModel !== undefined) process.env.GEMINI_MODEL = oldModel;
    }
});
