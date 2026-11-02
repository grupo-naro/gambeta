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
  // Un cierre de madrugada (p.ej. apertura 23:00, cierre 01:00) SÍ es una jornada válida que
  // cruza la medianoche — pero sólo si el cierre cae temprano en la madrugada (antes de las
  // 06:00, ver cierreDeJornada/LIMITE_MADRUGADA_MIN en hora.ts). Un cierre "antes" que la
  // apertura en el reloj pero que no cae en esa ventana temprana (p.ej. apertura 23:00, cierre
  // 09:00 — una jornada de 10 horas) sigue siendo un dato invertido, no una jornada larga.
  it('rechaza apertura >= cierre', () => {
    expect(configSchema.safeParse({ horaApertura:'23:00', horaCierre:'09:00', horaAperturaFinde:'09:00', horaCierreFinde:'00:00', adminWhatsapp:'5491159582039', senaModo:'PORCENTAJE', senaPorcentaje:'50', senaMontoFijo:'5000', cbu:'', alias:'', titular:'', alias2:'', cbu2:'', titular2:'', picoDesde:'', picoHasta:'', picoFindeDesde:'', picoFindeHasta:'' }).success).toBe(false);
  });
  it('rechaza apertura === cierre (duración cero)', () => {
    expect(configSchema.safeParse({ horaApertura:'09:00', horaCierre:'09:00', horaAperturaFinde:'09:00', horaCierreFinde:'00:00', adminWhatsapp:'5491159582039', senaModo:'PORCENTAJE', senaPorcentaje:'50', senaMontoFijo:'5000', cbu:'', alias:'', titular:'', alias2:'', cbu2:'', titular2:'', picoDesde:'', picoHasta:'', picoFindeDesde:'', picoFindeHasta:'' }).success).toBe(false);
  });
  it('rechaza apertura >= cierre en el finde', () => {
    expect(configSchema.safeParse({ horaApertura:'09:00', horaCierre:'23:00', horaAperturaFinde:'23:00', horaCierreFinde:'09:00', adminWhatsapp:'5491159582039', senaModo:'PORCENTAJE', senaPorcentaje:'50', senaMontoFijo:'5000', cbu:'', alias:'', titular:'', alias2:'', cbu2:'', titular2:'', picoDesde:'', picoHasta:'', picoFindeDesde:'', picoFindeHasta:'' }).success).toBe(false);
  });
});

