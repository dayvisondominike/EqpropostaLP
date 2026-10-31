"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { lerSpreadSalvo } from "@/lib/ccee";
import { gerarRelatorioPdf, type DadosMercado } from "@/lib/relatorio";
import { abrirEqualizacao, buscarPld, ehArquivoAceito, ehPlanilha, identificarPdf, consolidar, enviarPdf, excluirEqualizacao, extrairCliente, extrairFornecedor, listarEqualizacoes, salvarEqualizacao } from "@/lib/api";
import type { ResumoEqualizacao } from "@/lib/equalizacoes";
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
  const [urlEmail, setUrlEmail] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [lendo, setLendo] = useState<{ nome: string; estado: "enviando" | "identificando" | "ok" | "erro"; detalhe: string }[]>([]);
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

  // Início: escolher entre abrir uma equalização do banco ou fazer uma nova.
  const [tela, setTela] = useState<"inicio" | "equalizacao">("inicio");
  const [existentes, setExistentes] = useState<ResumoEqualizacao[] | null>(null);
  const [erroLista, setErroLista] = useState("");
  const [abrindo, setAbrindo] = useState("");
  const [idSalvo, setIdSalvo] = useState<string | null>(null);
  const [avisoBanco, setAvisoBanco] = useState("");

  useEffect(() => {
    if (tela !== "inicio") return;
    setExistentes(null);
    setErroLista("");
    listarEqualizacoes().then(setExistentes).catch((e) => {
      setErroLista((e as Error).message);
      setExistentes([]);
    });
  }, [tela]);

  function novaEqualizacao() {
    setEmail(null);
    setUrlEmail(null);
    setLendo([]);
    setFornecedores([]);
    setCliente(null);
    setPropostas([]);
    setResultado(null);
    setParams(null);
    setIdSalvo(null);
    setAvisoBanco("");
    setErro("");
    setProgresso(0);
    setMensagem("");
    setTela("equalizacao");
  }

  async function abrirExistente(id: string) {
    setAbrindo(id);
    setErroLista("");
    try {
      const eq = await abrirEqualizacao(id);
      setEmail(null);
      setFornecedores([]);
      setCliente(eq.cliente);
      setPropostas(eq.propostas);
      setParams(eq.params);
      setResultado(eq.resultado);
      setIdSalvo(eq.id);
      setAvisoBanco(`Equalização aberta do banco (salva em ${new Date(eq.atualizadoEm).toLocaleString("pt-BR")}).`);
      setErro("");
      setProgresso(0);
      setMensagem("");
      setTela("equalizacao");
    } catch (e) {
      setErroLista((e as Error).message);
    } finally {
      setAbrindo("");
    }
  }

  async function excluirExistente(e: ResumoEqualizacao) {
    if (!window.confirm(`Excluir definitivamente a equalização de "${e.razaoSocial}"? Esta ação não pode ser desfeita.`)) return;
    setAbrindo(e.id);
    setErroLista("");
    try {
      await excluirEqualizacao(e.id);
      setExistentes((lista) => (lista ?? []).filter((x) => x.id !== e.id));
    } catch (err) {
      setErroLista((err as Error).message);
    } finally {
      setAbrindo("");
    }
  }

  /** Grava (ou atualiza) a equalização no banco; falha no banco não perde o resultado da tela. */
  async function guardar(res: Resultado, props: Proposta[], id: string | null) {
    try {
      const r = await salvarEqualizacao({ id: id ?? undefined, cliente: res.cliente, params: res.params, propostas: props, resultado: res });
      setIdSalvo(r.id);
      setAvisoBanco(`Salva no banco de equalizações em ${new Date().toLocaleString("pt-BR")}.`);
    } catch (e) {
      setAvisoBanco(`Não foi possível salvar no banco: ${(e as Error).message}`);
    }
  }

  const atualizar = (id: string, patch: Partial<Fornecedor>) =>
    setFornecedores((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  /** Recebe vários PDFs de uma vez: envia ao Blob, a LLM identifica o fornecedor de cada um e o app os agrupa. */
  async function receberArquivos(entrada: File[]) {
    const pdfs = entrada.filter((f) => ehArquivoAceito(f.name));
    if (pdfs.length === 0) {
      setErro("Solte apenas arquivos PDF, CSV ou XLSX.");
      return;
    }
    setErro("");
    setLendo(pdfs.map((f) => ({ nome: f.name, estado: "enviando", detalhe: "" })));
    const marcar = (i: number, p: Partial<(typeof lendo)[number]>) =>
      setLendo((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));

    type Lido = { arquivo: File; url: string; fornecedor: string; tipo: string; propostas?: Proposta[] };
    const lidos: (Lido | undefined)[] = new Array(pdfs.length);
    let proximo = 0;
    async function trabalhador() {
      while (proximo < pdfs.length) {
        const i = proximo++;
        try {
          const url = await enviarPdf(pdfs[i], "Arrastados");
          marcar(i, { estado: "identificando" });
          const r = await identificarPdf(url, pdfs[i].name);
          // O e-mail do cliente precisa ser PDF; planilha classificada assim é tratada como proposta se tiver fornecedor.
          const tipo = ehPlanilha(pdfs[i].name) && r.tipo === "email_cliente" ? (r.fornecedor ? "proposta" : "outro") : r.tipo;
          lidos[i] = { arquivo: pdfs[i], url, fornecedor: r.fornecedor, tipo, propostas: r.propostas };
          marcar(i, {
            estado: tipo === "outro" || (tipo !== "email_cliente" && !r.fornecedor) ? "erro" : "ok",
            detalhe: tipo === "tabela_cotacoes" ? `${r.propostas?.length ?? 0} cotações de fornecedores` : tipo === "email_cliente" ? "E-mail do cliente" : tipo === "outro" ? "Ignorado: não é proposta de fornecedor" : r.fornecedor || "Fornecedor não identificado",
          });
        } catch (e) {
          marcar(i, { estado: "erro", detalhe: (e as Error).message });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, pdfs.length) }, trabalhador));

    const chave = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const emails = lidos.filter((l): l is Lido => !!l && l.tipo === "email_cliente");
    if (emails.length > 0) {
      setEmail(emails[0].arquivo);
      setUrlEmail(emails[0].url);
    }
    const tabelas = lidos.filter((l): l is Lido => !!l && l.tipo === "tabela_cotacoes" && (l.propostas?.length ?? 0) > 0);
    const docs = lidos.filter((l): l is Lido => !!l && l.tipo !== "email_cliente" && l.tipo !== "outro" && l.tipo !== "tabela_cotacoes" && chave(l.fornecedor) !== "");
    setFornecedores((atuais) => {
      const lista = [...atuais];
      for (const d of docs) {
        const existente = lista.find((f) => f.estado === "pendente" && chave(f.nome) === chave(d.fornecedor));
        if (existente) {
          existente.arquivos = [...existente.arquivos, d.arquivo];
          existente.urls = [...(existente.urls ?? []), d.url];
        } else {
          lista.push({ id: crypto.randomUUID(), nome: d.fornecedor, arquivos: [d.arquivo], urls: [d.url], estado: "pendente" });
        }
      }
      // Planilha de cotações: cada linha já é uma proposta pronta (sem extração).
      for (const t of tabelas) {
        for (const p of t.propostas ?? []) {
          lista.push({ id: crypto.randomUUID(), nome: String(p.Fornecedor), arquivos: [t.arquivo], urls: [t.url], proposta: p, estado: "pendente" });
        }
      }
      return lista.map((f) => ({ ...f }));
    });
  }

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
      const urlDoEmail = urlEmail ?? (await enviarPdf(email, "Caracteristicas_Produto"));
      const resp = await extrairCliente(urlDoEmail);
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
            if (f.proposta) {
              coletadas[i] = { ...f.proposta, Fornecedor: f.nome.toUpperCase() };
              atualizar(f.id, { estado: "concluido", detalhe: "cotação da planilha" });
              feitos++;
              setProgresso(Math.round((feitos / total) * 90));
              setMensagem(`Analisando propostas: ${feitos}/${total}`);
              continue;
            }
            const urls = f.urls ?? (await Promise.all(f.arquivos.map((a) => enviarPdf(a, f.nome))));
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
      setMensagem("Salvando no banco…");
      await guardar(res, validas, idSalvo);
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
      await guardar(res, propostas, idSalvo);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const [gerandoPdf, setGerandoPdf] = useState(false);

  /** Busca o PLD do banco e o spread da tela PLD × I5; sem eles o relatório sai sem a página de mercado. */
  async function gerarPdf(r: Resultado) {
    setGerandoPdf(true);
    try {
      let mercado: DadosMercado | undefined;
      try {
        const pld = await buscarPld();
        mercado = { pld: pld.dados, spread: lerSpreadSalvo(), fonte: pld.fonte, atualizadoEm: pld.atualizadoEm };
      } catch { /* PLD indisponível: relatório sem a página PLD × Energia I5 */ }
      await gerarRelatorioPdf(r, mercado);
    } finally {
      setGerandoPdf(false);
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
  const comparativo = (resultado?.ranking ?? []).filter((r) => r["Preço Médio (R$/MWh)"] != null);
  const maxMedio = Math.max(1, ...comparativo.map((r) => r["Preço Médio (R$/MWh)"] ?? 0));

  const setP = <K extends keyof Params>(k: K, v: Params[K]) => setParams((p) => (p ? { ...p, [k]: v } : p));
  const num = (v: string) => (v === "" ? 0 : Number(v));

  return (
    <>
    <header>
      <div className="topo">
        <div className="topo-interno">
          <div className="marca">Análise de Viabilidade</div>
          <h1>Equalização <i>de propostas</i></h1>
          <p>Compare propostas de fornecedores por Preço Médio, VPL e aderência ao produto do cliente.</p>
          {cliente?.["Razão Social"] && <span className="cliente">Cliente: {cliente["Razão Social"]}</span>}
          <Link className="link-pld" href="/pld">PLD × Energia I5 →</Link>
          {tela === "equalizacao" && (
            <button className="voltar-inicio" onClick={() => setTela("inicio")} disabled={ocupado}>← Início</button>
          )}
        </div>
      </div>
      <div className="faixa" />
    </header>
    {tela === "inicio" ? (
    <main>
      <div className="secao">O que você deseja fazer?</div>
      <div className="grade">
        <div className="cartao opcao">
          <h3>Nova equalização</h3>
          <p className="nota">Envie o e-mail de cotação do cliente e as propostas dos fornecedores. O resultado é salvo automaticamente no banco.</p>
          <button className="destaque" onClick={novaEqualizacao}>+ Realizar nova equalização</button>
        </div>
      </div>

      <div className="secao">Equalizações existentes</div>
      {erroLista && <div className="erro-msg">{erroLista}</div>}
      {existentes === null ? (
        <p className="nota">Carregando equalizações…</p>
      ) : existentes.length === 0 ? (
        <p className="nota">Nenhuma equalização salva ainda.</p>
      ) : (
        <div className="tabela-wrap">
          <table>
            <thead>
              <tr><th>Cliente</th><th>CNPJ</th><th>Submercado</th><th>Período</th><th>1º colocado</th><th>Propostas</th><th>Atualizada em</th><th></th></tr>
            </thead>
            <tbody>
              {existentes.map((e) => (
                <tr key={e.id}>
                  <td><strong>{e.razaoSocial}</strong></td>
                  <td>{e.cnpj}</td>
                  <td>{e.submercado}</td>
                  <td>{e.periodo}</td>
                  <td>{e.lider}</td>
                  <td>{e.propostas}</td>
                  <td>{new Date(e.atualizadoEm).toLocaleString("pt-BR")}</td>
                  <td className="acoes-linha">
                    <button className="sec" onClick={() => abrirExistente(e.id)} disabled={abrindo !== ""}>{abrindo === e.id ? "Aguarde…" : "Abrir"}</button>
                    <button className="sec perigo" onClick={() => excluirExistente(e)} disabled={abrindo !== ""}>Excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
    ) : (
    <main>
      {avisoBanco && <p className="nota" style={{ marginTop: 14 }}>{avisoBanco}</p>}
      <div className="secao">Arraste todos os PDFs</div>
      <div
        className={`soltar ${arrastando ? "ativo" : ""}`}
        onDragOver={(e) => { e.preventDefault(); if (!ocupado) setArrastando(true); }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => { e.preventDefault(); setArrastando(false); if (!ocupado) receberArquivos(Array.from(e.dataTransfer.files)); }}
      >
        <strong>Solte aqui o e-mail do cliente e as propostas de todos os fornecedores (PDF, CSV ou XLSX, misturados)</strong>
        <span className="nota">A LLM identifica o fornecedor de cada arquivo (PDF ou planilha) e os agrupa automaticamente. Você pode corrigir os nomes abaixo.</span>
        <label className="botao sec" htmlFor="soltar-arquivos">Ou selecione os arquivos</label>
        <input id="soltar-arquivos" type="file" accept=".pdf,.csv,.xlsx,.xlsm,application/pdf,text/csv" multiple hidden disabled={ocupado}
          onChange={(e) => { receberArquivos(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      </div>
      {lendo.length > 0 && (
        <div className="grade" style={{ marginTop: 12 }}>
          {lendo.map((l, i) => (
            <div key={`${l.nome}-${i}`} className={`chip ${l.estado === "ok" ? "concluido" : l.estado === "erro" ? "erro" : "processando"}`}>
              <div>
                <strong>{l.nome}</strong>
                <small>{l.estado === "enviando" ? "enviando…" : l.estado === "identificando" ? "identificando o fornecedor…" : l.detalhe}</small>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="secao"><span className="num">1</span>E-mail de cotação do cliente</div>
      <div className="cartao">
        <label htmlFor="email">PDF do e-mail (características do produto)</label>
        {email && <p className="nota" style={{ margin: "0 0 8px" }}>Selecionado: <strong>{email.name}</strong></p>}
        <input id="email" type="file" accept="application/pdf" disabled={ocupado} onChange={(e) => { setEmail(e.target.files?.[0] ?? null); setUrlEmail(null); }} />
      </div>

      <div className="secao"><span className="num">2</span>Propostas dos fornecedores</div>
      <div className="cartao">
        <div className="linha">
          <div style={{ flex: "1 1 180px" }}>
            <label htmlFor="nome">Fornecedor</label>
            <input id="nome" value={nomeNovo} disabled={ocupado} onChange={(e) => setNomeNovo(e.target.value)} placeholder="Ex.: Engie" />
          </div>
          <div style={{ flex: "2 1 260px" }}>
            <label htmlFor="arq-fornecedor">PDF(s), CSV ou XLSX da proposta</label>
            <input id="arq-fornecedor" type="file" accept=".pdf,.csv,.xlsx,.xlsm,application/pdf,text/csv" multiple disabled={ocupado} onChange={(e) => setArquivosNovos(Array.from(e.target.files ?? []))} />
          </div>
          <button className="sec" onClick={adicionarFornecedor} disabled={ocupado || !nomeNovo.trim() || arquivosNovos.length === 0}>
            + Adicionar
          </button>
        </div>
        {fornecedores.length > 0 && (
          <div className="grade" style={{ marginTop: 14 }}>
            {fornecedores.map((f) => (
              <div key={f.id} className={`chip ${f.estado}`}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  {!ocupado && f.estado === "pendente" ? (
                    <input className="nome-fornecedor" value={f.nome} aria-label={`Nome do fornecedor ${f.nome}`}
                      onChange={(e) => atualizar(f.id, { nome: e.target.value })} />
                  ) : (
                    <strong>{f.nome}</strong>
                  )}
                  <small title={f.arquivos.map((a) => a.name).join("\n")}>
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

      <div className="acao">
        <button className="destaque" onClick={processar} disabled={ocupado || !email || fornecedores.length === 0}>
          {ocupado ? "Processando…" : "▶ Processar equalização"}
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
            <div className="grafico">
              <div className="cartao">
                <h3>Curva de preço — {lider.Fornecedor} (R$/MWh)</h3>
                <svg viewBox={`0 0 ${precosLider.length * 100} 130`} width="100%" style={{ maxHeight: 200 }} role="img" aria-label="Preço por ano do primeiro colocado">
                  {precosLider.map((p, i) => {
                    const h = (p.preco / maxPreco) * 80;
                    return (
                      <g key={p.ano}>
                        <rect x={i * 100 + 20} y={100 - h} width={60} height={h} fill={["#236c5f", "#108b75", "#70baac"][i % 3]} rx={4} />
                        <text x={i * 100 + 50} y={94 - h} textAnchor="middle" fontSize={12} fontWeight={700} fill="#1f2d2b">{p.preco.toFixed(2)}</text>
                        <text x={i * 100 + 50} y={118} textAnchor="middle" fontSize={12} fill="#5f6f6c">{p.ano}</text>
                      </g>
                    );
                  })}
                </svg>
              </div>
              <div className="cartao">
                <h3>Preço médio por proposta (R$/MWh)</h3>
                {comparativo.map((r) => (
                  <div className="hbar" key={r.Fornecedor}>
                    <div className="nome" title={r.Fornecedor}>{r.Fornecedor}</div>
                    <div className="trilho">
                      <div className={`preenche ${r.Rank === lider.Rank ? "lider" : ""}`} style={{ width: `${Math.max(12, ((r["Preço Médio (R$/MWh)"] ?? 0) / maxMedio) * 100)}%` }}>
                        {(r["Preço Médio (R$/MWh)"] ?? 0).toFixed(2)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
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
                    <td><span className="rank">{r.Rank}</span></td>
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
          <div className="linha">
            <button className="destaque" onClick={() => baixarXlsx(resultado.xlsx)}>⬇ Baixar planilha (.xlsx)</button>
            <button className="destaque" onClick={() => gerarPdf(resultado)} disabled={gerandoPdf}>{gerandoPdf ? "Gerando…" : "📄 Gerar relatório (PDF)"}</button>
          </div>
          <p className="nota">O relatório em Word (.docx) será adicionado na Fase 2.</p>
        </>
      )}
    </main>
    )}
    <div className="ticker" aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <span key={i} style={{ margin: 0 }}>O CLIENTE<span>•</span>RESULTADO<span>•</span>ENERGIA<span>•</span>SOLIDEZ<span>•</span>FOCO NO CLIENTE<span>•</span></span>
      ))}
    </div>
    <footer className="rodape">Equalização de propostas do Mercado Livre de Energia</footer>
    </>
  );
}
