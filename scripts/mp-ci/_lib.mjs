// scripts/mp-ci/_lib.mjs · 共用工具
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const red = (s) => `\x1b[31m${s}\x1b[0m`;
export const green = (s) => `\x1b[32m${s}\x1b[0m`;
export const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

export function guardEnv(env, keys) {
  return keys.filter((k) => !env[k]);
}

export async function loadCi() {
  try {
    // 动态 import：未安装时不致命
    const mod = await import('miniprogram-ci');
    return mod.default || mod;
  } catch {
    return null;
  }
}

export function writeReport(filename, data) {
  const dir = join(process.cwd(), 'reports');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), JSON.stringify(data, null, 2), 'utf8');
}
