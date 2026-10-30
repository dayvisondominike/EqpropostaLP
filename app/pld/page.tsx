"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { buscarPld } from "@/lib/api";
import { lerPlanilhaI5, modeloCsvI5, type SerieI5 } from "@/lib/i5";

const SUBS = [
  { chave: "SUDESTE", nome: "Sudeste" },
  { chave: "SUL", nome: "Sul" },
  { chave: "NORDESTE", nome: "Nordeste" },
  { chave: "NORTE", nome: "Norte" },
] as const;

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (k: string) => `${MESES[Number(k.slice(5, 7)) - 1]}/${k.slice(2, 4)}`;
const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const inteiro = (v: number) => Math.round(v).toLocaleString("pt-BR");
const CHAVE_STORAGE = "equalizacao:i5";

/** Curva suave que não ultrapassa os pontos (interpolação monotônica de Fritsch-Carlson). */
function caminhoSuave(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0].x},${pts[0].y}`;
  const dx = pts.slice(1).map((p, i) => p.x - pts[i].x);
  const m = pts.slice(1).map((p, i) => (p.y - pts[i].y) / dx[i]);
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${pts[i].x + h},${pts[i].y + t[i] * h} ${pts[i + 1].x - h},${pts[i + 1].y - t[i + 1] * h} ${pts[i + 1].x},${pts[i + 1].y}`;
  }
  return d;
}

function passoBonito(max: number) {
  const bruto = max / 6;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const f = bruto / pot;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pot;
}

type Ponto = { mes: string; i5?: number; pld?: number };

function Grafico({ pontos, titulo }: { pontos: Ponto[]; titulo: string }) {
  const L = 1000, A = 400, ml = 54, mr = 20, mt = 36, mb = 44;
  const [ativo, setAtivo] = useState<number | null>(null);
  const valores = pontos.flatMap((p) => [p.i5, p.pld]).filter((v): v is number => v != null);
  const passo = passoBonito(Math.max(50, ...valores));
  const topo = Math.ceil((Math.max(50, ...valores) * 1.08) / passo) * passo;
  const x = (i: number) => ml + (pontos.length === 1 ? (L - ml - mr) / 2 : (i * (L - ml - mr)) / (pontos.length - 1));
  const y = (v: number) => A - mb - (v / topo) * (A - mb - mt);
  const serie = (k: "i5" | "pld") =>
    pontos.map((p, i) => (p[k] != null ? { x: x(i), y: y(p[k] as number), i, v: p[k] as number } : null)).filter((p): p is NonNullable<typeof p> => p !== null);
  const sI5 = serie("i5"), sPld = serie("pld");
  const pulo = Math.ceil(pontos.length / 22);
  const ticks = Array.from({ length: Math.floor(topo / passo) + 1 }, (_, i) => i * passo);

  function mover(e: React.MouseEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * L;
    setAtivo(Math.max(0, Math.min(pontos.length - 1, Math.round(((px - ml) / (L - ml - mr)) * (pontos.length - 1)))));
  }

  const pa = ativo != null ? pontos[ativo] : null;
  return (
    <div className="pld-grafico">
      <h2>{titulo}</h2>
      <svg viewBox={`0 0 ${L} ${A}`} width="100%" role="img" aria-label={titulo} onMouseMove={mover} onMouseLeave={() => setAtivo(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={ml} x2={L - mr} y1={y(t)} y2={y(t)} stroke="#e3ebe9" />
            <text x={ml - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#5f6f6c">{t}</text>
          </g>
        ))}
        <text x={12} y={A / 2} fontSize={11} fill="#5f6f6c" transform={`rotate(-90 12 ${A / 2})`} textAnchor="middle">R$/MWh</text>
        <line x1={ml} x2={L - mr} y1={A - mb} y2={A - mb} stroke="#b9c9c6" />
        {pontos.map((p, i) => (i % pulo === 0 ? <text key={p.mes} x={x(i)} y={A - mb + 18} textAnchor="middle" fontSize={11} fontWeight={700} fill="#1f2d2b">{rotuloMes(p.mes)}</text> : null))}

        {ativo != null && <line x1={x(ativo)} x2={x(ativo)} y1={mt} y2={A - mb} stroke="#01625c" strokeOpacity={0.25} />}
        <path d={caminhoSuave(sPld)} fill="none" stroke="#f8b026" strokeWidth={2.6} strokeDasharray="7 5" />
        <path d={caminhoSuave(sI5)} fill="none" stroke="#01625c" strokeWidth={3} />

        {sPld.map((p) => (
          <text key={`l${p.i}`} x={p.x} y={p.y + 16} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#8a5a00">{inteiro(p.v)}</text>
        ))}
        {sI5.map((p) => (
          <g key={`i${p.i}`}>
            <circle cx={p.x} cy={p.y} r={4.6} fill="#01625c" />
            <rect x={p.x - 15} y={p.y - 30} width={30} height={18} rx={3} fill="#e6f2f0" stroke="#01625c" />
            <text x={p.x} y={p.y - 17} textAnchor="middle" fontSize={11} fontWeight={800} fill="#01625c">{inteiro(p.v)}</text>
          </g>
        ))}

        {pa && ativo != null && (
          <g transform={`translate(${Math.min(x(ativo) + 12, L - 190)},${mt})`}>
            <rect width={178} height={60} rx={6} fill="#fff" stroke="#d9e3e1" />
            <text x={10} y={16} fontSize={11} fill="#5f6f6c" fontWeight={700}>{rotuloMes(pa.mes)}</text>
            <circle cx={14} cy={31} r={4} fill="#01625c" />
            <text x={24} y={35} fontSize={11} fill="#1f2d2b">Energia I5: {pa.i5 != null ? moeda(pa.i5) : "—"}</text>
            <circle cx={14} cy={48} r={4} fill="#f8b026" />
            <text x={24} y={52} fontSize={11} fill="#1f2d2b">PLD: {pa.pld != null ? moeda(pa.pld) : "—"}</text>
          </g>
        )}
      </svg>
      <div className="legenda">
        <span><i className="l-i5" /> Energia I5 (preço médio comprado no curto prazo)</span>
        <span><i className="l-pld" /> PLD médio mensal</span>
      </div>
    </div>
  );
}

