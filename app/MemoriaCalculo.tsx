"use client";

import { ROTULOS_PESOS, type MemoriaProposta, type Pesos } from "@/lib/types";

const n = (v: number, casas = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const reais = (v: number) => `R$ ${n(v)}`;

/** Seção retrátil com o log do cálculo do Preço Médio e do VPL de cada proposta e a explicação da pontuação. */
export default function MemoriaCalculo({ memoria, pesos }: { memoria?: MemoriaProposta[]; pesos: Pesos }) {
  const somaFlex = pesos.flex_inferior + pesos.flex_superior;
  const somaSazo = pesos.sazo_inferior + pesos.sazo_superior;
  return (
    <details className="memoria">
      <summary>Memória de cálculo — Preço Médio, VPL e sistema de pontuação</summary>
      <div className="memoria-corpo">
        <h3>Como o Preço Médio é calculado</h3>
        <ol>
          <li><strong>Horas de cada mês</strong> = 24 h × dias do mês (fevereiro tem 29 dias em ano bissexto; o ano soma 8.760 h ou 8.784 h).</li>
          <li><strong>MWh de cada mês</strong> = horas do mês × volume (MWm).</li>
          <li><strong>Faturamento de cada mês</strong> = preço do ano (R$/MWh) × MWh do mês.</li>
          <li>Soma-se o MWh e o faturamento de todos os meses do período.</li>
          <li><strong>Preço Médio</strong> = Σ faturamento ÷ Σ MWh.</li>
        </ol>
        <h3>Como o VPL é calculado</h3>
        <p>Para cada ano: preço × volume × horas por ano ÷ (1 + TMA)<sup>(ano − ano base)</sup>. O VPL é a soma desses valores.</p>

        <h3>Sistema de pontuação (0 a 100)</h3>
        <p>Cada proposta recebe de 0 a 100 pontos e o rank é a ordem decrescente de pontos. Os pesos são os dos Parâmetros:</p>
        <ul>
          <li><strong>Preço médio — até {n(pesos.preco, 0)} pts:</strong> posição entre a proposta mais barata (nota cheia) e a mais cara (zero).</li>
          <li><strong>VPL — até {n(pesos.vpl, 0)} pts:</strong> mesma regra, entre o menor e o maior VPL.</li>
          <li><strong>Flexibilidade — até {n(somaFlex, 0)} pts</strong> ({n(pesos.flex_inferior, 0)} no limite inferior e {n(pesos.flex_superior, 0)} no superior): ofertado ÷ solicitado pelo cliente, limitado a 100% (oferecer mais que o pedido não dá bônus).</li>
          <li><strong>Sazonalização — até {n(somaSazo, 0)} pts</strong> ({n(pesos.sazo_inferior, 0)} no limite inferior e {n(pesos.sazo_superior, 0)} no superior): mesma regra da flexibilidade.</li>
          <li><strong>Modulação — até {n(pesos.modulacao, 0)} pts:</strong> nota cheia se atende ao pedido do cliente (curva de carga também atende a Flat); senão zero.</li>
        </ul>
        <p>Empate (pontos iguais em 2 casas): desempata por menor preço médio, menor VPL, maior flexibilidade (inferior, depois superior), maior sazonalização (inferior, depois superior) e melhor modulação. Propostas sem dados ficam no fim, sem pontuação.</p>

        {!memoria || memoria.length === 0 ? (
          <p className="nota">Esta equalização foi salva antes do log existir. Clique em “Recalcular” para gerá-lo.</p>
        ) : (
          <>
            <h3>Pontos por critério</h3>
            <div className="tabela-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Rank</th><th>Fornecedor</th>
                    {ROTULOS_PESOS.map((p) => <th key={p.chave}>{p.rotulo}</th>)}
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {memoria.map((m) => (
                    <tr key={m.Fornecedor}>
                      <td>{m.Rank}</td><td>{m.Fornecedor}</td>
                      {ROTULOS_PESOS.map((p) => <td key={p.chave}>{m.pontos ? n(m.pontos[p.chave]) : "—"}</td>)}
                      <td><strong>{m.Pontuação != null ? n(m.Pontuação, 1) : "—"}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3>Log do cálculo por proposta</h3>
            {memoria.map((m) => (
              <div key={m.Fornecedor} className="memoria-proposta">
                <strong>{m.Rank}º — {m.Fornecedor}</strong>
                {!m.calculo ? (
                  <p className="nota">Sem dados para calcular.</p>
                ) : (
                  <div className="tabela-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Ano</th><th>Preço (R$/MWh)</th><th>Horas</th><th>MWh ({n(m.calculo.volume, 3)} MWm)</th>
                          <th>Faturamento (R$)</th><th>Fator 1/(1+TMA)^t</th><th>VPL do ano (R$)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {m.calculo.anos.map((a) => (
                          <tr key={a.ano}>
                            <td>{a.ano}</td><td>{n(a.preco)}</td><td>{n(a.horas, 0)}</td><td>{n(a.mwh, 3)}</td>
                            <td>{n(a.faturamento)}</td><td>{n(1 / a.fator, 4)}</td><td>{n(a.vpl)}</td>
                          </tr>
                        ))}
                        <tr className="total">
                          <td>Total</td><td></td><td></td><td>{n(m.calculo.mwh, 3)}</td><td>{n(m.calculo.faturamento)}</td><td></td><td>{n(m.calculo.vpl)}</td>
                        </tr>
                      </tbody>
                    </table>
                    <p className="nota">
                      Preço Médio = {reais(m.calculo.faturamento)} ÷ {n(m.calculo.mwh, 3)} MWh = <strong>{m.calculo.media != null ? reais(m.calculo.media) : "—"}</strong>/MWh
                      {" · "}VPL = <strong>{reais(m.calculo.vpl)}</strong> (TMA {n(m.calculo.tma * 100, 1)}% a.a., ano base {m.calculo.ano_base}, {n(m.calculo.horas_vpl, 0)} h/ano)
                    </p>
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </details>
  );
}
