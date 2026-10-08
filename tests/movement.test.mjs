import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(
    new URL("../src/lib/movement.ts", import.meta.url),
    "utf8",
);
const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const {
    estimateSpeed,
    detectMovement,
    parseMovement,
    freshMovement,
    isStationaryMovement,
    EMPTY_MOVEMENT,
} = await import(
    `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);
const fix = { latitude: 0, longitude: 0, accuracy: 5, timestamp: 100000 };

test("GPS speed stays in m/s and rejects invalid speeds and poor accuracy", () => {
    assert.equal(estimateSpeed({ ...fix, speed: 10 }), 10);
    assert.equal(estimateSpeed({ ...fix, speed: 0 }), 0);
    for (const speed of [-1, Infinity, NaN, 101, null])
        assert.equal(estimateSpeed({ ...fix, speed }), null);
    assert.equal(estimateSpeed({ ...fix, speed: 10, accuracy: 200 }), null);
});

test("fallback divides distance by elapsed seconds, including across the date line", () => {
    const speed = estimateSpeed(
        { ...fix, longitude: 0.001, timestamp: 110000 },
        fix,
    );
    assert.ok(Math.abs(speed - 11.1195) < 0.01);
    assert.ok(
        Math.abs(
            estimateSpeed(
                { ...fix, longitude: -179.9995, timestamp: 110000 },
                { ...fix, longitude: 179.9995 },
            ) - speed,
        ) < 0.01,
    );
});

test("GPS drift, duplicate times, gaps, and impossible jumps do not imply movement", () => {
    assert.equal(
        estimateSpeed({ ...fix, longitude: 0.00001, timestamp: 110000 }, fix),
        null,
    );
    for (const timestamp of [99000, 100000, 101000, 300000])
        assert.equal(
            estimateSpeed({ ...fix, longitude: 0.001, timestamp }, fix),
            null,
        );
    assert.equal(
        estimateSpeed({ ...fix, longitude: 1, timestamp: 110000 }, fix),
        null,
    );
});

test("fallback activity is explicitly estimated and does not claim missing speed is stopped", () => {
    for (const [kmh, activity] of [
        [0, "stationary"],
        [5, "walking"],
        [20, "biking"],
        [60, "driving"],
    ]) {
        assert.deepEqual(detectMovement(kmh / 3.6, 100000), {
            speed: kmh / 3.6,
            activity,
            activitySource: "speed",
        });
    }
    assert.deepEqual(detectMovement(null, 100000), EMPTY_MOVEMENT);
});

test("confident motion readings override speed estimates; stale and low confidence readings do not", () => {
    const motion = {
        timestamp: 100000,
        activities: { automotive: { detected: true, confidence: 2 } },
    };
    assert.equal(detectMovement(2, 100000, motion).activity, "driving");
    assert.equal(detectMovement(null, 100000, motion).activitySource, "sensor");
    assert.equal(detectMovement(2, 161000, motion).activitySource, "speed");
    assert.equal(detectMovement(2, 99000, motion).activitySource, "speed");
    motion.activities.automotive.confidence = 0;
    assert.equal(detectMovement(2, 100000, motion).activitySource, "speed");
});

test("legacy and malformed payloads stay compatible, stale movement disappears", () => {
    assert.deepEqual(parseMovement({}), EMPTY_MOVEMENT);
    assert.deepEqual(
        parseMovement({
            speed: -1,
            activity: "flying",
            activitySource: "sensor",
        }),
        EMPTY_MOVEMENT,
    );
    const movement = detectMovement(10, 100000);
    const recordedAt = new Date(100000).toISOString();
    assert.deepEqual(freshMovement(movement, recordedAt, 110000), movement);
    assert.deepEqual(
        freshMovement(movement, recordedAt, 200000),
        EMPTY_MOVEMENT,
    );
    assert.deepEqual(
        freshMovement(movement, undefined, 110000),
        EMPTY_MOVEMENT,
    );
});

test("stationary hides movement indicators regardless of speed; moving and unknown keep theirs", () => {
    assert.equal(
        isStationaryMovement({
            speed: 0,
            activity: "stationary",
            activitySource: "speed",
        }),
        true,
    );
    assert.equal(
        isStationaryMovement({
            speed: null,
            activity: "stationary",
            activitySource: "sensor",
        }),
        true,
    );
    assert.equal(
        isStationaryMovement({
            speed: 2.5,
            activity: "stationary",
            activitySource: "speed",
        }),
        true,
    );
    assert.equal(isStationaryMovement(detectMovement(0, 100000)), true);
    assert.equal(
        isStationaryMovement({
            speed: 5 / 3.6,
            activity: "walking",
            activitySource: "speed",
        }),
        false,
    );
    assert.equal(
        isStationaryMovement({
            speed: null,
            activity: "driving",
            activitySource: "sensor",
        }),
        false,
    );
    assert.equal(isStationaryMovement(EMPTY_MOVEMENT), false);
    assert.equal(isStationaryMovement(null), false);
    assert.equal(isStationaryMovement(undefined), false);
});
