import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  // Fija la raíz del workspace al dir del frontend. Sin esto, Next infiere
  // C:\Users\Lautaro (por un lockfile suelto) y el build falla.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
