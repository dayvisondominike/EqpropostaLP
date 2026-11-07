import type { CalculoAno, MemoriaProposta, Pesos, Resultado } from "./types";

const n = (v: number, casas = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const reais = (v: number) => `R$ ${n(v)}`;
const sinal = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "");
const abs = Math.abs;
const nomeCriterio = (r: string) => (r === "VPL" ? r : r.toLowerCase());

export type LinhaAno = {
  ano: number; mwhA: number; mwhB: number; precoA: number; precoB: number; valorA: number; valorB: number;
};

export type LinhaCondicao = { item: string; a: string | null; b: string | null; diferente: boolean };

export type Comparacao = {
  anos: LinhaAno[];
  totalA: { mwh: number; valor: number; media: number };
  totalB: { mwh: number; valor: number; media: number };
  resumo: string;
  pontos: { chave: keyof Pesos; rotulo: string; a: number; b: number }[];
  condicoes: LinhaCondicao[];
  atencao: string[];
};

type Prop = Record<string, unknown>;

const texto = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" || s === "NaN" || s === "nan" ? null : s;
};

/** Data "dd/mm/aaaa" (com hora opcional "às 18h" / "18:30") dentro de um texto; null se não houver. */
function lerData(s: string | null): Date | null {
  const m = s?.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\D+(\d{1,2})(?::(\d{2}))?\s*h?)?/i);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), m[4] ? Number(m[4]) : 23, m[5] ? Number(m[5]) : 59);
}

/** Limites (superior, inferior) em % de um campo bilateral; "+/- 30%" e "+30% / -30%" dão o mesmo par. null se não der para ler. */
export function limitesBilaterais(s: string | null): [number, number] | null {
  if (!s) return null;
  const num = (t: string) => Number(t.replace(",", "."));
  const simetrico = s.match(/(?:\+\s*\/?\s*[-−]|[-−]\s*\/?\s*\+|\+\s*ou\s*[-−]|[-−]\s*ou\s*\+|±)\s*(\d+(?:[.,]\d+)?)/i);
  if (simetrico) return [num(simetrico[1]), num(simetrico[1])];
  const pares = [...s.matchAll(/([+\-−])\s*(\d+(?:[.,]\d+)?)/g)].map((m) => [m[1], num(m[2])] as const);
  if (pares.length) {
    const sup = Math.max(...pares.filter(([sg]) => sg === "+").map(([, v]) => v), -1);
    const inf = Math.max(...pares.filter(([sg]) => sg !== "+").map(([, v]) => v), -1);
    return [sup >= 0 ? sup : inf, inf >= 0 ? inf : sup];
  }
  const solto = s.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (solto) return [num(solto[1]), num(solto[1])];
  return /flat|sem\s|nenhum|n[aã]o/i.test(s) ? [0, 0] : null;
}

const CONDICOES:{ item: string; chave: string }[] = [
  { item: "Natureza da proposta", chave: "Tipo de Proposta" },
  { item: "Fonte", chave: "Fonte" },
  { item: "Período", chave: "Período" },
  { item: "Flexibilidade", chave: "Flexibilidade" },
  { item: "Sazonalização", chave: "Sazonalidade" },
  { item: "Modulação", chave: "Modulação" },
  { item: "Garantia", chave: "Garantia" },
  { item: "Ressarcimento TUSD (R$/MWh)", chave: "RETUSD (R$/MWh)" },
  { item: "Pagamento", chave: "Pagamento" },
  { item: "Data-base", chave: "Data Base" },
  { item: "Data da proposta", chave: "Data da Proposta" },
  { item: "Validade da proposta", chave: "Validade da Proposta" },
];

const ROTULOS: Record<keyof Pesos, string> = {
  preco: "Preço médio", vpl: "VPL", flex_inferior: "Flexibilidade inferior −", flex_superior: "Flexibilidade superior +",
  sazo_inferior: "Sazonalização inferior −", sazo_superior: "Sazonalização superior +", modulacao: "Modulação",
};