// El backend y el panel se despliegan por separado (ver CLAUDE.md): si el backend todavía no
// tiene diasAnticipacionMax, GET /config puede devolver la config sin esa clave. El resto del
// formulario (horarios, WhatsApp, seña, etc.) tiene que poder guardarse igual.
describe('configSchema sin diasAnticipacionMax (deploy escalonado)', () => {
  const cfgCompleta = { horaApertura:'09:00', horaCierre:'23:00', horaAperturaFinde:'09:00', horaCierreFinde:'00:00', adminWhatsapp:'5491159582039', diasAnticipacionMax:'7', senaModo:'PORCENTAJE', senaPorcentaje:'50', senaMontoFijo:'5000', cbu:'', alias:'pago.x', titular:'Juan', alias2:'', cbu2:'', titular2:'', picoDesde:'', picoHasta:'', picoFindeDesde:'', picoFindeHasta:'' };
  it('acepta la config cuando la clave directamente no está presente', () => {
    const { diasAnticipacionMax, ...sinCampo } = cfgCompleta;
    const r = configSchema.safeParse(sinCampo);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.diasAnticipacionMax).toBeUndefined();
  });
  it('acepta la config cuando el campo llega como string vacío (guarda del estado inicial)', () => {
    const r = configSchema.safeParse({ ...cfgCompleta, diasAnticipacionMax: '' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.diasAnticipacionMax).toBeUndefined();
  });
  it('no arrastra la clave al payload cuando está vacía, para no mandar NaN al backend', () => {
    const r = configSchema.safeParse({ ...cfgCompleta, diasAnticipacionMax: '' });
    expect(r.success).toBe(true);
    if (r.success) {
      const payload = JSON.parse(JSON.stringify(r.data));
      expect('diasAnticipacionMax' in payload).toBe(false);
    }
  });
  it('sigue validando el resto de los campos aunque falte diasAnticipacionMax', () => {
    const { diasAnticipacionMax, ...sinCampo } = cfgCompleta;
    // adminWhatsapp inválido (menos de 8 caracteres), no un horario: este caso prueba que el
    // resto de las validaciones sigue corriendo aunque falte diasAnticipacionMax, sin tocar
    // apertura/cierre (cfgCompleta ya trae un horario válido que no cruza medianoche).
    const r = configSchema.safeParse({ ...sinCampo, adminWhatsapp: '123' });
    expect(r.success).toBe(false);
  });
  it('rechaza diasAnticipacionMax fuera de rango cuando sí llega', () => {
    expect(configSchema.safeParse({ ...cfgCompleta, diasAnticipacionMax: '400' }).success).toBe(false);
    expect(configSchema.safeParse({ ...cfgCompleta, diasAnticipacionMax: '0' }).success).toBe(false);
  });
  it('acepta diasAnticipacionMax válido y lo coerciona a número', () => {
    const r = configSchema.safeParse({ ...cfgCompleta, diasAnticipacionMax: '14' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.diasAnticipacionMax).toBe(14);
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
  it('acepta un recurrente con período desde/hasta', () => expect(bloqueoSchema.safeParse({ canchaId: 'c', motivo: 'TORNEO', recurrente: true, diaSemana: 4, horaInicio: '20:00', horaFin: '23:59', vigenciaDesde: '2026-11-19', vigenciaHasta: '2026-11-26' }).success).toBe(true));
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

/**
 * "00:00" es el FIN del día (1440), no el arranque, cuando aparece como hora de cierre o de fin.
 * Estos validadores comparaban texto ("20:00" < "00:00" es falso) y rechazaban justo las
 * configuraciones que el backend sí sabe calcular: el pico que corre hasta el cierre, y el fijo
 * o bloqueo que termina a medianoche.
 */
describe('horarios que terminan a medianoche', () => {
  const config = (over: Record<string, string>) => configSchema.safeParse({
    horaApertura: '07:00', horaCierre: '00:00', horaAperturaFinde: '07:00', horaCierreFinde: '00:00',
    adminWhatsapp: '1136620274', diasAnticipacionMax: '7', senaModo: 'FIJO',
    senaPorcentaje: '50', senaMontoFijo: '5000',
    cbu: '', alias: '', titular: '', alias2: '', cbu2: '', titular2: '',
    picoDesde: '', picoHasta: '', picoFindeDesde: '', picoFindeHasta: '',
    ...over,
  });

  it('acepta cerrar a medianoche', () => {
    expect(config({}).success).toBe(true);
  });

  it('acepta la franja pico que termina a medianoche', () => {
    expect(config({ picoDesde: '20:00', picoHasta: '00:00' }).success).toBe(true);
    expect(config({ picoFindeDesde: '20:00', picoFindeHasta: '00:00' }).success).toBe(true);
  });

  it('sigue rechazando una franja pico invertida', () => {
    expect(config({ picoDesde: '22:00', picoHasta: '18:00' }).success).toBe(false);
  });

  it('acepta un turno fijo y un bloqueo que terminan a medianoche', () => {
    expect(turnoFijoSchema.safeParse({
      canchaId: 'c1', clienteNombre: 'Juan', whatsapp: '1136620274',
      diaSemana: 5, horaInicio: '23:00', horaFin: '00:00',
    }).success).toBe(true);
    expect(bloqueoSchema.safeParse({
      canchaId: 'c1', motivo: 'MANTENIMIENTO', recurrente: true,
      diaSemana: 5, horaInicio: '23:00', horaFin: '00:00',
    }).success).toBe(true);
  });

  it('sigue rechazando un fijo y un bloqueo con el rango invertido', () => {
    expect(turnoFijoSchema.safeParse({
      canchaId: 'c1', clienteNombre: 'Juan', whatsapp: '1136620274',
      diaSemana: 5, horaInicio: '22:00', horaFin: '18:00',
    }).success).toBe(false);
    expect(bloqueoSchema.safeParse({
      canchaId: 'c1', motivo: 'MANTENIMIENTO', recurrente: true,
      diaSemana: 5, horaInicio: '22:00', horaFin: '18:00',
    }).success).toBe(false);
  });
});

/**
 * El complejo cierra a la 01:00 de la madrugada. `cierreMin` sólo entiende "00:00" como fin de
 * día, así que una apertura 07:00 / cierre 01:00 se leía como "01:00 de HOY", antes de abrir, y
 * el panel rechazaba una jornada perfectamente válida. `minutoDeJornada` entiende cualquier hora
 * anterior a la apertura como perteneciente al día siguiente.
 */
describe('cierre posterior a la medianoche', () => {
  const config = (over: Record<string, string>) => configSchema.safeParse({
    horaApertura: '07:00', horaCierre: '23:00', horaAperturaFinde: '07:00', horaCierreFinde: '00:00',
    adminWhatsapp: '1136620274', diasAnticipacionMax: '7', senaModo: 'FIJO',
    senaPorcentaje: '50', senaMontoFijo: '5000',
    cbu: '', alias: '', titular: '', alias2: '', cbu2: '', titular2: '',
    picoDesde: '', picoHasta: '', picoFindeDesde: '', picoFindeHasta: '',
    ...over,
  });

  it('acepta abrir 07:00 y cerrar 01:00', () => {
    expect(config({ horaCierre: '01:00' }).success).toBe(true);
    expect(config({ horaAperturaFinde: '07:00', horaCierreFinde: '02:00' }).success).toBe(true);
  });

  it('sigue aceptando los cierres de hoy', () => {
    expect(config({ horaCierre: '23:00' }).success).toBe(true);
    expect(config({ horaCierre: '00:00' }).success).toBe(true);
  });

  it('rechaza una jornada de duración cero', () => {
    expect(config({ horaCierre: '07:00' }).success).toBe(false);
  });

  it('acepta el pico corriendo hasta un cierre de madrugada', () => {
    expect(config({ picoDesde: '20:00', picoHasta: '01:00' }).success).toBe(true);
  });
});

describe('turnoFijoSchema: nota', () => {
  const base = { canchaId: 'c', clienteNombre: 'Ana', whatsapp: '11 3662 0274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00' };
  it('la nota es opcional y se recorta', () => {
    expect(turnoFijoSchema.safeParse(base).success).toBe(true);
    const r = turnoFijoSchema.safeParse({ ...base, nota: '  paga en efectivo  ' });
    expect(r.success && r.data.nota).toBe('paga en efectivo');
  });
  it('rechaza una nota de más de 500 caracteres', () => {
    expect(turnoFijoSchema.safeParse({ ...base, nota: 'x'.repeat(501) }).success).toBe(false);
  });
});

describe('bloqueoSchema: evento con plata', () => {
  const ev = { canchaId: 'c', motivo: 'OTRO', recurrente: false, fecha: '2030-05-10', horaInicio: '15:00', horaFin: '18:00' };
  it('acepta valor con seña', () => expect(bloqueoSchema.safeParse({ ...ev, valor: 50000, montoPagado: 25000, medioPago: 'EFECTIVO' }).success).toBe(true));
  it('rechaza una seña mayor al valor', () => expect(bloqueoSchema.safeParse({ ...ev, valor: 50000, montoPagado: 60000, medioPago: 'EFECTIVO' }).success).toBe(false));
  it('rechaza una seña sin valor', () => expect(bloqueoSchema.safeParse({ ...ev, montoPagado: 1000, medioPago: 'EFECTIVO' }).success).toBe(false));
});
