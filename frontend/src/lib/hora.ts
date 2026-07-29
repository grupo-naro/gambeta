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
export function cierreMin(hhmm: string): number { const [h, m] = hhmm.split(':').map(Number); const min = h * 60 + m; return min === 0 ? 1440 : min; }
