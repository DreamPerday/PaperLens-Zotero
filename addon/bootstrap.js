var chromeHandle;
var plugin;

async function startup({ id, version, rootURI }) {
  await Zotero.initializationPromise;
  const startupService = Components.classes["@mozilla.org/addons/addon-manager-startup;1"]
    .getService(Components.interfaces.amIAddonManagerStartup);
  chromeHandle = startupService.registerChrome(
    Services.io.newURI(rootURI + "manifest.json"), [["content", "paperlens", "content/"]]
  );
  const scope = { Zotero, Services, IOUtils, PathUtils, ChromeUtils, Components,
    fetch, XMLHttpRequest, TextDecoder, TextEncoder, URL, setTimeout, clearTimeout };
  Services.scriptloader.loadSubScript(rootURI + "content/host.js", scope);
  plugin = scope.PaperLensHost.createPlugin({ id, version, rootURI });
  Zotero.PaperLens = plugin;
  await plugin.start();
  for (const win of Zotero.getMainWindows()) plugin.addWindow(win);
}

function onMainWindowLoad({ window }) { plugin?.addWindow(window); }
function onMainWindowUnload({ window }) { plugin?.removeWindow(window); }
async function shutdown() {
  await plugin?.stop();
  delete Zotero.PaperLens;
  chromeHandle?.destruct();
  plugin = null;
}
function install() {}
function uninstall() {}
