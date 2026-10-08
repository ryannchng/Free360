import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(
    new URL("../src/lib/map-region.ts", import.meta.url),
    "utf8",
);
const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const region = await import(
    `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

test("coordinate validation rejects empty/malformed values", () => {
    assert.equal(region.isValidCoordinate(null), false);
    assert.equal(region.isValidCoordinate(undefined), false);
    assert.equal(region.isValidCoordinate("51,0"), false);
    assert.equal(region.isValidCoordinate({}), false);
    assert.equal(
        region.isValidCoordinate({ latitude: NaN, longitude: 0 }),
        false,
    );
    assert.equal(
        region.isValidCoordinate({ latitude: 91, longitude: 0 }),
        false,
    );
    assert.equal(
        region.isValidCoordinate({ latitude: 0, longitude: 181 }),
        false,
    );
    assert.equal(
        region.isValidCoordinate({ latitude: "51", longitude: 0 }),
        false,
    );
    assert.equal(
        region.isValidCoordinate({ latitude: 51.5, longitude: -0.1 }),
        true,
    );
});

test("first valid shared location wins; malformed entries skipped", () => {
    assert.deepEqual(region.firstValidCoordinate([]), null);
    assert.deepEqual(region.firstValidCoordinate([null, "x", {}]), null);
    assert.deepEqual(
        region.firstValidCoordinate([
            null,
            { latitude: 91, longitude: 0 },
            { latitude: 10, longitude: 20 },
            { latitude: 30, longitude: 40 },
        ]),
        { latitude: 10, longitude: 20 },
    );
});

test("center priority: live > shared > home > broad fallback (no location request)", () => {
    const shared = { latitude: 10, longitude: 20 };
    const home = { latitude: 51, longitude: -1 };
    const live = { latitude: 40, longitude: -70 };

    assert.deepEqual(
        region.resolveMapCenter({
            currentCoordinate: live,
            locationEnabled: true,
            sharedCoordinates: [shared],
            home,
        }),
        { center: live, source: "live" },
    );
    // Live coordinate ignored when sharing is off.
    assert.deepEqual(
        region.resolveMapCenter({
            currentCoordinate: live,
            locationEnabled: false,
            sharedCoordinates: [shared],
            home,
        }),
        { center: shared, source: "shared" },
    );
    assert.deepEqual(
        region.resolveMapCenter({ sharedCoordinates: [null, shared], home }),
        { center: shared, source: "shared" },
    );
    assert.deepEqual(region.resolveMapCenter({ sharedCoordinates: [], home }), {
        center: home,
        source: "home",
    });
    const fallback = region.resolveMapCenter({
        sharedCoordinates: [null],
        home: null,
    });
    assert.equal(fallback.source, "fallback");
    assert.equal(region.isValidCoordinate(fallback.center), true);
});

test("fallback region is broad and renderable; real locations use near delta", () => {
    const fallback = region.resolveInitialRegion({
        sharedCoordinates: [],
        home: null,
    });
    assert.equal(fallback.source, "fallback");
    assert.ok(fallback.latitudeDelta >= 10 && fallback.longitudeDelta >= 10);
    const near = region.resolveInitialRegion({
        sharedCoordinates: [{ latitude: 10, longitude: 20 }],
    });
    assert.equal(near.source, "shared");
    assert.equal(near.latitudeDelta, region.MAP_NEAR_DELTA);
    assert.deepEqual(
        region.regionForCenter({ latitude: 1, longitude: 2 }, "fallback"),
        region.MAP_FALLBACK_REGION,
    );
});

test("group region fits every member: spread zooms out, single/coincident stay bounded", () => {
    assert.equal(region.regionForCoordinates([]), null);
    assert.equal(
        region.regionForCoordinates([null, { latitude: 91, longitude: 0 }]),
        null,
    );
    const single = region.regionForCoordinates([
        { latitude: 43, longitude: -79 },
    ]);
    assert.deepEqual(single, {
        latitude: 43,
        longitude: -79,
        latitudeDelta: region.MAP_NEAR_DELTA,
        longitudeDelta: region.MAP_NEAR_DELTA,
    });
    const coincident = region.regionForCoordinates([
        { latitude: 43, longitude: -79 },
        { latitude: 43, longitude: -79 },
    ]);
    assert.equal(coincident.latitudeDelta, region.MAP_NEAR_DELTA);
    const spread = region.regionForCoordinates([
        { latitude: 40, longitude: -80 },
        { latitude: 50, longitude: -70 },
        { latitude: "invalid", longitude: 0 },
    ]);
    assert.equal(spread.latitude, 45);
    assert.equal(spread.longitude, -75);
    assert.ok(spread.latitudeDelta >= 10 && spread.longitudeDelta >= 10);
    const framed = region.boundsForRegion(spread);
    assert.ok(
        framed.south <= 40 &&
            framed.north >= 50 &&
            framed.west <= -80 &&
            framed.east >= -70,
    );
});

test("outside-fit check gates refits: inside stays, outside refits, empty never resets", () => {
    const fitted = region.boundsForRegion(
        region.regionForCoordinates([
            { latitude: 43, longitude: -79 },
            { latitude: 44, longitude: -78 },
        ]),
    );
    assert.equal(region.isGroupOutsideFit([], fitted), false);
    assert.equal(region.isGroupOutsideFit([], null), false);
    assert.equal(
        region.isGroupOutsideFit(
            [{ latitude: 43.5, longitude: -78.5 }],
            fitted,
        ),
        false,
    );
    assert.equal(
        region.isGroupOutsideFit([{ latitude: 43.5, longitude: -78.5 }], null),
        true,
    );
    assert.equal(
        region.isGroupOutsideFit([{ latitude: 60, longitude: 0 }], fitted),
        true,
    );
    // Hysteresis: just outside the edge stays, clearly outside refits.
    const edge = fitted.north + region.MAP_NEAR_DELTA * 0.05;
    const clear = fitted.north + (fitted.north - fitted.south) * 0.5;
    assert.equal(
        region.isGroupOutsideFit(
            [{ latitude: edge, longitude: -78.5 }],
            fitted,
        ),
        false,
    );
    assert.equal(
        region.isGroupOutsideFit(
            [{ latitude: clear, longitude: -78.5 }],
            fitted,
        ),
        true,
    );
});
