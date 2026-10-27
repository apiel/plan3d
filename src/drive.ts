// Save/load the plan as one JSON file in the user's own Google Drive, straight from the browser.
// Google Identity Services gives the page a short-lived access token; the Drive REST API takes it.
// The drive.file scope only lets the app see files it created itself.

// Public OAuth client ID (type "Web application", see README). Empty hides the Drive menu entries.
export const CLIENT_ID: string = '148629905077-ae20c8e4opn5lhg6g9pe0f373q3dqpsh.apps.googleusercontent.com';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FILE_NAME = 'plan3d.json';
const API = 'https://www.googleapis.com';

interface TokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}
declare const google: {
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

async function findFile(): Promise<string | null> {
  const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
  const res = await call(`/drive/v3/files?q=${q}&orderBy=modifiedTime desc&fields=files(id)`);
  const { files } = (await res.json()) as { files: { id: string }[] };
  return files[0]?.id ?? null;
}

export async function saveToDrive(json: string): Promise<void> {
  const id = await findFile();
  if (id) {
    await call(`/upload/drive/v3/files/${id}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: json,
    });
    return;
  }
  const boundary = 'plan3d-boundary';
  const body =
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ name: FILE_NAME })}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
  await call('/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
}

/** The saved plan JSON, or null when nothing was saved yet. */
export async function loadFromDrive(): Promise<string | null> {
  const id = await findFile();
  if (!id) return null;
  return (await call(`/drive/v3/files/${id}?alt=media`)).text();
}
