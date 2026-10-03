import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = dirname(require.resolve('leaflet/package.json'));
const target = new URL('../assets/leaflet/', import.meta.url);
mkdirSync(target, { recursive: true });
writeFileSync(new URL('bundle.json', target), JSON.stringify({
  js: readFileSync(join(root, 'dist/leaflet.js'), 'utf8').replace(/\/\/# sourceMappingURL=.*$/m, ''),
  css: readFileSync(join(root, 'dist/leaflet.css'), 'utf8'),
}));
writeFileSync(new URL('LICENSE', target), readFileSync(join(root, 'LICENSE')));
