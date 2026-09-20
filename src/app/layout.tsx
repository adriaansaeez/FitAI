import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Demo de carrera con Jev",
  description:
    "Demo local de una carrera simulada de 10 minutos con decisiones explicable de Jev. Datos ficticios; sin diagnóstico ni consejo médico.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
