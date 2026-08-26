// Настройки подключения + локальный кэш конспектов в chrome.storage.local.
// Self-host: сервер не хранит ничего, поэтому готовые конспекты кэшируются в браузере.
// Кэш даёт «Недавние» в попапе и чтение во вкладке без повторного запроса; основной
// путь сохранения — экспорт .md (downloadBlob в format.ts).

export type Settings = {
  baseUrl?: string; // без хвостового слэша, напр. https://conspect.example.com
  sharedToken?: string;
};

export type Digest = {
  urlHash: string;
  url: string;
  ts: number; // unix-секунды
  title: string | null;
  channel: string | null;
  durationSec: number | null;
  lang: string | null;
  markdown: string;
};

const SETTINGS_KEY = "conspect_settings_v1";
const DIGESTS_KEY = "conspect_digests_v1";
const MAX_DIGESTS = 50;

export async function loadSettings(): Promise<Settings> {
  const v = await chrome.storage.local.get(SETTINGS_KEY);
  return (v[SETTINGS_KEY] as Settings | undefined) ?? {};
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: s });
}

async function readDigests(): Promise<Digest[]> {
  const v = await chrome.storage.local.get(DIGESTS_KEY);
  return (v[DIGESTS_KEY] as Digest[] | undefined) ?? [];
}

// Свежие сверху. Возвращаем копию — вызывающие сортируют/режут, не трогая хранилище.
export async function listDigests(): Promise<Digest[]> {
  const d = await readDigests();
  return d.slice().sort((a, b) => b.ts - a.ts);
}

export async function getDigest(urlHash: string): Promise<Digest | undefined> {
  const d = await readDigests();
  return d.find((x) => x.urlHash === urlHash);
}

export async function putDigest(d: Digest): Promise<void> {
  const all = await readDigests();
  const next = [d, ...all.filter((x) => x.urlHash !== d.urlHash)].slice(0, MAX_DIGESTS);
  await chrome.storage.local.set({ [DIGESTS_KEY]: next });
}

export async function clearDigests(): Promise<void> {
  await chrome.storage.local.remove(DIGESTS_KEY);
}

export async function deleteDigest(urlHash: string): Promise<void> {
  const all = await readDigests();
  await chrome.storage.local.set({ [DIGESTS_KEY]: all.filter((x) => x.urlHash !== urlHash) });
}
