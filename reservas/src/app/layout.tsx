import type { Metadata } from "next";
import { Geist, Anton } from "next/font/google";
import { negocio } from "@/lib/negocio";
import { FirmaNaro } from "@/components/firma-naro";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Anton no es una fuente variable: `weight` es obligatorio y solo existe el 400.
const anton = Anton({
  variable: "--font-anton",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Gambeteando — Reservá tu cancha",
  description: `Canchas de pádel y fútbol en ${negocio.direccion.localidad}. Reservá online en minutos, sin llamados.`,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${anton.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <FirmaNaro />
      </body>
    </html>
  );
}
