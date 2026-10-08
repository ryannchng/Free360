import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(
    new URL("../src/lib/setup-code.ts", import.meta.url),
    "utf8",
);
const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const { normalizeSetupCode, isSetupCodeValid, formatSetupCode } = await import(
    `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

test("spaces and hyphens are removed, digits preserved", () => {
    assert.equal(normalizeSetupCode("1234 5678-9012 3456"), "1234567890123456");
    assert.equal(normalizeSetupCode("1234-5678-9012-3456"), "1234567890123456");
    assert.equal(
        normalizeSetupCode("  1234567890123456  "),
        "1234567890123456",
    );
});

test("leading zeros are retained and valid", () => {
    assert.equal(normalizeSetupCode("0000 0000 0000 0001"), "0000000000000001");
    assert.equal(isSetupCodeValid("0000 0000 0000 0001"), true);
    assert.equal(isSetupCodeValid("0000000000000000"), true);
});

test("other characters are not silently discarded", () => {
    assert.equal(normalizeSetupCode("1234a56789012345").includes("a"), true);
    assert.equal(isSetupCodeValid("1234a56789012345"), false);
    assert.equal(isSetupCodeValid("1234_5678_9012_3456"), false);
    assert.equal(isSetupCodeValid("1234.5678.9012.3456"), false);
    assert.equal(isSetupCodeValid("1234/5678/9012/3456"), false);
    assert.equal(isSetupCodeValid("+123456789012345"), false);
    assert.equal(isSetupCodeValid("١٢٣٤٥٦٧٨٩٠١٢٣٤٥٦"), false);
    assert.equal(isSetupCodeValid("１２３４５６７８９０１２３４５６"), false);
});

test("exactly 16 ASCII digits required", () => {
    assert.equal(isSetupCodeValid("123456789012345"), false);
    assert.equal(isSetupCodeValid("1234567890123456"), true);
    assert.equal(isSetupCodeValid("12345678901234567"), false);
    assert.equal(isSetupCodeValid(""), false);
    assert.equal(isSetupCodeValid("    -  - "), false);
    assert.equal(isSetupCodeValid("1234 5678 9012 345"), false);
});

test("grouped display uses single spaces every 4 digits", () => {
    assert.equal(formatSetupCode("1234567890123456"), "1234 5678 9012 3456");
    assert.equal(formatSetupCode("1234-5678-9012-3456"), "1234 5678 9012 3456");
    assert.equal(formatSetupCode("12345"), "1234 5");
    assert.equal(formatSetupCode("1"), "1");
    assert.equal(formatSetupCode(""), "");
    assert.equal(formatSetupCode("0000000000000001"), "0000 0000 0000 0001");
});

test("paste with separators formats to grouped display", () => {
    assert.equal(formatSetupCode("1234 5678 9012 3456"), "1234 5678 9012 3456");
    assert.equal(
        isSetupCodeValid(formatSetupCode("1234-5678-9012-3456")),
        true,
    );
});
