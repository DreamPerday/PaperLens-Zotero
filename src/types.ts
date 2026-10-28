export type Task = 'chat' | 'close' | 'overview' | 'verify';
export type Depth = 'simple' | 'standard' | 'deep';
export type Status = 'streaming' | 'complete' | 'stopped' | 'error';
export interface Location { pageIndex: number; rects?: number[][]; annotationID?: string }
export interface Quote { text: string; pageLabel: string; location: Location; blockIds?: string[] }
export interface Block { id: string; text: string; section: string; kind: string; pageLabel: string; location: Location; locations?: Location[]; excerpt?: boolean }
export interface Source { identity: string; version: string; title: string; itemID: number; blocks: Block[]; pageCount: number }
export interface AIConnection { baseURL: string; apiKey: string; model: string }
export interface AIProvider extends AIConnection { id: string; name: string }
export interface ProviderSummary { id: string; name: string; baseURL: string; model: string }
export interface Settings {
  providers: AIProvider[]; activeProviderId: string;
  depth: Depth; hints: boolean; contextChars: number; autoTranslate: boolean;
}
export interface TranslationState {
  quote: Quote; content: string; model: string; status: 'idle' | Status;
  autoTranslate: boolean; configured: boolean; error: string;
}
export interface TranslationBridge {
  subscribe(listener: (state: TranslationState) => void): () => void;
  translate(): Promise<void>; stop(): void; close(): void; copy(text: string): void;
  setAutoTranslate(value: boolean): Promise<void>; ask(): Promise<void>; openSettings(): void;
  move(dx: number, dy: number): void;
}
export interface Message {
  id: string; role: 'user' | 'assistant'; content: string; status: Status; task: Task;
  quote?: Quote; sourceIds?: string[]; sourceVersion?: string; model?: string; provider?: string;
  createdAt: string; error?: string; noteID?: number; range?: string;
}
export interface Session { identity: string; messages: Message[]; draft: string; task: Task; quote?: Quote }
export interface ViewState {
  title: string; identity: string; task: Task; quote?: Quote; messages: Message[]; draft: string;
  depth: Depth; hints: boolean; model: string; providerID: string; providerName: string; providers: ProviderSummary[];
  configured: boolean; readable: boolean; loading: boolean; busy: boolean;
  models: string[]; modelsLoading: boolean;
  activeSourceID?: string; activeMessageID?: string;
  error: string; notice: string; sourceInfo: string; returnAvailable: boolean;
}
export interface Bridge {
  mode: 'reader' | 'settings';
  closePanel?: () => void;
  subscribe(listener: (state: ViewState) => void): () => void;
  setTask(task: Task): void; setDraft(text: string): void; removeQuote(): void;
  setDepth(depth: Depth): Promise<void>;
  send(text: string, task?: Task): Promise<void>; retry(id: string): Promise<void>; stop(): void;
  navigate(id: string, messageID?: string): Promise<void>; returnToReading(): Promise<void>;
  saveNote(id: string): Promise<void>; openNote(id: number): Promise<void>;
  newConversation(): Promise<void>; refreshSource(): Promise<void>; openSettings(): void;
  refreshModels(): Promise<void>; setModel(model: string): Promise<void>; setProvider(id: string): Promise<void>;
  getSettings(): Promise<Settings>; saveSettings(settings: Settings): Promise<void>;
  models(provider: AIConnection): Promise<string[]>; testConnection(provider: AIConnection): Promise<string>;
  copy(text: string): void;
}
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
