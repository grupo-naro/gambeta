'use server';
import { apiFetch } from './api';
import { ApiError } from './types';
import type { SheetsInfo } from './types';

export async function getSheetsInfo(): Promise<SheetsInfo> {
  try { return await apiFetch<SheetsInfo>('/sheets/info'); } catch { return { configurado: false, url: null }; }
}
export async function sincronizarSheets(): Promise<{ ok: true } | { ok: false; error: string }> {
  try { await apiFetch('/sheets/sync', { method: 'POST' }); return { ok: true }; }
  catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}
