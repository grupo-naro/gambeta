# Vincular Mercado Pago por OAuth desde el panel — Diseño

**Fecha:** 2026-08-06
**Estado:** Aprobado — listo para plan de implementación

## Objetivo

Que el dueño del complejo vincule **su** cuenta de Mercado Pago apretando un botón en el panel, y
que las señas caigan ahí. Sin entrar nunca al panel de desarrollador de Mercado Pago, sin copiar un
token, sin que nadie toque código ni variables de entorno en el servidor.

Y que pueda desvincularla igual de fácil.

## Por qué OAuth y no un campo donde pegar el token

Con un solo complejo, OAuth parece desproporcionado: alcanzaría un formulario donde peguen su
access token. **El requisito no es multi-tenencia, es usabilidad.** Sacar un access token de
producción exige entrar a *Tus integraciones*, crear una aplicación y copiar credenciales — es
justo lo que el dueño de un complejo de canchas no va a hacer, y si lo hace mal, lo hace mal en
silencio. OAuth convierte eso en "iniciá sesión y aceptá".

## Cómo funciona

Existe **una** aplicación de Mercado Pago, en la cuenta del desarrollador (Nahuel). Da un
`client_id` y un `client_secret` que viven como variables de entorno del backend. Se configura una
sola vez y no se toca más.

El dueño entra a Configuración y ve una tarjeta "Mercado Pago", del mismo molde que la de Planilla
de Google que ya existe (`frontend/src/components/config/planilla-google.tsx`). Aprieta
**Vincular**, va a Mercado Pago, inicia sesión **con su cuenta**, autoriza, y vuelve al panel.

Desde ese momento las preferencias de pago se crean con el token del vendedor, así que la plata va
a su cuenta.

### La firma del webhook no cambia

La clave secreta que valida las notificaciones **se genera por aplicación, no por vendedor**. Vive
en la cuenta del desarrollador y es la misma siempre, vincule quien vincule. `MP_WEBHOOK_SECRET`
queda tal cual está y `verificarFirma` no se toca.

### El scope `offline_access` es obligatorio

El access token de OAuth **dura 180 días**. Sin pedir `offline_access` en la autorización no se
recibe token de refresco, y a los 180 días habría que rehacer el flujo a mano. Con él, se renueva
solo.

## Dónde viven los tokens

**Una tabla nueva con una sola fila, no campos en `Configuracion`.** `Configuracion` se lee en todo
el backend y se serializa hacia el panel; meterle credenciales que mueven plata es crear la
oportunidad de que un día salgan en una respuesta. La tabla guarda: token de acceso, token de
refresco, vencimiento, identificador y apodo de la cuenta vinculada (para poder mostrar *cuál*
cuenta está conectada), y si la vinculación está caída.

**Cifrados con AES-256-GCM**, con una clave nueva `MP_ENCRYPTION_KEY`. GCM además de cifrar detecta
alteraciones. Un dump de la base no entrega los tokens.

## Renovación

**Perezosa, sin job ni cron.** Antes de usar el token, si le quedan **menos de 7 días** de los 180,
se renueva y se sigue. Siete días es holgado: aun con el complejo cerrado una semana entera, la
primera reserva que entre después renueva a tiempo.

**Mercado Pago rota el token de refresco**: cada uso lo invalida y devuelve uno nuevo. Si dos
reservas simultáneas intentan renovar a la vez, una gana y la otra se queda con un token muerto —
y ahí se pierde la vinculación entera sin que nadie haya hecho nada mal. **La renovación tiene que
estar serializada en la base de datos**, no con una variable del proceso: hay un solo backend hoy,
pero un lock de proceso es una bomba de tiempo para el día que haya dos.

**Si la renovación falla**, la cuenta queda marcada como caída y el panel lo muestra en rojo con un
botón para revincular. No se rompe el checkout con un error opaco.

## Qué ve el panel

La tarjeta muestra siempre en qué estado está: sin vincular, vinculada (con el apodo de la cuenta y
cuándo vence), o caída. Avisa cuando faltan menos de dos semanas para el vencimiento.

Esto importa más de lo que parece: **sin cuenta vinculada la web pública no vende**. Una vinculación
caída es plata que deja de entrar, así que tiene que gritar, no esconderse.

**Desvincular** pide confirmación explícita advirtiendo que se cortan los cobros online, y borra los
tokens.

## Sin cuenta vinculada no se cobra online

No hay fallback. **`MP_ACCESS_TOKEN` se elimina del backend.**

El motivo es concreto: esa variable tiene el token del desarrollador, no el del complejo. Dejarla
como red significaría que, ante cualquier problema de vinculación, las señas del complejo caen en
la cuenta equivocada **sin que nadie se entere**. Un canal de venta cerrado se ve; plata que va al
bolsillo de otro, no.

Y una variable que ya no hace nada pero sigue declarada es exactamente el patrón que causó el bug
de "no puede generar el enlace de pago": credenciales que parecen configuradas y no lo están.

Con la cuenta desvinculada, la web pública **no toma reservas**: muestra que hay que reservar por
WhatsApp o por teléfono. Para eso el backend le informa si los cobros online están activos, sumando
ese dato al endpoint de configuración que la web ya consulta.

### Consecuencia en el deploy

El día que esto se despliegue, **las reservas online quedan cerradas hasta que el dueño apriete
Vincular**. Es deliberado. Hay que desplegar y vincular seguido, y avisarle antes.

## Seguridad del ida y vuelta

Se manda un parámetro `state` firmado y se verifica al volver. Sin eso, cualquiera puede armar un
enlace que vincule *su* cuenta al sistema del complejo y quedarse con las señas.

La vinculación y la desvinculación son acciones de administrador: van detrás de `authJwt` +
`requireRole('ADMIN')`, y quedan registradas en la auditoría como cualquier otro cambio sensible.

## Manejo de errores

- Falta `MP_CLIENT_ID`, `MP_CLIENT_SECRET` o `MP_ENCRYPTION_KEY` → el mismo trato que hoy da
  `requerida()` en `mercadoPago.service.ts`: un error que **nombra la variable que falta**, no un
  "algo salió mal".
- El usuario cancela la autorización en Mercado Pago → vuelve al panel con un aviso claro, sin
  tocar la vinculación anterior si había una.
- `state` inválido o vencido → se rechaza y no se guarda nada.
- Mercado Pago rechaza el intercambio del código → la vinculación no se crea y el error se muestra
  tal cual llega, no se traga.

## Verificación

Nada de esto puede pegarle a Mercado Pago de verdad en los tests: el cliente de MP se sustituye.
Contra la base real se cubre:

- Vincular guarda los tokens **y en la base no se leen en claro**.
- Desvincular los borra.
- Un token por vencer se renueva solo y guarda el par nuevo.
- Dos renovaciones simultáneas no se pisan: una sola renovación efectiva, la vinculación sobrevive.
- Una renovación fallida deja la cuenta caída en vez de romper el checkout.
- Un `state` adulterado se rechaza.
- Sin cuenta vinculada, la web pública no toma reservas y el endpoint de configuración lo informa.
- Con cuenta vinculada, la preferencia se crea con el token del vendedor.

## Fuera de alcance

- **Comisión por operación** (`marketplace_fee`): no se pidió y arrastra consecuencias fiscales.
- **Más de una cuenta vinculada** a la vez.
- **Mover `MP_WEBHOOK_SECRET` al panel**: vive en la aplicación del desarrollador y no cambia.
- **Migrar automáticamente** desde `MP_ACCESS_TOKEN`: no es posible, ese token es de otra cuenta.
