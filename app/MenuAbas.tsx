import Link from "next/link";
import type { ReactNode } from "react";

const icone = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

type Rota = "/" | "/comparativo" | "/pld";

const ABAS: { href: Rota; rotulo: string; icone: ReactNode }[] = [
  {
    href: "/",
    rotulo: "Equalização de propostas",
    icone: icone(<><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></>),
  },
  {
    href: "/comparativo",
    rotulo: "Comparar 1º × 2º do RANK",
    icone: icone(<><path d="M12 3v18" /><path d="M5 7h14" /><path d="M5 7l-3 7a3 3 0 0 0 6 0z" /><path d="M19 7l-3 7a3 3 0 0 0 6 0z" /></>),
  },
  {
    href: "/pld",
    rotulo: "PLD × Energia i5 Spot",
    icone: icone(<><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>),
  },
];

export default function MenuAbas({ ativa }: { ativa: Rota }) {
  return (
    <nav className="menu-abas" aria-label="Seções do app">
      <div className="menu-abas-interno">
        {ABAS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className={a.href === ativa ? "aba ativa" : "aba"}
            aria-current={a.href === ativa ? "page" : undefined}
          >
            {a.icone}
            {a.rotulo}
          </Link>
        ))}
      </div>
    </nav>
  );
}
