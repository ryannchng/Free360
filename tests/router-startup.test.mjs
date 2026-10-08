import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { patchNavigationContainer } from "../scripts/patch-expo-router.mjs";

const readRouter = (name) =>
    readFileSync(
        new URL(
            `../node_modules/expo-router/build/fork/${name}.js`,
            import.meta.url,
        ),
        "utf8",
    );
const installed = readRouter("NavigationContainer");
const stateDeclaration =
    "    const [lastUnhandledLink, setLastUnhandledLink] = react_1.default.useState();";
// Recover the original installed code to prove the test catches the reported race.
const stateEnd = installed.indexOf(stateDeclaration) + stateDeclaration.length;
const linkingStart = installed.indexOf(
    "    const { getInitialState }",
    stateEnd,
);
const original = (
    installed.slice(0, stateEnd) +
    "\n" +
    installed.slice(linkingStart)
).replace("    }, onUnhandledLinking);", "    }, setLastUnhandledLink);");

function harness(source, initialURL) {
    const states = [],
        refs = [],
        effects = [],
        invalidUpdates = [],
        actions = [];
    let mounted = false,
        listener;
    const react = {
        useState(initial) {
            const state = {
                value: typeof initial === "function" ? initial() : initial,
            };
            states.push(state);
            return [
                state.value,
                (update) => {
                    if (!mounted) invalidUpdates.push(update);
                    state.value =
                        typeof update === "function"
                            ? update(state.value)
                            : update;
                },
            ];
        },
        useRef(value) {
            const ref = { current: value };
            refs.push(ref);
            return ref;
        },
        useEffect(effect) {
            effects.push({ effect });
        },
        useMemo: (create) => create(),
        useCallback: (callback) => callback,
        useImperativeHandle() {},
        forwardRef: (component) => component,
    };
    const native = {
        DefaultTheme: {},
        validatePathConfig() {},
        useNavigationIndependentTree: () => false,
        getStateFromPath: (path) => ({
            routes: [{ name: path.split("?")[0], path }],
        }),
        getActionFromState: (state) => ({
            type: "NAVIGATE",
            payload: state.routes[0],
        }),
        BaseNavigationContainer: "BaseNavigationContainer",
        ThemeProvider: "ThemeProvider",
        LocaleDirContext: { Provider: "LocaleDir" },
        LinkingContext: { Provider: "Linking" },
        UNSTABLE_UnhandledLinkingContext: { Provider: "UnhandledLinking" },
    };
    const modules = {
        react,
        "react/jsx-runtime": { jsx: (type, props) => ({ type, props }) },
        "react-native": {
            I18nManager: { getConstants: () => ({ isRTL: false }) },
            Platform: { OS: "android" },
            Linking: {},
        },
        "expo-linking": {},
        "./useBackButton": { useBackButton() {} },
        "./useDocumentTitle": { useDocumentTitle() {} },
        "../imperative-api": { useImperativeApiEmitter() {} },
        "../utils/useLatestCallback": (callback) => callback,
        "../react-navigation/native": native,
        "./extractPathFromURL": {
            extractExpoPathFromURL: (_prefixes, url) =>
                url.replace(/^free360:\/\//, ""),
        },
    };
    function load(code) {
        const context = createContext({
            exports: {},
            process: { env: { NODE_ENV: "test" } },
            console,
            require: (name) => {
                if (!(name in modules))
                    throw Error(`Unexpected import: ${name}`);
                return modules[name];
            },
        });
        runInContext(code, context);
        return context.exports;
    }
    modules["./useLinking"] = load(readRouter("useLinking.native"));
    modules["./useThenable"] = load(readRouter("useThenable"));
    const { NavigationContainer } = load(source);
    NavigationContainer(
        {
            linking: {
                prefixes: [],
                getInitialURL: () => initialURL,
                subscribe(callback) {
                    listener = callback;
                    return () => {
                        listener = null;
                    };
                },
            },
        },
        null,
    );
    const navigation = {
        getCurrentRoute: () => ({ path: "map" }),
        getRootState: () => ({ routeNames: ["map", "activity", "invite"] }),
        dispatch: (action) => actions.push(action),
        resetRoot: (state) => actions.push(state),
    };
    return {
        states,
        invalidUpdates,
        actions,
        get lastUnhandledLink() {
            return states[0].value;
        },
        setRoute(path) {
            refs[0].current = {
                ...navigation,
                getCurrentRoute: () => ({ path }),
            };
        },
        commit() {
            mounted = true;
            for (const record of effects) record.cleanup = record.effect();
        },
        unmount() {
            for (const record of effects) record.cleanup?.();
            mounted = false;
        },
        link(url) {
            listener(url);
        },
    };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

test("original native initial-link promise reproduces a state update before commit", async () => {
    const url = deferred();
    const app = harness(original, url.promise);
    url.resolve("free360://activity");
    await settle();
    assert.equal(app.invalidUpdates.length, 1);
    assert.equal(app.lastUnhandledLink, "activity");
});

test("initial URL resolving before mount queues its path until the effect commits", async () => {
    const url = deferred();
    const app = harness(patchNavigationContainer(original), url.promise);
    url.resolve("free360://invite?code=0123456789012345");
    await settle();
    assert.equal(app.invalidUpdates.length, 0);
    assert.equal(app.lastUnhandledLink, undefined);
    app.commit();
    await settle();
    assert.equal(app.lastUnhandledLink, "invite?code=0123456789012345");
    assert.equal(app.invalidUpdates.length, 0);
    app.unmount();
});

test("normal post-mount resolution and later deep-link navigation still work", async () => {
    const url = deferred();
    const app = harness(patchNavigationContainer(original), url.promise);
    app.commit();
    url.resolve("free360://map");
    await settle();
    assert.equal(app.lastUnhandledLink, "map");
    app.setRoute("map");
    app.link("free360://activity");
    assert.equal(app.lastUnhandledLink, "activity");
    assert.equal(app.actions[0].type, "NAVIGATE");
    assert.equal(app.actions[0].payload.name, "activity");
    assert.equal(app.invalidUpdates.length, 0);
    app.unmount();
});

test("initial promise resolving after unmount cannot update navigation state", async () => {
    const url = deferred();
    const app = harness(patchNavigationContainer(original), url.promise);
    app.commit();
    app.unmount();
    url.resolve("free360://activity");
    await settle();
    assert.equal(app.lastUnhandledLink, undefined);
    assert.equal(app.invalidUpdates.length, 0);
});

test("synchronous launches defer state and preserve the onReady clearing of handled links", () => {
    const app = harness(patchNavigationContainer(original), "free360://map");
    assert.equal(app.invalidUpdates.length, 0);
    app.setRoute("map");
    app.commit();
    assert.equal(app.lastUnhandledLink, undefined);
    app.unmount();
});

test("effect cleanup and replay keep linking active under Strict Mode", async () => {
    const url = deferred();
    const app = harness(patchNavigationContainer(original), url.promise);
    app.commit();
    app.unmount();
    app.commit();
    url.resolve("free360://activity");
    await settle();
    assert.equal(app.lastUnhandledLink, "activity");
    assert.equal(app.invalidUpdates.length, 0);
    app.unmount();
});

test("postinstall patch is present, repeatable and fails safely if upstream code changes", () => {
    assert.ok(
        installed.includes(
            "// Free360: deliver initial linking state only after mount.",
        ),
    );
    const patched = patchNavigationContainer(original);
    assert.equal(patchNavigationContainer(patched), patched);
    assert.throws(
        () => patchNavigationContainer("incompatible upstream code"),
        /linking code changed/,
    );
});
