import { comparar } from "./comparativo";
import type { Narrativa } from "./relatorio";
import type { Resultado } from "./types";

const n = (v: number, casas = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const limpa = (t: string) => t.replace(/−/g, "-"); // a fonte do PDF não tem o sinal "−"

/** R$ 71 mil (a partir de R$ 10 mil) ou R$ 4.321, sem centavos: o jeito de citar valores para um decisor. */
const reaisCurto = (v: number) => (v >= 10000 ? `R$ ${Math.round(v / 1000).toLocaleString("pt-BR")} mil` : `R$ ${Math.round(v).toLocaleString("pt-BR")}`);

/** Fatos do comparativo 1º × 2º que a LLM pode usar; null se não houver duas propostas calculadas. */
export function fatosDoComparativo(resultado: Resultado): Record<string, unknown> | null {
  const topo = (resultado.memoria ?? [])
    .filter((m) => m.calculo && typeof m.Rank === "number")
    .sort((p, q) => (p.Rank as number) - (q.Rank as number))
    .slice(0, 2);
  if (topo.length < 2) return null;
  const [a, b] = topo;
  const cmp = comparar(resultado, a, b);
  if (!cmp) return null;

  const econ = cmp.totalB.valor - cmp.totalA.valor; // > 0: o 1º é o mais barato
  const primeiroEMaisBarato = econ >= 0;
  const maiorValor = Math.max(cmp.totalA.valor, cmp.totalB.valor);
  const dif = Math.abs(econ);
  const difPreco = Math.abs(cmp.totalB.media - cmp.totalA.media);
  const nomeMaisBarata = primeiroEMaisBarato ? a.Fornecedor : b.Fornecedor;

  const criterio = (r: string) => r.replace(/\s*[+\-−]$/, ""); // "Flexibilidade inferior −" -> "Flexibilidade inferior"
  const ganhaPrimeiro = cmp.pontos.filter((p) => p.a - p.b >= 0.05).map((p) => `${criterio(p.rotulo)} (+${n(p.a - p.b, 1)} ponto(s))`);
  const ganhaSegundo = cmp.pontos.filter((p) => p.b - p.a >= 0.05).map((p) => `${criterio(p.rotulo)} (+${n(p.b - p.a, 1)} ponto(s))`);

  return JSON.parse(limpa(JSON.stringify({
    primeiro: { nome: a.Fornecedor, pontuacao_total: n(a.Pontuação ?? 0, 1), preco_medio: `R$ ${n(cmp.totalA.media)}/MWh` },
    segundo: { nome: b.Fornecedor, pontuacao_total: n(b.Pontuação ?? 0, 1), preco_medio: `R$ ${n(cmp.totalB.media)}/MWh` },
    mais_barata: nomeMaisBarata,
    primeiro_e_o_mais_barato: primeiroEMaisBarato,
    anos_do_contrato: cmp.anos.length,
    valores_para_citar: {
      diferenca_de_preco_no_periodo: reaisCurto(dif),
      diferenca_percentual: `${n(maiorValor > 0 ? (dif / maiorValor) * 100 : 0, 1)}%`,
      diferenca_de_preco_por_ano: reaisCurto(dif / cmp.anos.length),
      diferenca_do_preco_medio: `R$ ${n(difPreco)}/MWh`,
    },
    pontuacao_onde_o_primeiro_ganha: ganhaPrimeiro,
    pontuacao_onde_o_segundo_ganha: ganhaSegundo,
    condicoes_que_diferem: cmp.condicoes
      .filter((c) => c.diferente)
      .map((c) => ({ condicao: c.item, primeiro: c.a ?? "não informado", segundo: c.b ?? "não informado" })),
    alertas_das_regras: cmp.atencao,
  })));
}

/**
 * Texto do comparativo escrito pela LLM (cache no servidor: mesmos fatos => mesmo texto).
 * Qualquer falha (API fora, texto recusado na conferência, demora) devolve undefined e o relatório
 * usa o texto das regras fixas.
 */
export async function narrativaDoComparativo(resultado: Resultado, limiteMs = 120000): Promise<Narrativa | undefined> {
  const fatos = fatosDoComparativo(resultado);
  if (!fatos) return undefined;
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), limiteMs);
  try {
    const resp = await fetch("/api/narrativa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fatos }),
      signal: controle.signal,
    });
    if (!resp.ok) return undefined;
    const j = (await resp.json()) as { destaque?: string; topicos?: string[]; atencao?: string[] };
    if (!j.destaque || !j.topicos?.length || !j.atencao?.length) return undefined;
    return { resumo: { destaque: j.destaque, topicos: j.topicos }, atencao: j.atencao };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
