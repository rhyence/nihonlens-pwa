export const defaults = { php: '0.40' };
export type Settings = typeof defaults;

let database: Promise<IDBDatabase> | undefined;
function preferences() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('nihonlens', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('preferences');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Settings are open in another app window.'));
  });
  return database;
}

export async function loadSettings(): Promise<Settings> {
  try {
    const db = await preferences();
    const settings = await new Promise<Partial<Settings> | undefined>((resolve, reject) => {
      const request = db.transaction('preferences').objectStore('preferences').get('camera');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return { php: settings?.php?.trim() ? settings.php : defaults.php };
  } catch {
    return defaults;
  }
}

export async function saveSettings(settings: Settings) {
  const db = await preferences();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('preferences', 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.objectStore('preferences').put(settings, 'camera');
  });
}
