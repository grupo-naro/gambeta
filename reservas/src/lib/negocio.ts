// Datos del predio. Fuente única del sitio de reservas.
//
// Los campos vacíos están PENDIENTES del cliente. Se dejan vacíos a propósito:
// la UI degrada de forma visible cuando faltan. NO inventar números ni handles.

// Sin `as const` a propósito: con él, los campos pendientes se tiparían como el
// literal '' y TypeScript estrecharía los ternarios de la UI a `never`. Acá
// queremos `string`, porque estos valores van a cambiar.
export const negocio = {
  nombre: 'Gambeteando',
  rubro: 'Pádel y Fútbol',

  whatsapp: {
    /** PENDIENTE. Formato internacional, sin "+" ni espacios. Ej: '5492371234567'. */
    numero: '',
    mensaje: '¡Hola! Quiero hacer una consulta sobre las canchas.',
  },

  direccion: {
    /** PENDIENTE: calle y altura. */
    calle: '',
    localidad: 'General Rodríguez',
    provincia: 'Buenos Aires',
    /** PENDIENTE: link de Google Maps. */
    mapsUrl: '',
  },

  horarios: {
    resumen: 'Lunes a lunes, de 9 a 24 hs',
  },

  redes: {
    /** PENDIENTE: URL completa del perfil. */
    instagram: '',
    /** PENDIENTE: URL completa del perfil. */
    tiktok: '',
  },
};

/**
 * URL de wa.me con el mensaje precargado.
 * Devuelve `null` si todavía no se cargó el número, para que la UI muestre
 * un estado honesto en vez de un link roto.
 */
export function whatsappUrl(mensaje?: string): string | null {
  if (!negocio.whatsapp.numero) return null;
  const texto = encodeURIComponent(mensaje ?? negocio.whatsapp.mensaje);
  return `https://wa.me/${negocio.whatsapp.numero}?text=${texto}`;
}

/** Dirección en una línea, sin comas colgando cuando falta la calle. */
export function direccionCompleta(): string {
  return [negocio.direccion.calle, negocio.direccion.localidad, negocio.direccion.provincia]
    .filter(Boolean)
    .join(', ');
}
