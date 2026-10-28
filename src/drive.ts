// Save/load the plan as one SVG file (a picture carrying the plan JSON, see planfile.ts) in the
// user's own Google Drive, straight from the browser. Older saves were a JSON file: still loaded.
// Google Identity Services gives the page a short-lived access token; the Drive REST API takes it.
// The drive.file scope only lets the app see files it created itself, plus files the user picks
// in the Google Picker (which grants access to just that file).

// Public OAuth client ID (type "Web application", see README). Empty hides the Drive menu entries.
export const CLIENT_ID: string = '148629905077-ae20c8e4opn5lhg6g9pe0f373q3dqpsh.apps.googleusercontent.com';

// Public browser API key (Picker API enabled, see README). Empty: "Load" opens the app's own file.
export const API_KEY: string = 'AIzaSyA7ZqJtoEfrqF3j1pfL0c3KBAyYfX8cV30';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FILE_NAME = 'plan3d.svg';
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

async function findFile(name = FILE_NAME): Promise<string | null> {
  const q = encodeURIComponent(`name='${name}' and trashed=false`);
  const res = await call(`/drive/v3/files?q=${q}&orderBy=modifiedTime desc&fields=files(id)`);
  const { files } = (await res.json()) as { files: { id: string }[] };
  return files[0]?.id ?? null;
}

export async function saveToDrive(svg: string): Promise<void> {
  const id = await findFile();
  if (id) {
    await call(`/upload/drive/v3/files/${id}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'image/svg+xml' },
      body: svg,
    });
    return;
  }
  const boundary = 'plan3d-boundary';
  const body =
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ name: FILE_NAME, mimeType: 'image/svg+xml' })}\r\n` +
    `--${boundary}\r\nContent-Type: image/svg+xml\r\n\r\n${svg}\r\n--${boundary}--`;
  await call('/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
}

/** The saved plan file (SVG, or JSON from before), or null when nothing was saved yet. */
export async function loadFromDrive(): Promise<string | null> {
  const id = (await findFile()) ?? (await findFile(OLD_FILE_NAME));
  if (!id) return null;
  return (await call(`/drive/v3/files/${id}?alt=media`)).text();
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
export async function pickFromDrive(): Promise<string | null> {
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
  return (await call(`/drive/v3/files/${id}?alt=media`)).text();
}
