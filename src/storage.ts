import { normalizeSettings } from './settings';
import type { Session, Settings, Source } from './types';

const PREF = 'extensions.paperlens.settings';
const ORIGIN = 'chrome://paperlens';
const REALM = 'PaperLens AI service';
const LEGACY_KEY_USERNAME = 'api-key';
const EASYSCHOLAR_KEY_USERNAME = 'easyscholar';
const keyUsername = (providerID: string) => `provider:${providerID}`;

export class Storage {
  private directory = PathUtils.join(Zotero.DataDirectory.dir, 'paperlens');
  private sessions = new Map<string, Session>();
  private sessionLoads = new Map<string, Promise<Session>>();
  private writes = new Map<string, Promise<void>>();

  async init() { await IOUtils.makeDirectory(this.directory, { ignoreExisting: true }); }

  async getSettings(): Promise<Settings> {
    const value = Zotero.Prefs.get(PREF, true);
    let parsed: unknown;
    try { parsed = value ? JSON.parse(value) : undefined; } catch { parsed = undefined; }
    const settings = normalizeSettings(parsed);
    const logins = await Services.logins.searchLoginsAsync({ origin: ORIGIN, httpRealm: REALM });
    const keys = new Map<string, string>();
    for (const login of logins) {
      if (login.username && !keys.has(login.username)) keys.set(login.username, login.password || '');
    }
    const legacyKey = keys.get(LEGACY_KEY_USERNAME) || '';
    settings.providers = settings.providers.map((provider, index) => ({
      ...provider,
      apiKey: keys.get(keyUsername(provider.id)) || (index === 0 ? legacyKey : ''),
    }));
    settings.easyScholarApiKey = keys.get(EASYSCHOLAR_KEY_USERNAME) || '';
    return settings;
  }

  async saveSettings(settings: Settings) {
    const normalized = normalizeSettings(settings);
    const existing = await Services.logins.searchLoginsAsync({ origin: ORIGIN, httpRealm: REALM });
    const wanted = new Map(normalized.providers.map(provider => [keyUsername(provider.id), provider]));
    for (const [username, provider] of wanted) {
      const matches = existing.filter((login: any) => login.username === username);
      if (provider.apiKey) {
        const info = Components.classes['@mozilla.org/login-manager/loginInfo;1']
          .createInstance(Components.interfaces.nsILoginInfo);
        info.init(ORIGIN, null, REALM, username, provider.apiKey.trim(), '', '');
        if (matches.length) {
          Services.logins.modifyLogin(matches[0], info);
          for (const duplicate of matches.slice(1)) Services.logins.removeLogin(duplicate);
        } else await Services.logins.addLoginAsync(info);
      } else {
        for (const match of matches) Services.logins.removeLogin(match);
      }
    }
    for (const login of existing) {
      if (!wanted.has(login.username) && login.username !== EASYSCHOLAR_KEY_USERNAME) {
        Services.logins.removeLogin(login);
      }
    }
    const easyScholarMatches = existing.filter((login: any) => login.username === EASYSCHOLAR_KEY_USERNAME);
    if (normalized.easyScholarApiKey) {
      const info = Components.classes['@mozilla.org/login-manager/loginInfo;1']
        .createInstance(Components.interfaces.nsILoginInfo);
      info.init(ORIGIN, null, REALM, EASYSCHOLAR_KEY_USERNAME, normalized.easyScholarApiKey.trim(), '', '');
      if (easyScholarMatches.length) {
        Services.logins.modifyLogin(easyScholarMatches[0], info);
        for (const duplicate of easyScholarMatches.slice(1)) Services.logins.removeLogin(duplicate);
      } else await Services.logins.addLoginAsync(info);
    } else {
      for (const match of easyScholarMatches) Services.logins.removeLogin(match);
    }
    const { easyScholarApiKey: _easyScholarApiKey, ...preferences } = normalized;
    const plain = {
      ...preferences,
      providers: normalized.providers.map(({ apiKey: _apiKey, ...provider }) => ({
        ...provider,
        name: provider.name.trim(),
        baseURL: provider.baseURL.trim(),
        model: provider.model.trim(),
      })),
    };
    Zotero.Prefs.set(PREF, JSON.stringify(plain), true);
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
