import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  session,
  type IpcMainInvokeEvent,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setDataRoot } from '../core/paths.js';
import { DeclgenService } from './backend/declgen-service.js';

const DEV_ORIGIN = 'http://127.0.0.1:5173';
const ALLOWED_DOC_EXTENSIONS = new Set(['.pdf', '.xlsx', '.csv', '.xml']);
let service: DeclgenService;

const grantedFiles = new Map<string, Set<'dossier' | 'profile'>>();
const grantedFolders = new Set<string>();

function preloadPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, 'preload.cjs');
}

function isTrustedRendererUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.origin === DEV_ORIGIN) return true;
    if (url.protocol !== 'file:') return false;
    const target = path.resolve(fileURLToPath(url));
    const distRoot = path.resolve(app.getAppPath(), 'dist');
    return (
      target === path.join(distRoot, 'index.html') ||
      target.startsWith(`${distRoot}${path.sep}`)
    );
  } catch {
    return false;
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url || event.sender.getURL();
  if (!isTrustedRendererUrl(url))
    throw new Error('Blocked IPC request from an untrusted renderer.');
}

async function canonicalPath(input: string): Promise<string> {
  return path.resolve(await fs.realpath(input));
}

async function grantFile(
  input: string,
  purpose: 'dossier' | 'profile',
): Promise<string> {
  const resolved = await canonicalPath(input);
  const purposes =
    grantedFiles.get(resolved) || new Set<'dossier' | 'profile'>();
  purposes.add(purpose);
  grantedFiles.set(resolved, purposes);
  return resolved;
}

async function requireGrantedFile(
  input: string,
  purpose: 'dossier' | 'profile',
): Promise<string> {
  const resolved = await canonicalPath(input);
  if (!grantedFiles.get(resolved)?.has(purpose))
    throw new Error(
      'Файлът не е разрешен. Изберете го от системния прозорец отново.',
    );
  return resolved;
}

async function requireGrantedFolder(input: string): Promise<string> {
  const resolved = await canonicalPath(input);
  if (!grantedFolders.has(resolved))
    throw new Error(
      'Папката не е разрешена. Изберете я от системния прозорец отново.',
    );
  return resolved;
}

function safeExternalUrl(raw: unknown): string {
  const url = new URL(String(raw ?? ''));
  if (url.protocol !== 'https:')
    throw new Error('Only HTTPS external links are allowed.');
  return url.href;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1540,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#09111f',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    if (new URL(devUrl).origin !== DEV_ORIGIN)
      throw new Error(`Unexpected dev-server origin: ${devUrl}`);
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }

  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      void shell.openExternal(safeExternalUrl(url));
    } catch {
      /* deny below */
    }
    return { action: 'deny' };
  });
}

function safeResult(error: unknown) {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

ipcMain.handle(
  'desktop:selectFiles',
  async (event, purpose: 'dossier' | 'profile') => {
    assertTrustedSender(event);
    const profile = purpose === 'profile';
    const filters = profile
      ? [{ name: 'XML declaration', extensions: ['xml'] }]
      : [
          {
            name: 'Declgen documents',
            extensions: ['pdf', 'xlsx', 'csv', 'xml'],
          },
        ];
    const properties: Array<'openFile' | 'multiSelections'> = profile
      ? ['openFile']
      : ['openFile', 'multiSelections'];
    const result = await dialog.showOpenDialog({ properties, filters });
    if (result.canceled) return [];
    const granted: string[] = [];
    for (const file of result.filePaths) {
      if (
        profile
          ? path.extname(file).toLowerCase() !== '.xml'
          : !ALLOWED_DOC_EXTENSIONS.has(path.extname(file).toLowerCase())
      )
        continue;
      granted.push(await grantFile(file, profile ? 'profile' : 'dossier'));
    }
    return granted;
  },
);

ipcMain.handle('desktop:selectFolder', async (event) => {
  assertTrustedSender(event);
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  const resolved = await canonicalPath(result.filePaths[0]);
  grantedFolders.add(resolved);
  return resolved;
});

ipcMain.handle('desktop:openExternal', async (event, url) => {
  assertTrustedSender(event);
  await shell.openExternal(safeExternalUrl(url));
});

ipcMain.handle(
  'declgen:request',
  async (
    event,
    args: { endpoint: string; method?: string; body?: unknown },
  ) => {
    try {
      assertTrustedSender(event);
      const method = (args.method || 'GET').toUpperCase();
      const body =
        args.body && typeof args.body === 'object'
          ? (structuredClone(args.body) as Record<string, unknown>)
          : {};
      if (method === 'POST' && args.endpoint === '/api/dossier/select_folder') {
        body.path = await requireGrantedFolder(String(body.path || ''));
      }
      return await service.request(args.endpoint, method, body);
    } catch (error) {
      return safeResult(error);
    }
  },
);

ipcMain.handle(
  'declgen:upload',
  async (event, args: { endpoint: string; paths: string[] }) => {
    try {
      assertTrustedSender(event);
      if (args.endpoint === '/api/profile_import/inspect') {
        if (args.paths?.length !== 1)
          throw new Error('Изберете точно един XML файл.');
        const file = await requireGrantedFile(args.paths[0], 'profile');
        return await service.profileInspect(file);
      }
      if (args.endpoint === '/api/dossier/upload') {
        const files = await Promise.all(
          (args.paths || []).map((p) => requireGrantedFile(p, 'dossier')),
        );
        return await service.uploadPaths(files);
      }
      throw new Error(`unsupported local upload endpoint: ${args.endpoint}`);
    } catch (error) {
      return safeResult(error);
    }
  },
);

ipcMain.handle(
  'declgen:download',
  async (event, args: { endpoint: string; suggestedName?: string }) => {
    try {
      assertTrustedSender(event);
      let source: string | null = null;
      if (args.endpoint === '/api/download/case_package')
        source = service.casePackage;
      if (!source) throw new Error('Няма готов файл за изтегляне.');
      const resolvedSource = await canonicalPath(source);
      const result = await dialog.showSaveDialog({
        defaultPath: args.suggestedName || path.basename(resolvedSource),
      });
      if (result.canceled || !result.filePath)
        return { ok: false, cancelled: true };
      await fs.copyFile(resolvedSource, result.filePath);
      return { ok: true, filePath: result.filePath };
    } catch (error) {
      return safeResult(error);
    }
  },
);

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  const root =
    process.env.DECLGEN_DATA_ROOT ||
    path.join(app.getPath('userData'), 'declgen-data');
  setDataRoot(root);
  service = new DeclgenService();
  await service.init();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
