import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// SDK 57's initial URL callback can resolve between render and commit.
// https://github.com/expo/expo/issues/49378
// Keep the fix reproducible on npm/EAS installs until an SDK-compatible release fixes it.
const MARKER = '// Free360: deliver initial linking state only after mount.';
const STATE = '    const [lastUnhandledLink, setLastUnhandledLink] = react_1.default.useState();';
const CALLBACK = '    }, setLastUnhandledLink);';
const GUARD = `
    ${MARKER}
    const linkingPhase = react_1.default.useRef('pending');
    const pendingLink = react_1.default.useRef(null);
    const onUnhandledLinking = react_1.default.useCallback((path) => {
        if (linkingPhase.current === 'mounted') {
            setLastUnhandledLink(path);
        } else if (linkingPhase.current === 'pending') {
            pendingLink.current = { path };
        }
    }, []);
    react_1.default.useEffect(() => {
        linkingPhase.current = 'mounted';
        const pending = pendingLink.current;
        pendingLink.current = null;
        if (pending) {
            // A synchronous launch may already have been handled by onReady.
            const currentPath = refContainer.current?.getCurrentRoute()?.path;
            setLastUnhandledLink(currentPath === pending.path ? undefined : pending.path);
        }
        return () => {
            linkingPhase.current = 'unmounted';
            pendingLink.current = null;
        };
    }, []);`;

export function patchNavigationContainer(source) {
  if (source.includes(MARKER)) return source;
  if (source.split(STATE).length !== 2 || source.split(CALLBACK).length !== 2) {
    throw new Error('Expo Router linking code changed. Review scripts/patch-expo-router.mjs against the installed version.');
  }
  return source.replace(STATE, STATE + GUARD).replace(CALLBACK, '    }, onUnhandledLinking);');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const target = new URL('../node_modules/expo-router/build/fork/NavigationContainer.js', import.meta.url);
  const source = readFileSync(target, 'utf8');
  const patched = patchNavigationContainer(source);
  if (source !== patched) writeFileSync(target, patched);
  console.log('[Free360] Expo Router startup linking guard applied.');
}
