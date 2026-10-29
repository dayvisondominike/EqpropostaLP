"use client";

import { useMemo, useState } from "react";
import { consolidar, enviarPdf, extrairCliente, extrairFornecedor } from "@/lib/api";
import {
  SUBMERCADOS,
  type Cliente,
  type Fornecedor,
  type Params,
  type Proposta,
  type Resultado,
} from "@/lib/types";

const CONCORRENCIA = 3;

const moeda = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function baixarXlsx(xlsx: Resultado["xlsx"]) {
  const bytes = Uint8Array.from(atob(xlsx.base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = xlsx.nome;
  a.click();
  URL.revokeObjectURL(a.href);
}

function tagAderencia(status: string) {
  const classe = status.startsWith("Não") ? "no" : status.includes("ressalvas") ? "res" : status.startsWith("Aderente") ? "ok" : "";
  return <span className={`tag ${classe}`}>{status}</span>;
}

export default function Home() {
  const [email, setEmail] = useState<File | null>(null);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [nomeNovo, setNomeNovo] = useState("");
  const [arquivosNovos, setArquivosNovos] = useState<File[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState("");
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [propostas, setPropostas] = useState<Proposta[]>([]);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [params, setParams] = useState<Params | null>(null);

  const atualizar = (id: string, patch: Partial<Fornecedor>) =>
    setFornecedores((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  function adicionarFornecedor() {
    const nome = nomeNovo.trim();
    if (!nome || arquivosNovos.length === 0) return;
    setFornecedores((fs) => [
      ...fs,
      { id: crypto.randomUUID(), nome, arquivos: arquivosNovos, estado: "pendente" },
    ]);
    setNomeNovo("");
    setArquivosNovos([]);
    (document.getElementById("arq-fornecedor") as HTMLInputElement | null)?.value &&
      ((document.getElementById("arq-fornecedor") as HTMLInputElement).value = "");
  }

  async function processar() {
    if (!email || fornecedores.length === 0) return;
    setOcupado(true);
    setErro("");
    setResultado(null);
    setProgresso(0);
    try {
      setMensagem("Lendo o e-mail de cotação do cliente…");
      const urlEmail = await enviarPdf(email, "Caracteristicas_Produto");
      const resp = await extrairCliente(urlEmail);
      setCliente(resp.dados);

      const total = fornecedores.length;
      let feitos = 0;
      const coletadas: (Proposta | undefined)[] = new Array(total);
      let proximo = 0;

      async function trabalhador() {
        while (proximo < total) {
          const i = proximo++;
          const f = fornecedores[i];
          atualizar(f.id, { estado: "processando", detalhe: "enviando PDFs…" });
          try {
            const urls = await Promise.all(f.arquivos.map((a) => enviarPdf(a, f.nome)));
            atualizar(f.id, { detalhe: "extraindo dados…" });
            const r = await extrairFornecedor(f.nome, urls);
            coletadas[i] = r.dados;
            atualizar(f.id, { estado: "concluido", detalhe: r.origem });
          } catch (e) {
            atualizar(f.id, { estado: "erro", detalhe: (e as Error).message });
          }
          feitos++;
          setProgresso(Math.round((feitos / total) * 90));
          setMensagem(`Analisando propostas: ${feitos}/${total}`);
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, total) }, trabalhador));

      const validas = coletadas.filter((p): p is Proposta => p !== undefined);
      if (validas.length === 0) throw new Error("Nenhuma proposta pôde ser processada.");
      setPropostas(validas);

      setMensagem("Calculando VPL, aderência e ranking…");
      const res = await consolidar(validas, resp.dados);
      setResultado(res);
      setParams(res.params);
      setProgresso(100);
      setMensagem("Equalização concluída.");
    } catch (e) {
      setErro((e as Error).message);
      setMensagem("");
    } finally {
      setOcupado(false);
    }
  }

  async function recalcular() {
    if (!cliente || !params) return;
    setOcupado(true);
    setErro("");
    try {
      const res = await consolidar(propostas, cliente, params);
      setResultado(res);
      setParams(res.params);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const lider = resultado?.ranking.find((r) => r.Rank !== "-");
  const propostaLider = useMemo(
    () => resultado?.propostas.find((p) => p.Fornecedor === lider?.Fornecedor),
    [resultado, lider],
  );
  const precosLider = useMemo(() => {
    if (!propostaLider) return [] as { ano: string; preco: number }[];
    return Object.entries(propostaLider)
      .map(([k, v]) => ({ m: k.match(/^Preço (\d{4}) /), v }))
      .filter((x) => x.m && typeof x.v === "number")
      .map((x) => ({ ano: x.m![1], preco: x.v as number }));
  }, [propostaLider]);
  const maxPreco = Math.max(1, ...precosLider.map((p) => p.preco));

  const setP = <K extends keyof Params>(k: K, v: Params[K]) => setParams((p) => (p ? { ...p, [k]: v } : p));
  const num = (v: string) => (v === "" ? 0 : Number(v));

  return (
    <main>
      <div className="header">
        <div className="icone">⚡</div>
        <div>
          <h1>Equalização de Propostas — Mercado Livre de Energia</h1>
          <p>{cliente?.["Razão Social"] ? `Cliente: ${cliente["Razão Social"]}` : "Envie os PDFs para começar"}</p>
        </div>
      </div>

      <div className="secao">1. E-mail de cotação do cliente</div>
      <div className="cartao">
        <label htmlFor="email">PDF do e-mail (características do produto)</label>
        <input id="email" type="file" accept="application/pdf" disabled={ocupado} onChange={(e) => setEmail(e.target.files?.[0] ?? null)} />
      </div>

      <div className="secao">2. Propostas dos fornecedores</div>
      <div className="cartao">
        <div className="linha">
          <div style={{ flex: "1 1 180px" }}>
            <label htmlFor="nome">Fornecedor</label>
            <input id="nome" value={nomeNovo} disabled={ocupado} onChange={(e) => setNomeNovo(e.target.value)} placeholder="Ex.: Engie" />
          </div>
          <div style={{ flex: "2 1 260px" }}>
            <label htmlFor="arq-fornecedor">PDF(s) da proposta</label>
            <input id="arq-fornecedor" type="file" accept="application/pdf" multiple disabled={ocupado} onChange={(e) => setArquivosNovos(Array.from(e.target.files ?? []))} />
          </div>
          <button className="sec" onClick={adicionarFornecedor} disabled={ocupado || !nomeNovo.trim() || arquivosNovos.length === 0}>
            + Adicionar
          </button>
        </div>
        {fornecedores.length > 0 && (
          <div className="grade" style={{ marginTop: 14 }}>
            {fornecedores.map((f) => (
              <div key={f.id} className={`chip ${f.estado}`}>
                <div>
                  <strong>{f.nome}</strong>
                  <small>
                    {f.arquivos.length} arquivo(s){f.detalhe ? ` · ${f.detalhe}` : ""}
                  </small>
                </div>
                {!ocupado && f.estado === "pendente" && (
                  <button className="sec" onClick={() => setFornecedores((fs) => fs.filter((x) => x.id !== f.id))}>
                    remover
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 18 }}>
        <button onClick={processar} disabled={ocupado || !email || fornecedores.length === 0}>
          ▶ Processar Equalização
        </button>
        {(ocupado || progresso > 0) && (
          <>
            <div className="barra"><div style={{ width: `${progresso}%` }} /></div>
            <div className="nota">{mensagem}</div>
          </>
        )}
        {erro && <div className="erro-msg">{erro}</div>}
      </div>

      {cliente && (
        <>
          <div className="secao">Dados do cliente</div>
          <div className="cartao grade">
            {["Razão Social", "CNPJ", "Modalidade", "Tipo de Energia", "Submercado", "Período", "Volume (MWm)", "Flexibilidade", "Sazo", "Modulação"].map((c) => (
              <div className="campo" key={c}>
                <small>{c}</small>
                <span>{cliente[c] ?? "—"}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {resultado && lider && params && (
        <>
          <div className="secao">Resumo</div>
          <div className="metricas">
            <div className="metrica"><div className="valor">{lider.Fornecedor}</div><div className="rotulo">1º COLOCADO NO RANK</div></div>
            <div className="metrica"><div className="valor">{moeda(lider["VPL (R$)"])}</div><div className="rotulo">VPL DO 1º COLOCADO</div></div>
            <div className="metrica"><div className="valor">{moeda(lider["Preço Médio (R$/MWh)"])}</div><div className="rotulo">PREÇO MÉDIO DO 1º COLOCADO</div></div>
            <div className="metrica"><div className="valor">{resultado.ranking.length}</div><div className="rotulo">PROPOSTAS RECEBIDAS</div></div>
          </div>

          {precosLider.length > 0 && (
            <div className="cartao" style={{ marginTop: 14 }}>
              <strong>Curva de preço — {lider.Fornecedor} (R$/MWh)</strong>
              <svg viewBox={`0 0 ${precosLider.length * 100} 130`} width="100%" style={{ maxHeight: 180, marginTop: 8 }} role="img" aria-label="Preço por ano do primeiro colocado">
                {precosLider.map((p, i) => {
                  const h = (p.preco / maxPreco) * 80;
                  return (
                    <g key={p.ano}>
                      <rect x={i * 100 + 20} y={100 - h} width={60} height={h} fill="#1f6f52" rx={4} />
                      <text x={i * 100 + 50} y={94 - h} textAnchor="middle" fontSize={12} fill="#2b2b23">{p.preco.toFixed(2)}</text>
                      <text x={i * 100 + 50} y={118} textAnchor="middle" fontSize={12} fill="#6b6b5e">{p.ano}</text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}

          <div className="secao">Ranking da equalização</div>
          <div className="tabela-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rank</th><th>Fornecedor</th><th>Flex</th><th>Tipo</th><th>Preço médio</th><th>VPL</th><th>Aderência</th><th>Observações</th>
                </tr>
              </thead>
              <tbody>
                {resultado.ranking.map((r) => (
                  <tr key={r.Fornecedor} className={r.Rank === 1 ? "lider" : ""}>
                    <td>{r.Rank}</td>
                    <td>{r.Fornecedor}</td>
                    <td>{r.Flex}</td>
                    <td>{r["Tipo de Proposta"]}</td>
                    <td>{moeda(r["Preço Médio (R$/MWh)"])}</td>
                    <td>{moeda(r["VPL (R$)"])}</td>
                    <td>{tagAderencia(r["Aderente ao Produto"])}</td>
                    <td>{r.Observações}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="secao">Parâmetros de cálculo e aderência</div>
          <div className="cartao">
            <div className="grade">
              <div><label>TMA (% a.a.)</label><input type="number" step="0.5" value={params.tma_pct} onChange={(e) => setP("tma_pct", num(e.target.value))} /></div>
              <div><label>Horas por ano</label><input type="number" value={params.horas_por_ano} onChange={(e) => setP("horas_por_ano", num(e.target.value))} /></div>
              <div><label>Ano base</label><input type="number" value={params.ano_base} onChange={(e) => setP("ano_base", num(e.target.value))} /></div>
              <div><label>Fonte incentivada exigida (%)</label><input type="number" step="5" value={params.fonte_percentual} onChange={(e) => setP("fonte_percentual", num(e.target.value))} /></div>
              <div>
                <label>Submercado</label>
                <select value={params.submercado} onChange={(e) => setP("submercado", e.target.value)}>
                  {SUBMERCADOS.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div><label>Período — início</label><input type="number" value={params.ano_inicio} onChange={(e) => setP("ano_inicio", num(e.target.value))} /></div>
              <div><label>Período — fim</label><input type="number" value={params.ano_fim} onChange={(e) => setP("ano_fim", num(e.target.value))} /></div>
              <div>
                <label>Modulação</label>
                <select value={params.modulacao} onChange={(e) => setP("modulacao", e.target.value as Params["modulacao"])}>
                  <option>Flat</option><option>Carga</option>
                </select>
              </div>
              <div><label>Flexibilidade superior + (%)</label><input type="number" step="5" value={params.flex_superior} onChange={(e) => setP("flex_superior", num(e.target.value))} /></div>
              <div><label>Flexibilidade inferior − (%)</label><input type="number" step="5" value={params.flex_inferior} onChange={(e) => setP("flex_inferior", num(e.target.value))} /></div>
              <div>
                <label>Sazonalização</label>
                <select value={params.sazonalizacao} onChange={(e) => setP("sazonalizacao", e.target.value as Params["sazonalizacao"])}>
                  <option>Flat</option><option>Personalizada</option>
                </select>
              </div>
              {params.sazonalizacao === "Personalizada" && (
                <>
                  <div><label>Sazonalização superior + (%)</label><input type="number" step="5" value={params.sazo_superior} onChange={(e) => setP("sazo_superior", num(e.target.value))} /></div>
                  <div><label>Sazonalização inferior − (%)</label><input type="number" step="5" value={params.sazo_inferior} onChange={(e) => setP("sazo_inferior", num(e.target.value))} /></div>
                </>
              )}
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="sec" onClick={recalcular} disabled={ocupado}>↻ Recalcular com estes parâmetros</button>
            </div>
          </div>

          <div className="secao">Exportar</div>
          <button onClick={() => baixarXlsx(resultado.xlsx)}>⬇️ Baixar planilha de equalização (.xlsx)</button>
          <p className="nota">O relatório em Word (.docx) será adicionado na Fase 2.</p>
        </>
      )}
    </main>
  );
}
