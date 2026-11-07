"use client";

import MenuAbas from "../MenuAbas";
import { useEffect, useMemo, useState } from "react";
import { abrirEqualizacao, consolidar, listarEqualizacoes } from "@/lib/api";
import { comparar } from "@/lib/comparativo";
import type { EqualizacaoSalva, ResumoEqualizacao } from "@/lib/equalizacoes";

const n = (v: number, casas = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const sinal = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "");

export default function Comparativo() {
  const [lista, setLista] = useState<ResumoEqualizacao[] | null>(null);
  const [idEscolhido, setIdEscolhido] = useState("");
  const [eq, setEq] = useState<EqualizacaoSalva | null>(null);
  const [nomeA, setNomeA] = useState("");
  const [nomeB, setNomeB] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    listarEqualizacoes().then(setLista).catch((e) => { setErro((e as Error).message); setLista([]); });
  }, []);

  async function escolher(id: string) {
    setIdEscolhido(id);
    setEq(null);
    setErro("");
    if (!id) return;
    setCarregando(true);
    try {
      let salva = await abrirEqualizacao(id);
      if (!salva.resultado.memoria?.length) {
        // Salva antes do log de cálculo existir: recalcula só para exibição (não altera o que está salvo).
        const res = await consolidar(salva.propostas, salva.cliente, salva.params);
        salva = { ...salva, resultado: res };
      }
      const ordem = (salva.resultado.memoria ?? []).filter((m) => m.calculo);
      setEq(salva);
      setNomeA(ordem[0]?.Fornecedor ?? "");
      setNomeB(ordem[1]?.Fornecedor ?? "");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  const memoria = useMemo(() => (eq?.resultado.memoria ?? []).filter((m) => m.calculo), [eq]);
  const a = memoria.find((m) => m.Fornecedor === nomeA);
  const b = memoria.find((m) => m.Fornecedor === nomeB);
  const cmp = useMemo(() => (eq && a && b && a !== b ? comparar(eq.resultado, a, b) : null), [eq, a, b]);
  const rotulo = (m: { Fornecedor: string; Rank: number | "-" }) => `${m.Rank}º no RANK — ${m.Fornecedor}`;

  return (
    <>
      <header>
        <div className="topo">
          <div className="topo-interno">
            <div className="marca">Análise de Viabilidade</div>
            <h1>Comparar propostas <i>1º × 2º do RANK</i></h1>
            <p>Compare lado a lado preço, valor estimado, condições comerciais e pontos de atenção de duas propostas da equalização.</p>
          </div>
          <MenuAbas ativa="/comparativo" />
        </div>
      </header>
      <main>
        <div className="secao">Equalização</div>
        <div className="cartao">
          <label htmlFor="eq">Escolha a equalização salva</label>
          <select id="eq" value={idEscolhido} onChange={(e) => escolher(e.target.value)} disabled={lista === null || carregando}>
            <option value="">{lista === null ? "Carregando…" : lista.length === 0 ? "Nenhuma equalização salva" : "Selecione…"}</option>
            {(lista ?? []).map((l) => (
              <option key={l.id} value={l.id}>{l.razaoSocial} — {l.periodo} · 1º no RANK: {l.lider} · {new Date(l.atualizadoEm).toLocaleDateString("pt-BR")}</option>
            ))}
          </select>
          {carregando && <p className="nota">Abrindo e calculando a equalização…</p>}
          {erro && <div className="erro-msg">{erro}</div>}

          {eq && memoria.length < 2 && (
            <p className="nota" style={{ marginTop: 12 }}>
              Esta equalização não tem duas propostas com dados suficientes para comparar.
            </p>
          )}

          {eq && memoria.length >= 2 && (
            <div className="linha" style={{ marginTop: 14 }}>
              <div style={{ flex: "1 1 260px" }}>
                <label htmlFor="pa">Proposta A</label>
                <select id="pa" value={nomeA} onChange={(e) => setNomeA(e.target.value)}>
                  {memoria.map((m) => <option key={m.Fornecedor} value={m.Fornecedor}>{rotulo(m)}</option>)}
                </select>
              </div>
              <div style={{ flex: "1 1 260px" }}>
                <label htmlFor="pb">Proposta B</label>
                <select id="pb" value={nomeB} onChange={(e) => setNomeB(e.target.value)}>
                  {memoria.map((m) => <option key={m.Fornecedor} value={m.Fornecedor}>{rotulo(m)}</option>)}
                </select>
              </div>
            </div>
          )}
          {eq && a && b && a === b && <p className="nota" style={{ marginTop: 12 }}>Escolha duas propostas diferentes para comparar.</p>}
        </div>

        {cmp && a && b && (
          <>
            <div className="secao">Resumo</div>
            <div className="cartao destaque-resumo"><p style={{ margin: 0, lineHeight: 1.6 }}>{cmp.resumo}</p></div>

            <div className="secao">1. Preço e valor estimado</div>
            <div className="tabela-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ano</th><th>Energia (MWh)</th><th>{a.Fornecedor} (R$/MWh)</th><th>{b.Fornecedor} (R$/MWh)</th>
                    <th>Diferença B − A</th><th>Valor {a.Fornecedor} (R$)</th><th>Valor {b.Fornecedor} (R$)</th>
                  </tr>
                </thead>
                <tbody>
                  {cmp.anos.map((x) => {
                    const d = x.precoB - x.precoA;
                    return (
                      <tr key={x.ano}>
                        <td>{x.ano}</td>
                        <td>{Math.abs(x.mwhA - x.mwhB) < 0.001 ? n(x.mwhA) : `${n(x.mwhA)} / ${n(x.mwhB)}`}</td>
                        <td>{n(x.precoA)}</td><td>{n(x.precoB)}</td>
                        <td>{sinal(d)}{n(Math.abs(d))} ({sinal(d)}{n(Math.abs((d / x.precoA) * 100), 1)}%)</td>
                        <td>{n(x.valorA)}</td><td>{n(x.valorB)}</td>
                      </tr>
                    );
                  })}
                  <tr className="total">
                    <td>Total / média</td>
                    <td>{Math.abs(cmp.totalA.mwh - cmp.totalB.mwh) < 0.001 ? n(cmp.totalA.mwh) : `${n(cmp.totalA.mwh)} / ${n(cmp.totalB.mwh)}`}</td>
                    <td>{n(cmp.totalA.media)}</td><td>{n(cmp.totalB.media)}</td>
                    <td>{sinal(cmp.totalB.media - cmp.totalA.media)}{n(Math.abs(cmp.totalB.media - cmp.totalA.media))} ({sinal(cmp.totalB.media - cmp.totalA.media)}{n(Math.abs(((cmp.totalB.media - cmp.totalA.media) / cmp.totalA.media) * 100), 1)}%)</td>
                    <td>{n(cmp.totalA.valor)}</td><td>{n(cmp.totalB.valor)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="nota">Valor = preço × MWh de cada mês (horas do mês × volume em MWm; ano bissexto com 8.784 h). A média é ponderada pela energia. Diferença da diferença total: R$ {n(Math.abs(cmp.totalB.valor - cmp.totalA.valor))}.</p>

            <div className="secao">2. Pontuação do RANK por critério</div>
            <div className="tabela-wrap">
              <table>
                <thead><tr><th>Critério</th><th>{a.Fornecedor}</th><th>{b.Fornecedor}</th><th>Diferença A − B</th></tr></thead>
                <tbody>
                  {cmp.pontos.map((p) => (
                    <tr key={p.chave}>
                      <td>{p.rotulo}</td><td>{n(p.a)}</td><td>{n(p.b)}</td>
                      <td>{Math.abs(p.a - p.b) < 0.005 ? "—" : `${sinal(p.a - p.b)}${n(Math.abs(p.a - p.b))}`}</td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td>Total (0 a 100)</td><td>{a.Pontuação != null ? n(a.Pontuação, 1) : "—"}</td><td>{b.Pontuação != null ? n(b.Pontuação, 1) : "—"}</td>
                    <td>{a.Pontuação != null && b.Pontuação != null ? `${sinal(a.Pontuação - b.Pontuação)}${n(Math.abs(a.Pontuação - b.Pontuação), 1)}` : "—"}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="secao">3. Condições comerciais</div>
            <div className="tabela-wrap">
              <table>
                <thead><tr><th>Item</th><th>{a.Fornecedor}</th><th>{b.Fornecedor}</th></tr></thead>
                <tbody>
                  {cmp.condicoes.map((c) => (
                    <tr key={c.item} className={c.diferente ? "difere" : ""}>
                      <td><strong>{c.item}</strong></td>
                      <td>{c.a ?? <span className="nota">não informado</span>}</td>
                      <td>{c.b ?? <span className="nota">não informado</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="nota">Linhas destacadas em amarelo indicam diferença entre as propostas.</p>

            <div className="secao">4. Pontos de atenção</div>
            <div className="cartao">
              {cmp.atencao.length === 0 ? <p style={{ margin: 0 }}>Nenhum ponto de atenção identificado nos dados disponíveis.</p> : (
                <ol className="atencao">{cmp.atencao.map((t, i) => <li key={i}>{t}</li>)}</ol>
              )}
            </div>
          </>
        )}
      </main>
    </>
  );
}
