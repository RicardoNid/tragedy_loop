import type { api as httpApi } from '../api';
export type ReviewApi = typeof httpApi;
export type Call = {
  [K in keyof ReviewApi]: { method: K; args: Parameters<ReviewApi[K]> };
}[keyof ReviewApi];
export type Request = Call & { sequence: number };
export type Reply = { sequence: number; value?: unknown; error?: string };
