import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import "./globals.css";

const roboto = Roboto({ subsets: ["latin"], weight: ["300", "400", "500", "700", "900"], variable: "--fonte" });

export const metadata: Metadata = {
  title: "Equalização de Propostas — Mercado Livre de Energia",
  description: "Equalização de propostas de energia: extração dos PDFs, VPL, aderência e ranking.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={roboto.variable}>{children}</body>
    </html>
  );
}
