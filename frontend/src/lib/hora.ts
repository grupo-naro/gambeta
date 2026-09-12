const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Formatea en vivo lo que se tipea, insertando el ":" solo. Trabaja sobre los
 * dígitos: "2130"->"21:30", "21"->"21", "213"->"21:3", "930"->"9:30".
 * Pensado para el onChange de un input; no valida rangos (de eso se ocupa
 * normalizeHora en el blur).
 */
export function maskHora(raw: string): string {
  const d = (raw ?? '').replace(/\D/g, '').slice(0, 4);
  if (d.length <= 2) return d;
  if (d.length === 3) {
    // "213" -> "21:3" (hora válida), pero "930" -> "9:30" (93 no es hora)
    return Number(d.slice(0, 2)) <= 23 ? `${d.slice(0, 2)}:${d[2]}` : `${d[0]}:${d.slice(1)}`;
  }
  return `${d.slice(0, 2)}:${d.slice(2)}`;
}

/** Normaliza una hora tipeada a "HH:MM" (24h). "21"->"21:00", "21:30"->"21:30", "9"->"09:00", "2130"->"21:30", "930"->"09:30". Inválido/vacío -> null. */
export function normalizeHora(raw: string): string | null {
  const s = (raw ?? '').trim();
  let h: number;
  let m: number;
  const soloHora = s.match(/^(\d{1,2})$/);
  const conMin = s.match(/^(\d{1,2}):(\d{1,2})$/);
  const bare = s.match(/^(\d{3,4})$/);
  if (soloHora) {
    h = Number(soloHora[1]);
    m = 0;
  } else if (conMin) {
    h = Number(conMin[1]);
    m = Number(conMin[2]);
  } else if (bare) {
    const digs = bare[1];
    if (digs.length === 4) {
      h = Number(digs.slice(0, 2));
      m = Number(digs.slice(2));
    } else if (Number(digs.slice(0, 2)) <= 23) {
      h = Number(digs.slice(0, 2));
      m = Number(digs[2]);
    } else {
      h = Number(digs[0]);
      m = Number(digs.slice(1));
    }
  } else {
    return null;
  }
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${pad2(h)}:${pad2(m)}`;
}

/** Minutos de una hora HH:MM; "00:00" como cierre = fin del día (1440). */
/** Minuto del día de un "HH:MM". Par de `cierreMin`: acá "00:00" es el minuto 0 (arranque del
 *  día), allá es 1440 (fin del día). Espejo de `hhmmAMin`/`cierreMin` del backend. */
export function hhmmAMin(hhmm: string): number { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
export function cierreMin(hhmm: string): number { const min = hhmmAMin(hhmm); return min === 0 ? 1440 : min; }

/**
 * Minuto de una hora "HH:MM" dentro de la jornada que arranca en `apertura`. Una hora anterior
 * a la apertura pertenece al día siguiente y suma 1440: con apertura 07:00, "01:00" son 1500.
 * Espejo de `minutoDeJornada` del backend.
 */
export function minutoDeJornada(hhmm: string, apertura: string): number {
  const m = hhmmAMin(hhmm);
  return m < hhmmAMin(apertura) ? m + 1440 : m;
}

/** Etiqueta de un minuto de jornada, como lo diría un reloj: 1440 => "00:00", 1500 => "01:00". */
export function hhmmDeMin(m: number): string {
  const d = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(d / 60)).padStart(2, '0')}:${String(d % 60).padStart(2, '0')}`;
}

/**
 * Suma (o resta, con `dias` negativo) días a un rótulo "YYYY-MM-DD". La aritmética se hace en
 * `Date.UTC` sobre el rótulo, no restando milisegundos a un instante local, para no caer en un
 * salto de huso horario. Espejo de `sumarDias` del backend.
 */
export function sumarDias(date: string, dias: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + dias));
  return t.toISOString().slice(0, 10);
}
