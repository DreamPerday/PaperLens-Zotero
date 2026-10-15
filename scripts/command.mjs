import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../output/zotero-dev/bridge/', import.meta.url));
const code = await readFile(resolve(process.argv[2]), 'utf8');
const id = `${Date.now()}`;
await writeFile(resolve(directory, 'command.tmp'), JSON.stringify({ id, code }));
await rename(resolve(directory, 'command.tmp'), resolve(directory, 'command.json'));
const deadline = Date.now() + Number(process.env.PAPERLENS_TEST_TIMEOUT || 60000);
while (Date.now() < deadline) {
  try {
    const result = JSON.parse(await readFile(resolve(directory, 'result.json'), 'utf8'));
    if (result.id === id) {
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
      process.exit();
    }
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 300));
}
console.error('Timed out waiting for the isolated Zotero test harness.');
process.exitCode = 1;
