'use server';
import { revalidatePath } from 'next/cache';
import { apiFetch } from './api';
import { ApiError } from './types';
import type { CuentaMp } from './types';

export async function getCuentaMp(): Promise<CuentaMp> {
  try { return await apiFetch<CuentaMp>('/pagos/mercadopago/cuenta'); }
  catch { return { vinculada: false, apodo: null, venceEn: null, caida: false }; }
}

export async function vincularMp(): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const r = await apiFetch<{ url: string }>('/pagos/mercadopago/vincular', { method: 'POST' });
    return { ok: true, url: r.url };
  } catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}

export async function completarVinculacionMp(code: string, state: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await apiFetch('/pagos/mercadopago/callback', { method: 'POST', body: JSON.stringify({ code, state }) });
    revalidatePath('/configuracion');
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}

export async function desvincularMp(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await apiFetch('/pagos/mercadopago/cuenta', { method: 'DELETE' });
    revalidatePath('/configuracion');
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof ApiError ? e.message : 'Error inesperado' }; }
}
