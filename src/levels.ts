import { assetUrl, loadJson } from "./assets.ts";
import type { Host } from "./host.ts";

export type Level = {
  id: string;
  title: string;
  titles?: Record<string, string>;
  top: string;
  bottom: string;
  thumb: string;
  defaultEffect?: string;
};

type Catalog = {
  format?: number;
  levels: Level[];
};

const CATALOG_PATH = "levels/levels.json";

export function titleOf(level: Level, locale = "zh_CN") {
  return level.titles?.[locale] || level.titles?.zh_CN || level.title || level.id;
}

export function levelById(levels: Level[], id: string | null | undefined) {
  return levels.find((level) => level.id === id) ?? levels[0];
}

export function nextLevel(levels: Level[], current: Level) {
  if (levels.length === 0) return current;
  const index = levels.findIndex((level) => level.id === current.id);
  return levels[(index + 1) % levels.length];
}

export function randomLevel(levels: Level[], current?: Level) {
  if (levels.length <= 1) return levels[0] ?? current;
  const pool = current ? levels.filter((level) => level.id !== current.id) : levels;
  return pool[Math.floor(Math.random() * pool.length)];
}

export async function loadCatalog(host: Host): Promise<Level[]> {
  const fromPackage = await host.readJson<Catalog>(CATALOG_PATH);
  const data = fromPackage ?? (await loadJson<Catalog>(assetUrl(CATALOG_PATH)));
  if (!data || !Array.isArray(data.levels) || data.levels.length === 0) {
    throw new Error("Level catalog is empty");
  }
  return data.levels.filter((level) => level && level.id && level.top && level.bottom);
}
