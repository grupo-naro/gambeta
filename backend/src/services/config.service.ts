import { configRepo } from '../repositories/config.repo.js';
import { BusinessRule } from '../utils/errors.js';
import { hhmmAMin, cierreMin } from '../utils/tz.js';

export const configService = {
  async get() {
    const { buffetPinHash, ...rest } = await configRepo.getOrCreate();
    return rest;
  },
  async update(patch: Record<string, unknown>) {
    // Valida apertura<cierre sobre los valores EFECTIVOS (mezcla del patch parcial + lo guardado),
    // así un PATCH con solo una de las dos horas no puede dejar un rango inválido.
    const current = await configRepo.getOrCreate();
    const ap = (patch.horaApertura ?? current.horaApertura) as string;
    const ci = (patch.horaCierre ?? current.horaCierre) as string;
    if (hhmmAMin(ap) >= cierreMin(ci)) throw BusinessRule('La apertura (semana) debe ser anterior al cierre');
    const apF = (patch.horaAperturaFinde ?? current.horaAperturaFinde) as string;
    const ciF = (patch.horaCierreFinde ?? current.horaCierreFinde) as string;
    if (hhmmAMin(apF) >= cierreMin(ciF)) throw BusinessRule('La apertura (finde) debe ser anterior al cierre');
    const pd = (patch.picoDesde ?? current.picoDesde) as string;
    const ph = (patch.picoHasta ?? current.picoHasta) as string;
    if (pd && ph && pd >= ph) throw BusinessRule('La franja pico (semana) es inválida');
    const pfd = (patch.picoFindeDesde ?? current.picoFindeDesde) as string;
    const pfh = (patch.picoFindeHasta ?? current.picoFindeHasta) as string;
    if (pfd && pfh && pfd >= pfh) throw BusinessRule('La franja pico (finde) es inválida');
    const { buffetPinHash, ...rest } = await configRepo.update(patch);
    return rest;
  },
};
