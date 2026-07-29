# Bot WhatsApp — Reconocer cancha puntual por nombre — Design

**Fecha:** 2026-07-06
**Estado:** Aprobado
**Componente:** workflow n8n "Canchitas — Bot v2" (`I8yiX4g1rGh5Hb2U`), nodos **Cerebro** y **Prompt**. Sin backend/frontend.

## Problema

Cuando un cliente nombra una cancha concreta ("la cancha 1 a las 21hs") pero no da el día en el mismo mensaje, el bot ignora la cancha nombrada y pregunta el tamaño ("¿de 5, 6 o 9?"), entrando en un loop frustrante. Caso real (Alejandra): pidió "la cancha número 1 a las 21hs" dos veces y el bot igual preguntó el tamaño.

### Causa

En la rama `reservar/consultar_disponibilidad` del Cerebro:
- La cancha puntual solo se resuelve en el branch `if(cPick && fecha && hora)`. Si falta `fecha` o `hora`, cae a `else if(!jugadores)` → pregunta el tamaño e **ignora `cPick`**.
- `cPick = matchC(gem.cancha, ...)` usa solo lo extraído del mensaje **actual**, no `ctx.cancha`. Cuando el cliente responde el día en el siguiente mensaje, la cancha ya nombrada se pierde.
- `matchC` matchea "cancha 1" (exacto) y "1" (includes), pero **falla con "cancha número 1"** (no es includes de "cancha 1").

## Diseño

Tres ajustes acotados:

### 1. `cPick` considera el contexto
```js
const cPick = matchC(gem.cancha || ctx.cancha, opciones.length ? opciones : canchas);
```
Así la cancha nombrada en un mensaje anterior sobrevive a los mensajes siguientes (ej: dice "cancha 1", luego "hoy").

### 2. Nueva rama: cancha nombrada, falta día/hora
Insertar **después** de `if(cPick && fecha && hora){...}` y **antes** de `else if(!jugadores){...}`:
```js
else if (cPick) {
  const falta = (!fecha && !hora) ? '¿para qué día y a qué hora?' : (!fecha ? '¿para qué día?' : '¿a qué hora?');
  reply = 'Dale, la ' + nomb(cPick.nombre) + ' — ' + falta;
  store = Object.assign({}, ctx, {
    cancha: cPick.nombre,
    jugadores: cPick.jugadores || ctx.jugadores || null,
    fecha: fecha || ctx.fecha || null,
    hora: hora || ctx.hora || null,
  });
}
```
- Guarda la cancha (por nombre) y su tamaño (deducido de la cancha) en contexto, y pregunta **solo lo que falta**.
- **Nunca pregunta el tamaño** cuando el cliente ya eligió una cancha concreta.
- Cuando el cliente completa el día/hora, cae en `if(cPick && fecha && hora)` (porque ahora `cPick` mira `ctx.cancha`), que verifica disponibilidad y confirma u ofrece alternativas.

### 3. `matchC` más robusto + hint en el Prompt
`matchC` gana un fallback por número: si no hay match exacto/includes, extrae el primer dígito del texto y matchea contra el número del nombre de la cancha.
```js
const matchC = (n, pool) => {
  if (!n) return null;
  const s = String(n).toLowerCase().trim();
  let c = pool.find(x => x.nombre.toLowerCase() === s)
       || pool.find(x => x.nombre.toLowerCase().includes(s) || s.includes(x.nombre.toLowerCase()));
  if (c) return c;
  const num = (s.match(/\d+/) || [])[0];
  if (num) { c = pool.find(x => ((x.nombre.match(/\d+/) || [])[0]) === num); if (c) return c; }
  return null;
};
```
Esto matchea "cancha número 1" → Cancha 1.

En el **Prompt**, agregar una línea para que Gemini normalice la cancha nombrada al nombre exacto de la lista: *"Si el cliente nombra una cancha puntual (ej: 'cancha 1', 'la número 2', 'la techada'), poné en `cancha` el nombre EXACTO de esa cancha de la lista."*

## Comportamiento cuando la cancha nombrada está ocupada
Sin cambios: el branch `if(cPick && fecha && hora)` ya avisa que está ocupada y ofrece las otras canchas libres a esa hora (misma lógica actual).

## Riesgo y mitigación
- **Sobre-match por número:** si Gemini pusiera `cancha="5"` para "una de 5" (que es tamaño, no cancha), el fallback por número podría matchear una hipotética "Cancha 5". Mitigación: el Prompt ya separa tamaño (jugadores) de cancha nombrada, y el fallback solo corre si `gem.cancha`/`ctx.cancha` viene seteado. Riesgo residual bajo; se observa en el smoke test.

## Testing
Sin tests automáticos en n8n. Validación:
1. Sintaxis del Cerebro/Prompt vía AsyncFunction sobre el workflow guardado.
2. Smoke test (con Evolution): "la cancha 1 a las 21" + "hoy" → el bot pregunta solo el día y luego confirma/ofrece la cancha 1, sin preguntar tamaño; "la cancha número 2 mañana a las 20" → resuelve la Cancha 2.

## Fuera de alcance
- Debounce (ya implementado), reprogramar (#3) y cancelar-cerca (#4) del análisis previo.
- Backend/frontend.

## Despliegue
En vivo sobre `I8yiX4g1rGh5Hb2U` vía patchNodeField, con backup por version history de n8n (ver [[bot-debounce-mensajes]]).
