import Link from "next/link";
import type { ReactNode } from "react";

const icone = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

const ABAS: { href: "/" | "/pld"; rotulo: string; icone: ReactNode }[] = [
  {
    href: "/",
    rotulo: "Equalização de propostas",
    icone: icone(<><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></>),
  },
  {
    href: "/pld",
    rotulo: "PLD × Energia i5 Spot",
    icone: icone(<><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>),
  },
];

export default function MenuAbas({ ativa }: { ativa: "/" | "/pld" }) {
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
