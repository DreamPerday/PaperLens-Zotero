// Development harness, packaged ONLY by dev-profile.mjs into the isolated profile.
// It has no network endpoint and is never included in the PaperLens XPI.
var timer;
var stopped = false;
var lastID;
const directory = __BRIDGE_DIRECTORY__;

async function startup() {
  await Zotero.initializationPromise;
  const previous = PathUtils.join(directory, 'command.json');
  if (await IOUtils.exists(previous)) lastID = (await IOUtils.readJSON(previous)).id;
  await IOUtils.writeJSON(PathUtils.join(directory, 'ready.json'), { version: Zotero.version, dataDir: Zotero.DataDirectory.dir });
  async function tick() {
    if (stopped) return;
    const path = PathUtils.join(directory, 'command.json');
    try {
      if (await IOUtils.exists(path)) {
        const request = await IOUtils.readJSON(path);
        if (request.id !== lastID) {
          lastID = request.id;
          const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
          try {
            const result = await new AsyncFunction('Zotero', 'Services', 'IOUtils', 'PathUtils', 'ChromeUtils', 'Components', request.code)(Zotero, Services, IOUtils, PathUtils, ChromeUtils, Components);
            await IOUtils.writeJSON(PathUtils.join(directory, 'result.json'), { id: request.id, ok: true, result });
          } catch (error) {
            await IOUtils.writeJSON(PathUtils.join(directory, 'result.json'), { id: request.id, ok: false, error: String(error), stack: error.stack });
          }
        }
      }
    } catch (error) { Zotero.logError(error); }
    timer = setTimeout(tick, 250);
  }
  timer = setTimeout(tick, 250);
}
function shutdown() { stopped = true; clearTimeout(timer); }
function install() {}
function uninstall() {}