/** Compara duas propostas (A = a escolhida primeiro, normalmente o 1º no RANK; B = a outra) com base no log de cálculo. */
export function comparar(resultado: Resultado, a: MemoriaProposta, b: MemoriaProposta, hoje = new Date()): Comparacao | null {
  if (!a.calculo || !b.calculo) return null;
  const porAnoB = new Map<number, CalculoAno>(b.calculo.anos.map((x) => [x.ano, x]));
  const anos: LinhaAno[] = a.calculo.anos
    .filter((x) => porAnoB.has(x.ano))
    .map((x) => {
      const y = porAnoB.get(x.ano)!;
      return { ano: x.ano, mwhA: x.mwh, mwhB: y.mwh, precoA: x.preco, precoB: y.preco, valorA: x.faturamento, valorB: y.faturamento };
    });
  if (anos.length === 0) return null;
  const soma = (campo: "mwhA" | "mwhB" | "valorA" | "valorB") => anos.reduce((s, x) => s + x[campo], 0);
  const totalA = { mwh: soma("mwhA"), valor: soma("valorA"), media: soma("valorA") / soma("mwhA") };
  const totalB = { mwh: soma("mwhB"), valor: soma("valorB"), media: soma("valorB") / soma("mwhB") };

  const nomeA = a.Fornecedor, nomeB = b.Fornecedor;
  const propA = (resultado.propostas.find((p) => p.Fornecedor === nomeA) ?? {}) as Prop;
  const propB = (resultado.propostas.find((p) => p.Fornecedor === nomeB) ?? {}) as Prop;
  const linhaA = resultado.ranking.find((r) => r.Fornecedor === nomeA);
  const linhaB = resultado.ranking.find((r) => r.Fornecedor === nomeB);

  // Preço: quem é mais barata e quanto.
  const maisBarataA = totalA.valor <= totalB.valor;
  const [barata, cara, valBarata, valCara] = maisBarataA ? [nomeA, nomeB, totalA.valor, totalB.valor] : [nomeB, nomeA, totalB.valor, totalA.valor];
  const difValor = valCara - valBarata;
  const pctDif = valCara > 0 ? (difValor / valCara) * 100 : 0;
  const anosBarata = anos.filter((x) => (maisBarataA ? x.precoA <= x.precoB : x.precoB <= x.precoA)).length;
  const frasePreco = difValor < 0.005
    ? `As duas propostas têm o mesmo valor no período.`
    : `A ${barata} é mais barata ${anosBarata === anos.length ? (anos.length === 1 ? `em ${anos[0].ano}` : `em todos os ${anos.length} anos`) : `em ${anosBarata} de ${anos.length} anos`}, com cerca de ${reais(difValor)} a menos (−${n(pctDif, 1)}%) no período.`;

  // Pontos por critério.
  const pontos = (Object.keys(ROTULOS) as (keyof Pesos)[]).map((k) => ({
    chave: k, rotulo: ROTULOS[k], a: a.pontos?.[k] ?? 0, b: b.pontos?.[k] ?? 0,
  }));
  const pA = a.Pontuação, pB = b.Pontuação;
  let frasePontos = "";
  if (pA != null && pB != null) {
    const dif = pA - pB;
    if (abs(dif) < 0.05) {
      frasePontos = ` Na pontuação do RANK as duas empatam (${n(pA, 1)} pontos).`;
    } else {
      const [lider, vice, pl, pv] = dif > 0 ? [nomeA, nomeB, pA, pB] : [nomeB, nomeA, pB, pA];
      const sinais = pontos.map((p) => ({ ...p, d: dif > 0 ? p.a - p.b : p.b - p.a })).filter((p) => abs(p.d) >= 0.05);
      const ganhos = sinais.filter((p) => p.d > 0).sort((x, y) => y.d - x.d).map((p) => `${nomeCriterio(p.rotulo)} (+${n(p.d, 1)})`);
      const perdas = sinais.filter((p) => p.d < 0).sort((x, y) => x.d - y.d).map((p) => `${nomeCriterio(p.rotulo)} (−${n(abs(p.d), 1)})`);
      frasePontos = ` Na pontuação, a ${lider} (${n(pl, 1)}) fica à frente da ${vice} (${n(pv, 1)})` +
        `${ganhos.length ? `, ganhando em ${ganhos.join(", ")}` : ""}${perdas.length ? `${ganhos.length ? " e perdendo em " : ", perdendo em "}${perdas.join(", ")}` : ""}.`;
    }
  }

  // Condições comerciais lado a lado.
  const condicoes: LinhaCondicao[] = CONDICOES.map(({ item, chave }) => {
    const va = texto(propA[chave]), vb = texto(propB[chave]);
    const limpa = (s: string | null) => (s ?? "").replace(/\s*\(ID[^)]*\)/i, "").toLowerCase();
    if (chave === "Flexibilidade" || chave === "Sazonalidade") {
      // Compara o significado (limites), não o texto: "+/- 30%" e "+30% / -30%" são iguais.
      const la = limitesBilaterais(va), lb = limitesBilaterais(vb);
      if (la && lb) return { item, a: va, b: vb, diferente: la[0] !== lb[0] || la[1] !== lb[1] };
    }
    return { item, a: va, b: vb, diferente: limpa(va) !== limpa(vb) };
  });
  const aderA = linhaA?.["Aderente ao Produto"], aderB = linhaB?.["Aderente ao Produto"];
  condicoes.push({ item: "Aderência ao produto do cliente", a: aderA ?? null, b: aderB ?? null, diferente: aderA !== aderB });

  // Pontos de atenção.
  const atencao: string[] = [];
  const lerCond = (item: string) => condicoes.find((c) => c.item === item)!;
  if (pA != null && pB != null && difValor >= 0.005) {
    const lidera = pA >= pB ? nomeA : nomeB;
    if (lidera !== barata) {
      atencao.push(`A ${lidera} lidera o RANK, mas não é a mais barata: escolhê-la custa cerca de ${reais(difValor)} a mais no período em relação à ${barata}, em troca das vantagens de pontuação acima.`);
    } else {
      atencao.push(`A ${barata} é, ao mesmo tempo, a mais barata e a que lidera o RANK.`);
    }
  }
  [[nomeA, propA], [nomeB, propB]].forEach(([nome, p]) => {
    const prop = p as Prop;
    const tipo = (texto(prop["Tipo de Proposta"]) ?? "").toLowerCase();
    const validade = texto(prop["Validade da Proposta"]);
    const fim = lerData(validade);
    if (fim && fim < hoje) atencao.push(`A proposta da ${nome} está vencida (validade: ${validade}). É preciso pedir a reabertura ou uma atualização.`);
    else if (!validade) atencao.push(`A proposta da ${nome} não informa prazo de validade${/indicativ|cota[cç][aã]o de mercado/.test(tipo) ? " e é apenas indicativa (cotação de mercado), ou seja, não está firme" : ""}: peça uma proposta firme com validade.`);
    else if (/indicativ/.test(tipo)) atencao.push(`A proposta da ${nome} é indicativa: peça uma proposta firme.`);
  });
  const garantia = lerCond("Garantia");
  if (!garantia.a && !garantia.b) atencao.push("Nenhuma das duas informa a garantia exigida: confirme com os fornecedores, pois ela pode mudar o custo real do contrato.");
  else if (garantia.diferente) atencao.push(`As garantias são diferentes (${nomeA}: ${garantia.a ?? "não informada"}; ${nomeB}: ${garantia.b ?? "não informada"}). Considere o custo de fiança ou seguro na comparação de preço.`);
  const retusd = lerCond("Ressarcimento TUSD (R$/MWh)");
  if (retusd.diferente) atencao.push(`O ressarcimento de TUSD é diferente (${nomeA}: ${retusd.a ?? "não informado"}; ${nomeB}: ${retusd.b ?? "não informado"}).`);
  ["Flexibilidade", "Sazonalização", "Modulação"].forEach((item) => {
    const c = lerCond(item);
    if (c.diferente) atencao.push(`${item} diferente: ${nomeA} ${c.a ?? "não informada"}; ${nomeB} ${c.b ?? "não informada"}.`);
  });
  if (aderA !== aderB) atencao.push(`A aderência ao produto do cliente é diferente: ${nomeA} — ${aderA ?? "sem dado"}; ${nomeB} — ${aderB ?? "sem dado"}.`);
  const faltando = condicoes
    .filter((c) => ["Garantia", "Pagamento", "Data-base", "Ressarcimento TUSD (R$/MWh)"].includes(c.item) && (!c.a || !c.b) && (c.a || c.b))
    .map((c) => `${c.item} (só ${c.a ? nomeA : nomeB} informa)`);
  if (faltando.length) atencao.push(`Itens informados por apenas uma das propostas, para confirmar com a outra: ${faltando.join("; ")}.`);
  if (a.calculo.volume !== b.calculo.volume) atencao.push(`Os volumes são diferentes (${nomeA}: ${n(a.calculo.volume, 3)} MWm; ${nomeB}: ${n(b.calculo.volume, 3)} MWm): a comparação de valor usa o MWh de cada proposta.`);

  return {
    anos, totalA, totalB,
    resumo: `${frasePreco}${frasePontos}`,
    pontos, condicoes, atencao,
  };
}
