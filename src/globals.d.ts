declare global {
  const Zotero: any;
  const Services: any;
  const IOUtils: any;
  const PathUtils: any;
  const ChromeUtils: any;
  const Components: any;
  interface Window {
    PaperLensUI: {
      mount(bridge: import('./types').Bridge): () => void;
      mountTranslation(bridge: import('./types').TranslationBridge): () => void;
    };
  }
}
export {};
