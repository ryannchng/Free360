import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

async function load(relativePath) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    const javascript = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext },
    }).outputText;
    return import(
        `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
    );
}

const { isCreateCircleSuccess, resolveCreateCircleFailureMessage } = await load(
    "../src/lib/create-circle-result.ts",
);
const { formatSetupCode, isSetupCodeValid, SETUP_CODE_INPUT_MAX_LENGTH } =
    await load("../src/lib/setup-code.ts");

test("only an explicit ok:true record counts as success", () => {
    assert.equal(isCreateCircleSuccess({ ok: true }), true);
    assert.equal(isCreateCircleSuccess({ ok: true, extra: 1 }), true);
});

test("malformed, empty, and ok:false payloads are not success", () => {
    for (const data of [
        null,
        undefined,
        0,
        "",
        "ok",
        [],
        {},
        { ok: false },
        { ok: 0 },
        { ok: 1 },
        { ok: "true" },
        { ok: null },
        { error: "gone" },
    ]) {
        assert.equal(
            isCreateCircleSuccess(data),
            false,
            `should not succeed: ${JSON.stringify(data)}`,
        );
    }
});

test("malformed success payloads resolve to a sanitized creation error", () => {
    assert.equal(
        resolveCreateCircleFailureMessage(null, undefined),
        "Could not create the circle. Check your group server setup and try again.",
    );
    assert.equal(
        resolveCreateCircleFailureMessage({ ok: false }, undefined),
        "Could not create the circle. Check your group server setup and try again.",
    );
});

test("server-provided sanitized message wins over status mapping", () => {
    assert.equal(
        resolveCreateCircleFailureMessage(
            { error: "  That code was already used.  " },
            401,
        ),
        "That code was already used.",
    );
    assert.equal(
        resolveCreateCircleFailureMessage({ error: "x".repeat(500) }, 400)
            .length,
        200,
    );
});

test("HTTP failures fall back to status-mapped messages", () => {
    assert.equal(
        resolveCreateCircleFailureMessage({}, 401),
        "This device is not signed in. Reopen the app and try again.",
    );
    assert.equal(
        resolveCreateCircleFailureMessage({ error: "" }, 429),
        "Too many attempts. Wait a bit and try again.",
    );
    assert.equal(
        resolveCreateCircleFailureMessage({ error: 123 }, 400),
        "That setup code is not valid. Check the 16 digits and try again.",
    );
    assert.equal(
        resolveCreateCircleFailureMessage(null, 500),
        "Could not create the circle. Check your group server setup and try again.",
    );
});

test("overlong paste is preserved and stays invalid (never truncated to valid)", () => {
    const pasted17 = "12345678901234567";
    const displayed = formatSetupCode(pasted17);
    assert.equal(displayed, "1234 5678 9012 3456 7");
    assert.ok(
        displayed.length <= SETUP_CODE_INPUT_MAX_LENGTH,
        "bounded input must fit the whole paste",
    );
    assert.equal(isSetupCodeValid(displayed), false);
    assert.equal(
        isSetupCodeValid(formatSetupCode("1234 5678 9012 3456 7")),
        false,
    );
});
