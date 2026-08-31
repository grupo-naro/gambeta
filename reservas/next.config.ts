import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Build autocontenido para la imagen de Docker (deploy-prod). Copia solo lo necesario a
  // .next/standalone y expone server.js.
  output: "standalone",
  turbopack: { root: path.resolve(__dirname) },
  // El panel de reserva vive en la raíz: este subdominio no hace otra cosa.
  // `source` es un match exacto (no anida), así que /reservar/pago/exito y
  // /reservar/pago/pendiente —a donde vuelve el checkout de Mercado Pago— no se tocan.
  redirects() {
    return Promise.resolve([
      { source: "/reservar", destination: "/", permanent: true },
    ]);
  },
};

export default nextConfig;
