import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = resolve(root, 'build/addon');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(resolve(root, 'addon'), destination, { recursive: true });
await build({ entryPoints: [resolve(root, 'src/host.ts')], outfile: join(destination, 'content/host.js'),
  bundle: true, format: 'iife', globalName: 'PaperLensHost', target: 'firefox140', charset: 'utf8' });
await build({ entryPoints: [resolve(root, 'src/ui/index.tsx')], outfile: join(destination, 'content/ui.js'),
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
const manifest = JSON.parse(await readFile(join(destination, 'manifest.json'), 'utf8'));
const filename = `paperlens-zotero-${manifest.version}.xpi`;
await writeFile(resolve(root, 'dist', filename), zipSync(entries, { level: 6 }));
console.log(`Built dist/${filename} (${Object.keys(entries).length} packaged files)`);