export default function PaginaPld() {
  const [pld, setPld] = useState<Record<string, Record<string, number>>>({});
  const [fonte, setFonte] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [i5, setI5] = useState<SerieI5>({});
  const [aviso, setAviso] = useState("");
  const [sub, setSub] = useState<string>("SUL");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const arquivo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    buscarPld()
      .then((r) => { setPld(r.dados); setFonte(r.fonte); })
      .catch((e) => setErro((e as Error).message))
      .finally(() => setCarregando(false));
    try {
      const salvo = localStorage.getItem(CHAVE_STORAGE);
      if (salvo) setI5(JSON.parse(salvo));
    } catch { /* armazenamento indisponível: segue sem histórico I5 */ }
  }, []);

  const mesesPld = useMemo(() => Object.keys(pld[sub] ?? {}).sort(), [pld, sub]);
  const mesesTodos = useMemo(() => Array.from(new Set([...mesesPld, ...Object.keys(i5[sub] ?? {})])).sort(), [mesesPld, i5, sub]);

  useEffect(() => {
    if (mesesTodos.length === 0) return;
    setDe((d) => (d && mesesTodos.includes(d) ? d : mesesTodos.find((m) => m >= "2025-01") ?? mesesTodos[0]));
    setAte((a) => (a && mesesTodos.includes(a) ? a : mesesTodos[mesesTodos.length - 1]));
  }, [mesesTodos]);

  const pontos: Ponto[] = useMemo(
    () => mesesTodos.filter((m) => m >= de && m <= ate).map((m) => ({ mes: m, i5: i5[sub]?.[m], pld: pld[sub]?.[m] })),
    [mesesTodos, de, ate, i5, sub, pld],
  );

  const comI5 = pontos.filter((p) => p.i5 != null);
  const base = comI5.length > 0 ? comI5 : pontos;
  const media = (xs: (number | undefined)[]) => {
    const v = xs.filter((n): n is number => n != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const mediaI5 = media(comI5.map((p) => p.i5));
  const mediaPld = media(base.map((p) => p.pld));
  const spread = mediaI5 != null && mediaPld != null ? mediaI5 - mediaPld : null;
  const pldVals = pontos.map((p) => p.pld).filter((v): v is number => v != null);

  async function importar(f: File | undefined) {
    if (!f) return;
    setAviso("");
    try {
      const { serie, meses } = await lerPlanilhaI5(f, sub);
      const novo = { ...i5 };
      for (const [s, m] of Object.entries(serie)) novo[s] = { ...(novo[s] ?? {}), ...m };
      setI5(novo);
      try { localStorage.setItem(CHAVE_STORAGE, JSON.stringify(novo)); } catch { /* ignora */ }
      setAviso(`Planilha importada: ${meses} mês(es) de Energia I5.`);
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      if (arquivo.current) arquivo.current.value = "";
    }
  }

  function restaurar() {
    setI5({});
    try { localStorage.removeItem(CHAVE_STORAGE); } catch { /* ignora */ }
    setAviso("Histórico de Energia I5 removido.");
  }

  function baixarModelo() {
    const blob = new Blob([modeloCsvI5()], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "modelo_energia_i5.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const nomeSub = SUBS.find((s) => s.chave === sub)?.nome ?? sub;

  return (
    <>
      <header>
        <div className="topo">
          <div className="topo-interno">
            <div className="marca">Análise de Viabilidade</div>
            <h1>PLD × Energia I5 <i>consulta</i></h1>
            <p>Compare o preço de Energia I5 com o PLD médio mensal da CCEE, por submercado.</p>
            <Link className="voltar" href="/">← Equalização de propostas</Link>
          </div>
        </div>
      </header>
      <main>
        <div className="pld-barra">
          <div className="grupo">
            <label>Submercado</label>
            <div className="seg">
              {SUBS.map((s) => (
                <button key={s.chave} className={sub === s.chave ? "ativo" : ""} onClick={() => setSub(s.chave)}>{s.nome}</button>
              ))}
            </div>
          </div>
          <div className="grupo">
            <label>Período da média</label>
            <div className="linha" style={{ alignItems: "center", flexWrap: "nowrap" }}>
              <select value={de} onChange={(e) => setDe(e.target.value)} aria-label="Mês inicial">
                {mesesTodos.filter((m) => m <= ate).map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
              </select>
              <span className="nota">até</span>
              <select value={ate} onChange={(e) => setAte(e.target.value)} aria-label="Mês final">
                {mesesTodos.filter((m) => m >= de).map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
              </select>
              <button className="sec" onClick={() => { setDe(mesesTodos[0]); setAte(mesesTodos[mesesTodos.length - 1]); }}>Todos</button>
            </div>
          </div>
          <div className="grupo">
            <label>Atualizar histórico I5</label>
            <div className="linha" style={{ flexWrap: "nowrap" }}>
              <button onClick={() => arquivo.current?.click()}>Importar planilha</button>
              <button className="sec" onClick={restaurar}>Restaurar</button>
              <button className="sec" onClick={baixarModelo} title="Baixar modelo de planilha (CSV)">Modelo</button>
              <input ref={arquivo} type="file" hidden accept=".xlsx,.csv,.txt" onChange={(e) => importar(e.target.files?.[0])} />
            </div>
          </div>
        </div>

        <div className="metricas pld-kpis">
          <div className="metrica destaque-escuro">
            <div className="rotulo">MÉDIA I5{comI5.length ? ` · ${comI5.length} MESES` : ""}</div>
            <div className="valor">{mediaI5 != null ? moeda(mediaI5) : "—"}</div>
          </div>
          <div className="metrica"><div className="rotulo">MÉDIA PLD</div><div className="valor">{mediaPld != null ? moeda(mediaPld) : "—"}</div></div>
          <div className="metrica"><div className="rotulo">SPREAD I5 − PLD</div><div className="valor">{spread != null ? moeda(spread) : "—"}</div></div>
          <div className="metrica"><div className="rotulo">PLD MÍN – MÁX</div><div className="valor">{pldVals.length ? `${inteiro(Math.min(...pldVals))} – ${inteiro(Math.max(...pldVals))}` : "—"}</div></div>
        </div>

        {aviso && <div className="nota" style={{ marginTop: 10 }}>{aviso}</div>}
        {erro && <div className="erro-msg">Não foi possível carregar o PLD: {erro}</div>}

        <div className="cartao" style={{ marginTop: 14 }}>
          {carregando ? (
            <p className="nota">Carregando PLD da CCEE…</p>
          ) : pontos.length === 0 ? (
            <p className="nota">Sem dados para o período selecionado.</p>
          ) : (
            <Grafico pontos={pontos} titulo={`Preço de Energia I5 × PLD — Submercado ${nomeSub} (${rotuloMes(pontos[0].mes)} a ${rotuloMes(pontos[pontos.length - 1].mes)})`} />
          )}
          {!carregando && comI5.length === 0 && (
            <p className="nota">Ainda não há histórico de Energia I5 para {nomeSub}. Use <b>Importar planilha</b> (colunas: Mês, Submercado, Energia I5) — o botão <b>Modelo</b> baixa um exemplo.</p>
          )}
        </div>
        <p className="nota" style={{ marginTop: 10 }}>
          Fonte do PLD: {fonte || "—"}. O histórico de Energia I5 fica salvo apenas neste navegador.
        </p>
      </main>
      <div className="ticker" aria-hidden>
        {Array.from({ length: 4 }, (_, i) => (
          <span key={i} style={{ margin: 0 }}>O CLIENTE<span>•</span>RESULTADO<span>•</span>ENERGIA<span>•</span>SOLIDEZ<span>•</span>FOCO NO CLIENTE<span>•</span></span>
        ))}
      </div>
      <footer className="rodape">Consulta PLD × Energia I5 — dados abertos da CCEE</footer>
    </>
  );
}
