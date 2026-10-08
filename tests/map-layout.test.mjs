import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

test("map tab extends behind the status bar; other tabs keep full safe-area padding", () => {
    assert.match(
        app,
        /edges=\{activeTab === 'map' \? \['bottom', 'left', 'right'\] : undefined\}/,
    );
});

test("floating map overlays stay below the notch/status bar via the top inset", () => {
    assert.match(app, /useSafeAreaInsets\(\)\.top/);
    assert.match(app, /styles\.mapTopBar, \{ top: 12 \+ topInset \}/);
    assert.match(app, /styles\.mapTopOverlay, \{ top: 73 \+ topInset \}/);
    assert.match(app, /styles\.mapEmptyOverlay, \{ top: 132 \+ topInset \}/);
    // Base design offsets are preserved; only the inset is added.
    assert.match(app, /mapTopBar: \{[^}]*top: 12,/);
    assert.match(app, /mapTopOverlay: \{[^}]*top: 73,/);
    assert.match(app, /mapEmptyOverlay: \{[^}]*top: 132,/);
});

test("map and bottom sheet share theme tokens while the status bar stays dark", () => {
    assert.match(app, /mapAppRoot: \{ backgroundColor: COLORS.mapLand \}/);
    assert.match(app, /mapBottomCard: \{[^}]*bottom: 0,/);
    assert.match(app, /<StatusBar style="dark" \/>/);
    assert.ok(!/StatusBar[^>]*(backgroundColor|translucent)/.test(app));
});

test("other screens keep their existing safe-area behavior", () => {
    for (const file of readdirSync(new URL("../src/app", import.meta.url))) {
        if (!file.endsWith(".tsx")) continue;
        const source = readFileSync(
            new URL(`../src/app/${file}`, import.meta.url),
            "utf8",
        );
        assert.ok(
            !/edges=/.test(source),
            `${file} must not change safe-area edges`,
        );
    }
});
