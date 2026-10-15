import type { Session, Settings, Source } from './types';

export const DEFAULT_SETTINGS: Settings = {
  baseURL: 'https://api.openai.com/v1', apiKey: '', model: '', depth: 'standard', hints: true, contextChars: 32000,
};
const PREF = 'extensions.paperlens.settings';
const ORIGIN = 'chrome://paperlens';
const REALM = 'PaperLens AI service';

export class Storage {
  private directory = PathUtils.join(Zotero.DataDirectory.dir, 'paperlens');
  private sessions = new Map<string, Session>();
  private sessionLoads = new Map<string, Promise<Session>>();
  private writes = new Map<string, Promise<void>>();

  async init() { await IOUtils.makeDirectory(this.directory, { ignoreExisting: true }); }

  async getSettings(): Promise<Settings> {
    const value = Zotero.Prefs.get(PREF, true);
    const settings = { ...DEFAULT_SETTINGS, ...(value ? JSON.parse(value) : {}) };
    const logins = await Services.logins.searchLoginsAsync({ origin: ORIGIN, httpRealm: REALM });
    settings.apiKey = logins[0]?.password || '';
    return settings;
  }

  async saveSettings(settings: Settings) {
    const existing = await Services.logins.searchLoginsAsync({ origin: ORIGIN, httpRealm: REALM });
    const info = Components.classes['@mozilla.org/login-manager/loginInfo;1'].createInstance(Components.interfaces.nsILoginInfo);
    if (settings.apiKey) {
      info.init(ORIGIN, null, REALM, 'api-key', settings.apiKey.trim(), '', '');
      if (existing.length) Services.logins.modifyLogin(existing[0], info);
      else await Services.logins.addLoginAsync(info);
    } else {
      for (const login of existing) Services.logins.removeLogin(login);
    }
    const { apiKey: _apiKey, ...plain } = settings;
    Zotero.Prefs.set(PREF, JSON.stringify({ ...plain, baseURL: plain.baseURL.trim(), model: plain.model.trim() }), true);
  }

  private path(identity: string, suffix: string) { return PathUtils.join(this.directory, `${identity}.${suffix}.json`); }

  private async read(path: string) {
    if (!await IOUtils.exists(path)) return undefined;
    return IOUtils.readJSON(path);
  }

  private write(path: string, value: object): Promise<void> {
    const json = JSON.stringify(value);
    const next = (this.writes.get(path) || Promise.resolve()).catch(() => {}).then(() =>
      IOUtils.writeUTF8(path, json, { tmpPath: path + '.tmp' }));
    this.writes.set(path, next);
    return next;
  }

  async session(identity: string): Promise<Session> {
    if (this.sessions.has(identity)) return this.sessions.get(identity)!;
    if (this.sessionLoads.has(identity)) return this.sessionLoads.get(identity)!;
    const pending = this.loadSession(identity);
    this.sessionLoads.set(identity, pending);
    try { return await pending; } finally { this.sessionLoads.delete(identity); }
  }
  private async loadSession(identity: string): Promise<Session> {
    const session: Session = await this.read(this.path(identity, 'history')) || {
      identity, messages: [], draft: '', task: 'chat',
    };
    for (const message of session.messages) {
      if (message.status === 'streaming') { message.status = 'stopped'; message.error = '上次回答已中断，可以重试。'; }
    }
    this.sessions.set(identity, session);
    return session;
  }
  saveSession(session: Session) { return this.write(this.path(session.identity, 'history'), session); }
  source(identity: string): Promise<Source | undefined> { return this.read(this.path(identity, 'source')); }
  saveSource(source: Source) { return this.write(this.path(source.identity, 'source'), source); }
  async flush() { await Promise.all([...this.writes.values()].map(write => write.catch(e => Zotero.logError(e)))); }
}
