# Seña por cancha + anular porcentaje — Design

**Fecha:** 2026-07-02
**Estado:** Aprobado
**Componentes:** backend (modelo + migración + servicio + validador + 2 call sites + tests) + frontend (form de cancha + form de config + validadores).

## Problema

Hoy la seña se calcula **global** (config `senaModo` = PORCENTAJE/FIJO, con `senaPorcentaje`/`senaMontoFijo`). El complejo quiere que **cada cancha tenga su propio monto fijo de seña** (ej: cancha de 5 → $10.000, cancha de 9 → $30.000) y **dejar de usar el porcentaje** por completo.

## Decisiones (con el usuario)

1. **Seña por cancha:** nuevo campo `Cancha.senaMonto` (monto fijo propio). Si está seteado, se usa ese; si no, cae al monto fijo global (fallback).
2. **Anular porcentaje:** el panel deja de ofrecer el modo porcentaje; el fallback global pasa a ser siempre el monto fijo. El servicio nunca más calcula porcentaje.
3. **Datos de pago** (`cbu/alias/titular`) siguen **globales** (sin cambios).
4. **Bot:** sin cambios (ya usa el `montoSena` que devuelve el backend).
5. **Cancha divisible:** el form de crear divisible queda igual; la seña de cada parte se carga **editando** esa cancha (cada parte es una `Cancha` editable). Hasta editarla, cae al fallback global.

## Backend

### Modelo + migración
- `prisma/schema.prisma`, modelo `Cancha`: agregar **`senaMonto Decimal? @db.Decimal(10, 2)`** (nullable; `null` = usa el fallback global).
- Generar la migración Prisma (`add_cancha_sena_monto`).
- ⚠️ **El auto-deploy por GitHub Action NO corre `prisma migrate deploy`** → tras el deploy hay que correrla a mano en la VM: `docker exec canchitas-backend npx prisma migrate deploy`. Si no, el backend rompe al arrancar con la columna nueva. (Ver [[backend-deploy-vm]].)

### Servicio de seña (`src/services/sena.service.ts`)
- Nueva función:
  ```ts
  async montoParaCancha(cancha: { senaMonto?: unknown }, precioHora: number): Promise<number> {
    const propio = cancha?.senaMonto == null ? 0 : Number(cancha.senaMonto);
    if (propio > 0) return Math.round(propio);
    return this.montoParaPrecio(precioHora); // fallback global (siempre fijo)
  }
  ```
- `montoParaPrecio` pasa a devolver **siempre el monto fijo** (se elimina la rama de porcentaje):
  ```ts
  async montoParaPrecio(_precioHora: number): Promise<number> {
    const c = await configService.get();
    return Math.round(Number(c.senaMontoFijo));
  }
  ```
- `datosPago`: `modo` fijo → `modo: 'fijo'` (se deja de leer `senaModo` para el modo). El resto (`cbu/alias/titular`) igual.
- Las columnas `senaModo`/`senaPorcentaje` quedan en la DB (no se borran, se dejan de usar).

### Call sites
- `src/services/reserva.service.ts:62-64`: `montoSena` usa `await senaService.montoParaCancha(cancha, precio)` (el `cancha` ya está en scope, línea 45). El override `input.montoSena ?? ...` se conserva.
- `src/routes/reserva.routes.ts:29-33`: en el cobro del panel, obtener la cancha (`const cancha = await canchaService.get(body.canchaId)` — importar `canchaService`) y `const monto = body.cobroInicial === 'total' ? precio : await senaService.montoParaCancha(cancha, precio);`.

### Validador (`src/validators/cancha.schema.ts`)
- `createCanchaSchema.body` y `updateCanchaSchema.body`: agregar `senaMonto: z.number().nonnegative().nullable().optional()`. `nullable` permite **limpiarlo** (mandar `null` = volver al fallback global); `optional` permite omitirlo.
- `crearDivisibleSchema`: sin cambios.

### Servicio de cancha (`src/services/cancha.service.ts`)
- `create` y `update`: aceptar `senaMonto` en el input y pasarlo al `prisma.cancha.create/update` (Decimal acepta number/null).

### Tests (integración, Testcontainers)
`tests/integration/` (nuevo archivo `cancha-sena.test.ts` o extender uno existente), con service key (bot → fuerza flujo de seña) y whatsapp nuevo (→ ESPERANDO_SENA):
- Cancha con `senaMonto: 10000` → `POST /reservas` (x-api-key, whatsapp nuevo) → `montoSena === 10000`.
- Cancha **sin** `senaMonto` (null) → `montoSena === senaMontoFijo` global (NO porcentaje, aunque `senaModo` esté en PORCENTAJE por default).
- (Validador) `POST /canchas` con `senaMonto: 15000` → 201 y persiste; `senaMonto` negativo → 400.

## Frontend

### Validador (`src/lib/validators.ts`)
- `canchaSchema`: agregar `senaMonto: z.coerce.number().nonnegative().nullable().optional()` (`nullable` deja pasar `null` sin coercionarlo a 0 — clave, porque el diálogo manda `null` cuando el campo está vacío). `canchaDivisibleSchema` sin cambios.

### Diálogo de cancha (`src/components/canchas/cancha-dialog.tsx`)
- Estado nuevo `senaMonto` inicializado en `cancha?.senaMonto` (string; vacío si null), reseteado en `handleOpenChange`.
- En el form **simple/editar**, agregar input **"Monto de seña (opcional)"** (`type=number, min=0`, placeholder "vacío = usa el general"). En el `submit`, incluir en el payload: `senaMonto: senaMonto.trim() === '' ? null : Number(senaMonto)` — vacío manda `null` (tanto al crear como al editar: en crear queda sin monto propio, en editar lo limpia y vuelve al fallback global). El `nullable` del schema deja pasar el `null`.
- El form **divisible** queda igual.

### Form de config (`src/components/config/config-form.tsx`) — anular porcentaje
- Sacar el `<select>` "Modo" (opciones PORCENTAJE/FIJO) y la rama condicional del porcentaje.
- Dejar **solo** el input de monto fijo, relabelizado **"Monto de seña por defecto"** (con ayuda: "se usa cuando una cancha no tiene su propio monto"). Sigue mapeando a `senaMontoFijo`.
- El estado `senaModo` se fija en `'FIJO'` (el form siempre guarda FIJO); `senaPorcentaje` se sigue enviando con su valor actual (no se toca el `configSchema` del cliente ni el validador del backend).

## Fuera de alcance
- Borrar las columnas `senaModo`/`senaPorcentaje` de la DB (se dejan, solo se dejan de usar).
- Seña por parte en el form de crear divisible (se edita cada parte después).
- Cambios en el bot / n8n.
- Seña distinta por hora pico (la seña es un monto plano por cancha).

## Integración
Backend → `main` + push → auto-deploy VM **+ correr `prisma migrate deploy` a mano**. Frontend → `master` + push → Vercel. Dos repos. El monto por cancha (backend) tiene que estar deployado y migrado para que el panel/bot cobren el monto correcto; el form del panel (frontend) necesita el backend con `senaMonto` para persistirlo.
