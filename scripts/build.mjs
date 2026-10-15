import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = resolve(root, 'build/addon');
const manifest = JSON.parse(await readFile(resolve(root, 'addon/manifest.json'), 'utf8'));
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(resolve(root, 'addon'), destination, { recursive: true });
const sidebar = join(destination, 'content/sidebar.xhtml');
await writeFile(sidebar, (await readFile(sidebar, 'utf8')).replaceAll('__VERSION__', manifest.version));
await cp(resolve(root, 'node_modules/katex/dist/katex.min.css'), join(destination, 'content/katex.min.css'));
await cp(resolve(root, 'node_modules/katex/dist/fonts'), join(destination, 'content/fonts'), { recursive: true });
await build({ entryPoints: [resolve(root, 'src/host.ts')], outfile: join(destination, 'content/host.js'),
  bundle: true, format: 'iife', globalName: 'PaperLensHost', target: 'firefox140', charset: 'utf8' });
await build({ entryPoints: [resolve(root, 'src/ui/index.tsx')], outfile: join(destination, `content/ui-${manifest.version}.js`),
  bundle: true, format: 'iife', target: 'firefox140', charset: 'utf8', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' } });
const entries = {};
async function collect(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) await collect(path);
    else entries[relative(destination, path).replaceAll('\\', '/')] = new Uint8Array(await readFile(path));
  }
}
await collect(destination);
await mkdir(resolve(root, 'dist'), { recursive: true });
const filename = `paperlens-zotero-${manifest.version}.xpi`;
await writeFile(resolve(root, 'dist', filename), zipSync(entries, { level: 6 }));
console.log(`Built dist/${filename} (${Object.keys(entries).length} packaged files)`);
