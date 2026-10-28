import { Plan, emptyPlan, parse, serialize } from './model';
import type { DriveFile } from './drive';

const STORAGE_KEY = 'plan3d.plan';

export function load(): Plan {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (text) return parse(text);
  } catch {
    // unreadable storage or a corrupt save: start empty
  }
  return emptyPlan();
}

export function save(plan: Plan): void {
  try {
    localStorage.setItem(STORAGE_KEY, serialize(plan));
  } catch {
    // storage blocked or full: the plan stays in memory
  }
}

// the Drive file the plan was loaded from or last saved to, so saving goes back there
const DRIVE_KEY = 'plan3d.driveFile';

export function loadDriveFile(): DriveFile | null {
  try {
    const f = JSON.parse(localStorage.getItem(DRIVE_KEY) ?? 'null');
    return f && typeof f.id === 'string' && typeof f.name === 'string' ? f : null;
  } catch {
    return null;
  }
}

export function saveDriveFile(file: DriveFile | null): void {
  try {
    if (file) localStorage.setItem(DRIVE_KEY, JSON.stringify(file));
    else localStorage.removeItem(DRIVE_KEY);
  } catch {
    // storage blocked: saving finds the file by name instead
  }
}
