import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Equalização de Propostas — Mercado Livre de Energia",
  description: "Equalização de propostas de energia: extração dos PDFs, VPL, aderência e ranking.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
