// Connection settings + the local digest cache in chrome.storage.local.
// Self-host: the server stores nothing, so finished digests are cached in the browser.
// The cache feeds the popup's "Recent" and in-tab reading without a repeat request; the main
// saving path is the .md export (downloadBlob in format.ts).

export type Settings = {
  baseUrl?: string; // without a trailing slash, e.g. https://conspect.example.com
  sharedToken?: string;
};

export type Digest = {
  urlHash: string;
  url: string;
  ts: number; // unix seconds
  title: string | null;
  channel: string | null;
  durationSec: number | null;
  lang: string | null;
  markdown: string;
};

const SETTINGS_KEY = "conspect_settings_v1";
// The digest cache key is exported: the dashboard (options.tsx) listens to chrome.storage.onChanged
// on it so the archive updates live when the SW appends a finished digest to the cache.
export const DIGESTS_KEY = "conspect_digests_v1";
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

// Freshest first. We return a copy — callers sort/slice without touching the storage.
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
