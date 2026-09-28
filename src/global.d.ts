declare module '*.css';

interface Window {
  desktop: {
    selectFiles(purpose: 'dossier' | 'profile'): Promise<string[]>;
    selectFolder(): Promise<string | null>;
    openExternal(url: string): Promise<void>;
    request(args: { endpoint: string; method?: string; body?: unknown }): Promise<Record<string, unknown>>;
    upload(args: { endpoint: string; paths: string[] }): Promise<Record<string, unknown>>;
    uploadBrowserFiles?(purpose: 'dossier' | 'profile'): Promise<Record<string, unknown> & { cancelled?: boolean; result?: unknown }>;
    download(args: { endpoint: string; suggestedName?: string }): Promise<{ ok?: boolean; cancelled?: boolean; filePath?: string; error?: string }>;
  };
}
