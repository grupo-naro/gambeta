# Segunda cuenta de pago (alias/CBU secundario) — Design

**Fecha:** 2026-07-07
**Estado:** Aprobado
**Componentes:** backend `canchitas-backend` (config + migración) + frontend (form de Configuración) + bot n8n (verificación de comprobante). 3 repos.

## Problema

El complejo cobra la seña en **dos** cuentas: una principal y una secundaria. Hay clientes que transfieren a la secundaria (por costumbre). Hoy la config guarda **un solo** `alias/cbu/titular`, así que cuando llega un comprobante pagado a la cuenta secundaria, el bot no matchea el alias ni el CBU y lo manda "a revisar" (como si fuera inválido).

## Objetivo

Registrar una **segunda cuenta** (alias/CBU/titular secundario) y que el bot **apruebe el comprobante si matchea la cuenta principal O la secundaria**. Al cliente se le sigue mostrando **solo la cuenta principal** al reservar (para no confundir a los nuevos); la verificación acepta ambas.

## Diseño

### 1. Backend — segunda cuenta en la config
- `Configuracion` (Prisma) gana: `alias2 String @default("")`, `cbu2 String @default("")`, `titular2 String @default("")`. Migración manual (agregar 3 columnas).
- `config.schema` (validador de update): `alias2`, `cbu2`, `titular2` opcionales (como los actuales).
- El GET/PATCH de config los pasa (el servicio ya persiste el objeto de config; se suman los 3 campos). El `GET /config` los devuelve (el frontend y el bot los leen).
- `senaService.datosPago()` **no cambia** (sigue devolviendo la principal — es lo que se le muestra al cliente).

### 2. Frontend — campos de cuenta secundaria
- `Config` (types) gana `alias2`, `cbu2`, `titular2` (string).
- `config-form.tsx`: debajo de la cuenta actual, un bloque **"Cuenta secundaria (opcional)"** con Alias / CBU / Titular (`alias2`/`cbu2`/`titular2`). El `configSchema` (validators frontend) y el estado del form los incluyen. Vacíos = no se usa la secundaria.

### 3. Bot — verificar contra ambas cuentas
En la rama del comprobante del Cerebro (`if(E.esImagen||E.esPdf)`), donde hoy calcula `aliasM`/`cbuM` contra `ic.alias`/`ic.cbu` (de ctx):
- Traer la config (`GET /config`) para tener las dos cuentas actuales.
- Construir el conjunto de alias válidos = `[ic.alias, cfg.alias, cfg.alias2]` (no vacíos) y de CBUs válidos = `[ic.cbu, cfg.cbu, cfg.cbu2]` (no vacíos).
- `aliasM` = el `alias_destino` del comprobante matchea **alguno** de los alias válidos (misma normalización: sin espacios, minúsculas, `includes`).
- `cbuM` = el `cbu_destino` matchea **alguno** de los CBU válidos (últimos 8 dígitos, como hoy).
- Aprobar sigue igual: `okMonto && (aliasM || cbuM) && fechaOk`. Si no matchea ninguna → "a revisar" (comportamiento actual).
- Si la config no tiene secundaria (vacía), el conjunto queda solo con la principal → comportamiento idéntico al actual.

## Alcance / no-alcance
- Solo se agrega **una** cuenta secundaria (no una lista arbitraria).
- No cambia el mensaje de "transferí la seña a…" (muestra la principal).
- No cambia el flujo de reserva ni el cálculo de monto.

## Riesgo
- Match de alias por `includes` podría dar un falso positivo si un alias es substring de otro; es el mismo riesgo que ya existe con la cuenta única, no se agrava. La condición `okMonto` + fecha sigue acotando.

## Testing
- Backend: test de integración de config — PATCH con `alias2`/`cbu2`/`titular2` los persiste y el GET los devuelve.
- Bot: sintaxis del Cerebro vía AsyncFunction; smoke test (con Evolution): comprobante a la cuenta secundaria → aprobado; a la principal → aprobado; a una cuenta ajena → "a revisar".

## Integración / deploy
- Backend → rama `feat/segunda-cuenta-pago` desde `main`, commit local (sin push salvo OK). **Migración manual** en la VM (`prisma migrate deploy`).
- Frontend → cambios en `master` local (sin push salvo OK) → Vercel.
- Bot → aplicado en vivo vía patchNodeField (backup por version history). Depende de que el backend con `alias2/cbu2` esté deployado para que la config los devuelva (si no, el bot no encuentra la secundaria y sigue como hoy).
