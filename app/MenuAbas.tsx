import Link from "next/link";

const ABAS = [
  { href: "/", rotulo: "Equalização de propostas" },
  { href: "/pld", rotulo: "PLD × Energia I5" },
];

export default function MenuAbas({ ativa }: { ativa: "/" | "/pld" }) {
  return (
    <nav className="menu-abas" aria-label="Seções do app">
      {ABAS.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className={a.href === ativa ? "aba ativa" : "aba"}
          aria-current={a.href === ativa ? "page" : undefined}
        >
          {a.rotulo}
        </Link>
      ))}
    </nav>
  );
}
