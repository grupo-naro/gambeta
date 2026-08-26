import { describe, it, expect } from 'vitest';
import { loginSchema, nuevaReservaSchema, canchaSchema, configSchema, canchaDivisibleSchema, turnoFijoSchema, bloqueoSchema } from '@/lib/validators';

describe('loginSchema', () => {
  it('accepts a valid email + password', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'secret' }).success).toBe(true);
  });
  it('rejects a bad email', () => {
    expect(loginSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
  });
});

describe('nuevaReservaSchema', () => {
  it('requires fecha YYYY-MM-DD and hora HH:MM', () => {
    const ok = nuevaReservaSchema.safeParse({ canchaId: 'c1', nombreCliente: 'Juan', whatsapp: '+5491150000000', fecha: '2026-06-13', horaInicio: '20:00' });
    expect(ok.success).toBe(true);
    expect(nuevaReservaSchema.safeParse({ canchaId: 'c1', nombreCliente: 'Juan', whatsapp: '+5491150000000', fecha: '13/06', horaInicio: '20' }).success).toBe(false);
  });
});

describe('canchaSchema', () => {
  it('accepts a valid cancha and coerces precioHora', () => {
    const r = canchaSchema.safeParse({ nombre: 'Cancha 1', tipo: 'futbol5', precioHora: '12000', jugadores: '5' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.precioHora).toBe(12000);
  });
  it('rejects empty nombre and non-positive precio', () => {
    expect(canchaSchema.safeParse({ nombre: '', tipo: 'futbol5', precioHora: '12000', jugadores: '5' }).success).toBe(false);
    expect(canchaSchema.safeParse({ nombre: 'X', tipo: 'futbol5', precioHora: '0', jugadores: '5' }).success).toBe(false);
  });
});

describe('configSchema', () => {
  it('acepta config válida', () => {
    expect(configSchema.safeParse({ horaApertura:'09:00', horaCierre:'23:00', horaAperturaFinde:'09:00', horaCierreFinde:'00:00', adminWhatsapp:'5491159582039', diasAnticipacionMax:'7', senaModo:'PORCENTAJE', senaPorcentaje:'50', senaMontoFijo:'5000', cbu:'', alias:'pago.x', titular:'Juan', alias2:'', cbu2:'', titular2:'', picoDesde:'', picoHasta:'', picoFindeDesde:'', picoFindeHasta:'' }).success).toBe(true);
  });
  it('rechaza apertura >= cierre', () => {
    expect(configSchema.safeParse({ horaApertura:'23:00', horaCierre:'09:00', horaAperturaFinde:'09:00', horaCierreFinde:'00:00', adminWhatsapp:'5491159582039', senaModo:'PORCENTAJE', senaPorcentaje:'50', senaMontoFijo:'5000', cbu:'', alias:'', titular:'', alias2:'', cbu2:'', titular2:'', picoDesde:'', picoHasta:'', picoFindeDesde:'', picoFindeHasta:'' }).success).toBe(false);
  });
});

describe('canchaDivisibleSchema', () => {
  it('acepta divisible válida', () => {
    expect(canchaDivisibleSchema.safeParse({ nombre: 'Cancha 4', partes: '3', precioEntera: '30000', precioParte: '12000', jugadoresEntera: '11', jugadoresParte: '5' }).success).toBe(true);
  });
  it('rechaza partes < 2', () => {
    expect(canchaDivisibleSchema.safeParse({ nombre: 'X', partes: '1', precioEntera: '1', precioParte: '1', jugadoresEntera: '5', jugadoresParte: '5' }).success).toBe(false);
  });
});

describe('turnoFijoSchema', () => {
  it('válido con whatsapp canónico', () => expect(turnoFijoSchema.safeParse({ canchaId: 'c', clienteNombre: 'J', whatsapp: '11 3662 0274', diaSemana: '2', horaInicio: '20:00', horaFin: '21:00' }).success).toBe(true));
  it('rechaza whatsapp vacío', () => expect(turnoFijoSchema.safeParse({ canchaId: 'c', clienteNombre: 'J', whatsapp: '', diaSemana: '2', horaInicio: '20:00', horaFin: '21:00' }).success).toBe(false));
  it('rechaza inicio>=fin', () => expect(turnoFijoSchema.safeParse({ canchaId: 'c', clienteNombre: 'J', whatsapp: '11 3662 0274', diaSemana: '2', horaInicio: '21:00', horaFin: '20:00' }).success).toBe(false));
});

describe('bloqueoSchema', () => {
  it('recurrente necesita diaSemana', () => expect(bloqueoSchema.safeParse({ canchaId: 'c', motivo: 'TORNEO', recurrente: true, horaInicio: '18:00', horaFin: '20:00' }).success).toBe(false));
  it('puntual válido', () => expect(bloqueoSchema.safeParse({ canchaId: 'c', motivo: 'TORNEO', recurrente: false, fecha: '2026-06-20', horaInicio: '18:00', horaFin: '20:00' }).success).toBe(true));
});

describe('canchaSchema con jugadores', () => {
  it('acepta jugadores=7 (coerciona string)', () => {
    const r = canchaSchema.safeParse({ nombre: 'C', tipo: 'futbol7', precioHora: '1000', jugadores: '7' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.jugadores).toBe(7);
  });
  it('rechaza jugadores=6', () => {
    const r = canchaSchema.safeParse({ nombre: 'C', tipo: 'otro', precioHora: '1000', jugadores: '6' });
    expect(r.success).toBe(false);
  });
});

describe('canchaDivisibleSchema con jugadores entera/parte', () => {
  it('acepta jugadoresEntera=11 y jugadoresParte=5', () => {
    const r = canchaDivisibleSchema.safeParse({ nombre: 'C4', partes: '3', precioEntera: '30000', precioParte: '12000', jugadoresEntera: '11', jugadoresParte: '5' });
    expect(r.success).toBe(true);
    if (r.success) { expect(r.data.jugadoresEntera).toBe(11); expect(r.data.jugadoresParte).toBe(5); }
  });
  it('rechaza jugadoresParte=6', () => {
    const r = canchaDivisibleSchema.safeParse({ nombre: 'C4', partes: '3', precioEntera: '30000', precioParte: '12000', jugadoresEntera: '11', jugadoresParte: '6' });
    expect(r.success).toBe(false);
  });
});

describe('canchaSchema con destacada', () => {
  it('acepta destacada=true', () => {
    const r = canchaSchema.safeParse({ nombre: 'Techada', tipo: 'futbol5', precioHora: '1500', jugadores: '5', destacada: true });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.destacada).toBe(true);
  });
  it('default destacada=false cuando se omite', () => {
    const r = canchaSchema.safeParse({ nombre: 'C', tipo: 'futbol5', precioHora: '1000', jugadores: '5' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.destacada).toBe(false);
  });
});

describe('canchaSchema con precioHoraPico', () => {
  it('coerce y default 0', () => {
    const r = canchaSchema.safeParse({ nombre: 'C', tipo: 'futbol5', precioHora: '1000', jugadores: '5', destacada: false });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.precioHoraPico).toBe(0);
  });
  it('acepta precioHoraPico=1800', () => {
    const r = canchaSchema.safeParse({ nombre: 'C', tipo: 'futbol5', precioHora: '1000', jugadores: '5', destacada: false, precioHoraPico: '1800' });
    expect(r.success && r.data.precioHoraPico).toBe(1800);
  });
  it('rechaza precioHoraPico negativo', () => {
    const r = canchaSchema.safeParse({ nombre: 'C', tipo: 'futbol5', precioHora: '1000', jugadores: '5', destacada: false, precioHoraPico: '-1' });
    expect(r.success).toBe(false);
  });
});

describe('configSchema con franjas pico', () => {
  const baseCfg = { horaApertura: '16:00', horaCierre: '23:00', horaAperturaFinde: '16:00', horaCierreFinde: '00:00', adminWhatsapp: '5491100000000', diasAnticipacionMax: '7', senaModo: 'PORCENTAJE', senaPorcentaje: '50', senaMontoFijo: '0', cbu: '', alias: '', titular: '', alias2: '', cbu2: '', titular2: '' };
  it('acepta franjas vacías', () => {
    const r = configSchema.safeParse({ ...baseCfg, picoDesde: '', picoHasta: '', picoFindeDesde: '', picoFindeHasta: '' });
    expect(r.success).toBe(true);
  });
  it('acepta una franja válida', () => {
    const r = configSchema.safeParse({ ...baseCfg, picoDesde: '19:00', picoHasta: '23:00', picoFindeDesde: '', picoFindeHasta: '' });
    expect(r.success).toBe(true);
  });
  it('rechaza franja con desde >= hasta', () => {
    const r = configSchema.safeParse({ ...baseCfg, picoDesde: '23:00', picoHasta: '19:00', picoFindeDesde: '', picoFindeHasta: '' });
    expect(r.success).toBe(false);
  });
});
