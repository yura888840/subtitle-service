import { dispatch } from '../../../src/durable/api';
import { ensureSchema } from './durable-api';
import "server-only";

export type LegalConfig = {
  legal: { name: string; street: string; zipCity: string; country: string; email: string; phone: string; vatId: string; responsible: string };
  tgContact: string;
  retentionHours: number;
  dailyLimit: number;
  licenseTtlDays: number;
};
export type Options = { maxFileSizeMb: number; maxDurationSec: number; dailyLimit: number; languages: { label: string; value: string; code: string }[] };

async function read<T>(path: string): Promise<T> {
  if (process.env.DATABASE_URL) { await ensureSchema(); return (await dispatch('GET', path)).body as T; }
  const base = process.env.MEDIA_API_URL || "http://127.0.0.1:3000";
  const response = await fetch(new URL(path, base), { cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Public configuration unavailable (${response.status})`);
  return response.json() as Promise<T>;
}
export const getLegal = () => read<LegalConfig>("/legal");
export const getOptions = () => read<Options>("/options");
