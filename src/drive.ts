// Save/load the plan as an SVG file (a picture carrying the plan JSON, see planfile.ts), named
// after the plan, in the user's own Google Drive, straight from the browser. Older saves were a
// JSON file: still loaded.
// Google Identity Services gives the page a short-lived access token; the Drive REST API takes it.
// The drive.file scope only lets the app see files it created itself, plus files the user picks
// in the Google Picker (which grants access to just that file).

// Public OAuth client ID (type "Web application", see README). Empty hides the Drive menu entries.
export const CLIENT_ID: string = '148629905077-ae20c8e4opn5lhg6g9pe0f373q3dqpsh.apps.googleusercontent.com';

// Public browser API key (Picker API enabled, see README). Empty: "Load" opens the app's own file.
export const API_KEY: string = 'AIzaSyA7ZqJtoEfrqF3j1pfL0c3KBAyYfX8cV30';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const OLD_FILE_NAME = 'plan3d.json';
const API = 'https://www.googleapis.com';

interface TokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}
interface PickerDoc {
  id: string;
}
interface PickerData {
  action: string;
  docs?: PickerDoc[];
}
declare const gapi: { load(api: string, cb: () => void): void };
declare const google: {
  picker: {
    DocsView: new () => { setMimeTypes(m: string): unknown };
    PickerBuilder: new () => {
      addView(v: unknown): unknown;
      setOAuthToken(t: string): unknown;
      setDeveloperKey(k: string): unknown;
      setAppId(id: string): unknown;
      setCallback(cb: (d: PickerData) => void): unknown;
      build(): { setVisible(v: boolean): void };
    };
    Action: { PICKED: string; CANCEL: string };
  };
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (r: TokenResponse) => void;
        error_callback: (e: { type: string }) => void;
      }): TokenClient;
    };
  };
};

export const driveEnabled = CLIENT_ID !== '';

let token: { value: string; expires: number } | null = null;
let client: TokenClient | null = null;
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;

function loadScript(): Promise<void> {
  if (typeof google !== 'undefined') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not reach Google (offline?)'));
    document.head.appendChild(s);
  });
}

async function accessToken(): Promise<string> {
  if (token && Date.now() < token.expires) return token.value;
  await loadScript();
  client ??= google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: (r) => {
      if (r.access_token) {
        token = { value: r.access_token, expires: Date.now() + ((r.expires_in ?? 3600) - 60) * 1000 };
        pending?.resolve(r.access_token);
      } else {
        pending?.reject(new Error(r.error ?? 'Google sign-in failed'));
      }
      pending = null;
    },
    error_callback: (e) => {
      pending?.reject(new Error(e.type === 'popup_closed' ? 'Sign-in cancelled' : `Google sign-in failed (${e.type})`));
      pending = null;
    },
  });
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    client!.requestAccessToken();
  });
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(API + path, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${await accessToken()}` },
  });
  if (res.status === 401) token = null;
  if (!res.ok) throw new Error(`Drive error ${res.status}`);
  return res;
}

/** A file in the user's Drive, as the app knows it. */
export interface DriveFile {
  id: string;
  name: string;
}

async function findFile(q: string): Promise<DriveFile | null> {
  const res = await call(`/drive/v3/files?q=${encodeURIComponent(`${q} and trashed=false`)}&orderBy=modifiedTime desc&fields=files(id,name)`);
  const { files } = (await res.json()) as { files: DriveFile[] };
  return files[0] ?? null;
}

const byName = (name: string) => `name='${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function upload(meta: object, svg: string): RequestInit {
  const boundary = 'plan3d-boundary';
  return {
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body:
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\nContent-Type: image/svg+xml\r\n\r\n${svg}\r\n--${boundary}--`,
  };
}

/**
 * Saves the plan as `name`: into `file` (the one it was loaded from or last saved to, renamed if
 * the plan was), else into the app's newest file with that name, else a new file. Returns where.
 */
export async function saveToDrive(svg: string, name: string, file?: DriveFile | null): Promise<DriveFile> {
  const target = file ?? (await findFile(byName(name)));
  if (target) {
    try {
      const res = await call(`/upload/drive/v3/files/${target.id}?uploadType=multipart&fields=id,name`, { method: 'PATCH', ...upload({ name }, svg) });
      return (await res.json()) as DriveFile;
    } catch (err) {
      // the remembered file was deleted since: make a new one
      if (!file || !(err as Error).message.endsWith(' 404')) throw err;
    }
  }
  const res = await call('/upload/drive/v3/files?uploadType=multipart&fields=id,name', { method: 'POST', ...upload({ name, mimeType: 'image/svg+xml' }, svg) });
  return (await res.json()) as DriveFile;
}

const read = async (file: DriveFile) => ({ file, text: await (await call(`/drive/v3/files/${file.id}?alt=media`)).text() });

/** The newest plan the app saved (SVG, or the JSON from before), or null when nothing was saved yet. */
export async function loadFromDrive(): Promise<{ file: DriveFile; text: string } | null> {
  const file = (await findFile("mimeType='image/svg+xml'")) ?? (await findFile(byName(OLD_FILE_NAME)));
  return file && read(file);
}

export const pickerEnabled = driveEnabled && API_KEY !== '';

function loadPicker(): Promise<void> {
  if (typeof google !== 'undefined' && google.picker) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://apis.google.com/js/api.js';
    s.onload = () => gapi.load('picker', () => resolve());
    s.onerror = () => reject(new Error('Could not reach Google (offline?)'));
    document.head.appendChild(s);
  });
}

/** Lets the user choose any SVG/JSON plan in their Drive. Null when they cancel. */
export async function pickFromDrive(): Promise<{ file: DriveFile; text: string } | null> {
  const oauth = await accessToken();
  await loadPicker();
  const p = google.picker;
  const view = new p.DocsView();
  view.setMimeTypes('image/svg+xml,application/json');
  const id = await new Promise<string | null>((resolve) => {
    const builder = new p.PickerBuilder();
    builder.addView(view);
    builder.setOAuthToken(oauth);
    builder.setDeveloperKey(API_KEY);
    builder.setAppId(CLIENT_ID.split('-')[0]); // the Cloud project number
    builder.setCallback((data) => {
      if (data.action === p.Action.PICKED) resolve(data.docs?.[0]?.id ?? null);
      else if (data.action === p.Action.CANCEL) resolve(null);
    });
    builder.build().setVisible(true);
  });
  if (!id) return null;
  return read((await (await call(`/drive/v3/files/${id}?fields=id,name`)).json()) as DriveFile);
}
