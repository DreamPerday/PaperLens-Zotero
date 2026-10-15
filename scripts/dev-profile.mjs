import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { zipSync, strToU8 } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, 'output/zotero-dev');
const profile = join(directory, 'profile');
const data = join(directory, 'data');
const bridge = join(directory, 'bridge');
for (const path of [profile, data, bridge, join(profile, 'extensions')]) await mkdir(path, { recursive: true });
const manifest = JSON.parse(await readFile(resolve(root, 'addon/manifest.json'), 'utf8'));
await cp(resolve(root, `dist/paperlens-zotero-${manifest.version}.xpi`), join(profile, 'extensions', manifest.applications.zotero.id + '.xpi'));
const testID = 'paperlens-test@localhost';
const harness = (await readFile(resolve(root, 'scripts/test-bootstrap.js'), 'utf8')).replace('__BRIDGE_DIRECTORY__', JSON.stringify(bridge));
await writeFile(join(profile, 'extensions', testID + '.xpi'), zipSync({
  'manifest.json': strToU8(JSON.stringify({ manifest_version: 2, name: 'PaperLens development harness', version: '0.0.1',
    applications: { zotero: { id: testID, update_url: 'https://example.invalid/paperlens-test-updates.json', strict_min_version: '10.0', strict_max_version: '10.*' } } })),
  'bootstrap.js': strToU8(harness),
}));
const prefs = {
  'extensions.autoDisableScopes': 0, 'extensions.enabledScopes': 15, 'extensions.startupScanScopes': 15, 'xpinstall.signatures.required': false,
  'extensions.zotero.dataDir': data, 'extensions.zotero.useDataDir': true,
  'extensions.zotero.httpServer.port': 23129, 'extensions.zotero.sync.autoSync': false,
  'extensions.zotero.firstRun': false, 'app.update.auto': false, 'toolkit.telemetry.reportingpolicy.firstRun': false,
  'extensions.update.enabled': false,
  'browser.shell.checkDefaultBrowser': false,
  'marionette.port': 2829,
  'devtools.debugger.remote-enabled': true, 'devtools.debugger.prompt-connection': false,
  'devtools.debugger.force-local': true, 'devtools.chrome.enabled': true,
  'accessibility.force_disabled': 0,
};
await writeFile(join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n'));
console.log(`Isolated profile: ${profile}\nSynthetic test data: ${data}\nTest command directory: ${bridge}`);
if (process.argv.includes('--launch')) {
  const flag = process.argv.indexOf('--zotero');
  const executable = flag >= 0 ? process.argv[flag + 1] : 'zotero';
  const launchedAt = Date.now();
  const child = spawn(executable, ['-no-remote', '-profile', profile, '-start-debugger-server', '6101', '--remote-allow-system-access'], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  console.log(`Started test Zotero, PID ${child.pid}`);
  let ready = false;
  while (Date.now() - launchedAt < 45000) {
    try { ready = (await stat(join(bridge, 'ready.json'))).mtimeMs >= launchedAt; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('The isolated Zotero test harness did not become ready.');
  console.log('Isolated test harness ready.');
}
