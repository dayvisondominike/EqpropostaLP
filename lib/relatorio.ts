import type { jsPDF } from "jspdf";
import { LOGO_30_ANOS, LOGO_30_ANOS_PROPORCAO } from "./logo30";
import type { DadosPld } from "./ccee";
import type { LinhaRanking, Resultado } from "./types";

type RGB = [number, number, number];

// Identidade visual do estudo de viabilidade Ludfor.
const VERDE: RGB = [1, 98, 92];
const VERDE_ESCURO: RGB = [0, 87, 78];
const VERDE_SUAVE: RGB = [112, 186, 172];
const VERDE_CLARO: RGB = [230, 242, 240];
const AMARELO: RGB = [248, 176, 38];
const AMARELO_CLARO: RGB = [255, 244, 217];
const AMARELO_TABELA: RGB = [255, 217, 102];
const CINZA: RGB = [95, 111, 108];
const BORDA: RGB = [217, 227, 225];
const GRADIENTE: [number, RGB][] = [
  [0, [0, 87, 78]],
  [0.45, [7, 103, 100]],
  [0.78, [76, 140, 166]],
  [1, [42, 152, 210]],
];

const MARGEM = 16;

const moeda = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num2 = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function corGradiente(t: number): RGB {
  for (let i = 1; i < GRADIENTE.length; i++) {
    const [t1, c1] = GRADIENTE[i];
    const [t0, c0] = GRADIENTE[i - 1];
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0);
      return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * k)) as RGB;
    }
  }
  return GRADIENTE[GRADIENTE.length - 1][1];
}

function faixaGradiente(doc: jsPDF, x: number, y: number, w: number, h: number) {
  const passos = 240;
  for (let i = 0; i < passos; i++) {
    doc.setFillColor(...corGradiente(i / (passos - 1)));
    doc.rect(x + (w * i) / passos, y, w / passos + 0.2, h, "F");
  }
}

function logo(doc: jsPDF, xDireita: number, y: number, largura: number) {
  doc.addImage(LOGO_30_ANOS, "PNG", xDireita - largura, y, largura, largura / LOGO_30_ANOS_PROPORCAO);
}

function trapezio(doc: jsPDF, x: number, y: number, w: number, h: number, aEsquerda: boolean) {
  doc.setFillColor(...AMARELO);
  const d = w * 0.35;
  const pts = aEsquerda
    ? [[x, y], [x + w, y + d * 0.4], [x + w, y + h], [x, y + h]]
    : [[x, y + d * 0.4], [x + w, y], [x + w, y + h], [x, y + h]];
  doc.triangle(pts[0][0], pts[0][1], pts[1][0], pts[1][1], pts[2][0], pts[2][1], "F");
  doc.triangle(pts[0][0], pts[0][1], pts[2][0], pts[2][1], pts[3][0], pts[3][1], "F");
}

type Contexto = { doc: jsPDF; larg: number; alt: number; cliente: string };

function cabecalhoPagina(c: Contexto, sobretitulo: string, titulo: string) {
  const { doc, larg } = c;
  doc.setTextColor(...AMARELO);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("//", MARGEM, 22);
  doc.setTextColor(...VERDE);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.text(sobretitulo, MARGEM + 9, 22);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text(titulo, MARGEM, 33);
  logo(doc, larg - MARGEM, 12, 30);
}

function rodapePagina(c: Contexto, pagina: number, total: number) {
  const { doc, larg, alt } = c;
  doc.setDrawColor(...BORDA);
  doc.setLineWidth(0.3);
  doc.line(MARGEM, alt - 14, larg - MARGEM, alt - 14);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(...VERDE);
  doc.text("O CLIENTE  •  RESULTADO  •  ENERGIA  •  SOLIDEZ  •  FOCO NO CLIENTE", MARGEM, alt - 9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...CINZA);
  doc.text(`${c.cliente}   |   Página ${pagina} de ${total}`, larg - MARGEM, alt - 9, { align: "right" });
}

function tituloSecao(doc: jsPDF, texto: string, y: number) {
  doc.setTextColor(...AMARELO);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("//", MARGEM, y);
  doc.setTextColor(...VERDE);
  doc.setFontSize(11.5);
  doc.text(texto, MARGEM + 7, y);
}

function capa(c: Contexto, lider: LinhaRanking | undefined) {
  const { doc, larg, alt } = c;
  logo(doc, larg - MARGEM, 16, 44);
  trapezio(doc, 0, 96, 14, 40, true);

  doc.setTextColor(...VERDE);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(34);
  doc.text("Equalização de", 26, 112);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(40);
  doc.text("PROPOSTAS", 26, 130);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.text(c.cliente, 26, 144);
  doc.setFontSize(10);
  doc.text(new Date().toLocaleDateString("pt-BR"), 26, 151);

  doc.setFontSize(10.5);
  doc.setTextColor(...CINZA);
  const texto = doc.splitTextToSize(
    "Comparativo de propostas de fornecimento de energia no Mercado Livre, equalizadas por Preço Médio, Valor Presente Líquido (VPL) e aderência ao produto solicitado pelo cliente.",
    larg - 26 - 40,
  );
  doc.text(texto, 26, 168);

  if (lider) {
    doc.setFillColor(...AMARELO_CLARO);
    doc.roundedRect(26, 192, larg - 26 - 26, 22, 2, 2, "F");
    doc.setFillColor(...AMARELO);
    doc.rect(26, 192, 2, 22, "F");
    doc.setTextColor(...VERDE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`1º colocado: ${lider.Fornecedor}`, 32, 201);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`VPL ${moeda(lider["VPL (R$)"])}   ·   Preço médio ${moeda(lider["Preço Médio (R$/MWh)"])}/MWh`, 32, 208);
  }

  // Faixa inferior no estilo da capa do estudo de viabilidade.
  const yFaixa = alt - 46;
  faixaGradiente(doc, MARGEM, yFaixa, larg - 2 * MARGEM, 30);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Análise de Viabilidade", MARGEM + 8, yFaixa + 9, { charSpace: 0.6 });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.text("MERCADO", MARGEM + 8, yFaixa + 22);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(20);
  doc.text("livre", MARGEM + 8 + 52, yFaixa + 22);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("ENERGIA", larg - MARGEM - 8, yFaixa + 9, { align: "right", charSpace: 0.8 });
  doc.text("SOLIDEZ", larg - MARGEM - 8, yFaixa + 16, { align: "right", charSpace: 0.8 });
  doc.text("RESULTADO", larg - MARGEM - 8, yFaixa + 23, { align: "right", charSpace: 0.8 });
  trapezio(doc, larg - 14, alt - 46, 14, 30, false);
}

function cartaoKpi(doc: jsPDF, x: number, y: number, w: number, rotulo: string, valor: string, destaque = false) {
  doc.setFillColor(...(destaque ? AMARELO_CLARO : VERDE_CLARO));
  doc.roundedRect(x, y, w, 20, 2, 2, "F");
  doc.setFillColor(...(destaque ? AMARELO : VERDE));
  doc.rect(x, y, w, 1.4, "F");
  doc.setTextColor(...CINZA);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.text(rotulo, x + 4, y + 7);
  doc.setTextColor(...VERDE);
  doc.setFontSize(11);
  doc.text(valor, x + 4, y + 15, { maxWidth: w - 8 });
}

/** Colunas por ano, para a curva de preço do primeiro colocado. */
function colunasPorAno(doc: jsPDF, x: number, y: number, w: number, h: number, dados: { ano: string; preco: number }[]) {
  const max = Math.max(1, ...dados.map((d) => d.preco));
  const base = y + h;
  const cores: RGB[] = [[35, 108, 95], [16, 139, 117], [112, 186, 172]];
  const larguraSlot = w / dados.length;
  const larguraCol = Math.min(16, larguraSlot * 0.6);
  doc.setDrawColor(...BORDA);
  doc.setLineWidth(0.3);
  doc.line(x, base, x + w, base);
  dados.forEach((d, i) => {
    const alturaCol = (d.preco / max) * (h - 8);
    const cx = x + larguraSlot * i + (larguraSlot - larguraCol) / 2;
    doc.setFillColor(...cores[i % cores.length]);
    doc.rect(cx, base - alturaCol, larguraCol, alturaCol, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...VERDE);
    doc.text(num2(d.preco), cx + larguraCol / 2, base - alturaCol - 1.5, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...CINZA);
    doc.text(d.ano, cx + larguraCol / 2, base + 4.5, { align: "center" });
  });
}

/** Corta o texto com "..." para caber em `largMax` (usa a fonte e o tamanho já definidos no doc). */
function cortarTexto(doc: jsPDF, texto: string, largMax: number): string {
  if (doc.getTextWidth(texto) <= largMax) return texto;
  let t = texto;
  while (t.length > 1 && doc.getTextWidth(t + "...") > largMax) t = t.slice(0, -1);
  return t.trimEnd() + "...";
}

/** Cartão branco com borda e faixa superior colorida (estilo dos cartões da tela). */
function cartaoBase(doc: jsPDF, x: number, y: number, w: number, h: number, faixa: RGB, fundo: RGB = [255, 255, 255]) {
  doc.setFillColor(...fundo);
  doc.setDrawColor(...BORDA);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, w, h, 3, 3, "FD");
  doc.setFillColor(...faixa);
  doc.roundedRect(x, y, w, 4, 3, 3, "F");
  doc.setFillColor(...fundo);
  doc.rect(x, y + 1.3, w, 4, "F");
  doc.setDrawColor(...BORDA);
  doc.line(x, y + 3, x, y + 5);
  doc.line(x + w, y + 3, x + w, y + 5);
}

/** Indicador do resumo: valor grande em cima, rótulo pequeno embaixo. */
function cartaoResumo(doc: jsPDF, x: number, y: number, w: number, valor: string, rotulo: string, destaque = false) {
  cartaoBase(doc, x, y, w, 23, destaque ? AMARELO : VERDE, destaque ? AMARELO_CLARO : [255, 255, 255]);
  doc.setFont("helvetica", "bold");
  let tam = 13;
  doc.setFontSize(tam);
  while (tam > 7 && doc.getTextWidth(valor) > w - 8) {
    tam -= 0.5;
    doc.setFontSize(tam);
  }
  doc.setTextColor(...VERDE);
  doc.text(valor, x + 4, y + 13);
  doc.setFontSize(6.2);
  doc.setTextColor(...CINZA);
  doc.text(rotulo, x + 4, y + 18.5, { charSpace: 0.3, maxWidth: w - 8 });
}

/** Barras horizontais dentro de um cartão (nome à esquerda, valor dentro da barra). Retorna a altura ocupada. */
function barrasCartao(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  itens: { nome: string; valor: number; lider: boolean }[],
  formatar: (v: number) => string,
  nomeW: number,
  passo: number,
) {
  const xBarra = x + nomeW + 2;
  const wMax = x + w - xBarra;
  const max = Math.max(1e-9, ...itens.map((i) => i.valor));
  // A escala começa um pouco abaixo do menor valor para evidenciar as diferenças.
  const piso = Math.min(...itens.map((i) => i.valor)) * 0.9;
  const altBarra = Math.min(5, passo - 1.2);
  itens.forEach((it, i) => {
    const yy = y + i * passo;
    doc.setFont("helvetica", it.lider ? "bold" : "normal");
    doc.setFontSize(7);
    doc.setTextColor(...CINZA);
    doc.text(cortarTexto(doc, it.nome, nomeW), x + nomeW, yy + altBarra / 2 + 1.1, { align: "right" });
    doc.setFillColor(...VERDE_CLARO);
    doc.roundedRect(xBarra, yy, wMax, altBarra, 1.2, 1.2, "F");
    const largura = Math.max(wMax * 0.14, ((it.valor - piso) / Math.max(1e-9, max - piso)) * wMax);
    doc.setFillColor(...(it.lider ? VERDE : VERDE_SUAVE));
    doc.roundedRect(xBarra, yy, largura, altBarra, 1.2, 1.2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.6);
    doc.setTextColor(255, 255, 255);
    doc.text(formatar(it.valor), xBarra + largura - 1.8, yy + altBarra / 2 + 1, { align: "right" });
  });
  doc.setFont("helvetica", "italic");
  doc.setFontSize(6);
  doc.setTextColor(...CINZA);
  doc.text("Escala iniciada abaixo do menor valor, para evidenciar as diferenças.", x, y + itens.length * passo + 2.2, { maxWidth: w });
  return itens.length * passo;
}

type Item = { rotulo: string; valor: string; destaque?: boolean; colunas?: number };

/** Painel de dados: faixa de título e grade de 3 colunas (rótulo pequeno + valor em destaque). Retorna o Y logo abaixo. */
function painelDados(doc: jsPDF, larg: number, y: number, titulo: string, itens: Item[]): number {
  const w = larg - 2 * MARGEM;
  const colunas = 3;
  const largCol = (w - 12) / colunas;
  const linhas: { item: Item; col: number; lin: number; texto: string[] }[] = [];
  let col = 0;
  let lin = 0;
  doc.setFont("helvetica", "bold");
  for (const item of itens) {
    const span = item.colunas ?? 1;
    if (col + span > colunas) { col = 0; lin++; }
    doc.setFontSize(item.destaque ? 13 : 10.5);
    linhas.push({ item, col, lin, texto: doc.splitTextToSize(item.valor, largCol * span - 4) });
    col += span;
    if (col >= colunas) { col = 0; lin++; }
  }
  const nLinhas = linhas.reduce((m, l) => Math.max(m, l.lin), 0) + 1;
  const alturas = Array.from({ length: nLinhas }, (_, i) =>
    Math.max(...linhas.filter((l) => l.lin === i).map((l) => 8 + l.texto.length * (l.item.destaque ? 5.6 : 4.8))) + 3,
  );
  const hCorpo = alturas.reduce((a, b) => a + b, 0) + 4;

  doc.setFillColor(...VERDE_CLARO);
  doc.roundedRect(MARGEM, y, w, 10 + hCorpo, 3, 3, "F");
  doc.setFillColor(...VERDE);
  doc.roundedRect(MARGEM, y, w, 10, 3, 3, "F");
  doc.rect(MARGEM, y + 5, w, 5, "F");
  doc.setFillColor(...AMARELO);
  doc.rect(MARGEM, y + 10, w, 1, "F");
  doc.setTextColor(...AMARELO);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("//", MARGEM + 5, y + 7.2);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.text(titulo.toUpperCase(), MARGEM + 12, y + 6.9, { charSpace: 0.4 });

  const topoLinha = (i: number) => y + 15 + alturas.slice(0, i).reduce((a, b) => a + b, 0);
  for (const { item, col: c, lin: l, texto } of linhas) {
    const x = MARGEM + 6 + c * largCol;
    const yy = topoLinha(l);
    if (l > 0) {
      doc.setDrawColor(...BORDA);
      doc.setLineWidth(0.2);
      doc.line(MARGEM + 6, yy - 2, MARGEM + w - 6, yy - 2);
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(...CINZA);
    doc.text(item.rotulo.toUpperCase(), x, yy + 2, { charSpace: 0.3 });
    doc.setFontSize(item.destaque ? 13 : 10.5);
    doc.setTextColor(...VERDE);
    doc.text(texto, x, yy + (item.destaque ? 8 : 7.3), { lineHeightFactor: 1.2 });
  }
  return y + 10 + hCorpo;
}

type Contato = {
  nome: string;
  cargo?: string;
  telefones: { rotulo: string; numero: string }[];
  site: string;
  empresa: string;
  email: string;
};

const CONTATOS: Contato[] = [
  {
    nome: "Dayvison Dominike",
    telefones: [
      { rotulo: "Celular / WhatsApp", numero: "81 98842.3816" },
      { rotulo: "Telefone", numero: "54 3451.1413" },
    ],
    site: "Ludfor.com.br",
    empresa: "Ludfor Energia",
    email: "dayvison.dominike@ludfor.com.br",
  },
  {
    nome: "Jefferson Carneiro",
    telefones: [
      { rotulo: "Celular / WhatsApp", numero: "81 99127.1115" },
      { rotulo: "Celular (Manaus)", numero: "92 98290.8060" },
      { rotulo: "Telefone", numero: "54 3451.1413" },
    ],
    site: "Ludfor.com.br",
    empresa: "Ludfor Energia",
    email: "jefferson.carneiro@ludfor.com.br",
  },
];

/** Cartão de contato: faixa em degradê com o nome, telefones à esquerda e site, empresa e e-mail à direita. */
function cartaoContato(doc: jsPDF, larg: number, y: number, p: Contato): number {
  const w = larg - 2 * MARGEM;
  const nTel = p.telefones.length;
  const h = 26 + Math.max(nTel, 3) * 11 + 4;
  doc.setFillColor(...VERDE_CLARO);
  doc.roundedRect(MARGEM, y, w, h, 3, 3, "F");
  faixaGradiente(doc, MARGEM, y, w, 17);
  doc.setFillColor(...AMARELO);
  doc.rect(MARGEM, y + 17, w, 1.2, "F");
  trapezio(doc, MARGEM, y + 3, 4, 11, true);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(p.nome, MARGEM + 9, y + 11);

  const campo = (x: number, yy: number, rotulo: string, valor: string, maxW: number) => {
    doc.setFillColor(...AMARELO);
    doc.circle(x + 1.6, yy - 1.1, 1.6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(...CINZA);
    doc.text(rotulo.toUpperCase(), x + 6, yy - 2.4, { charSpace: 0.3 });
    doc.setFontSize(10.5);
    doc.setTextColor(...VERDE);
    doc.text(valor, x + 6, yy + 2.6, { maxWidth: maxW });
  };

  const xEsq = MARGEM + 8;
  const xDir = MARGEM + w / 2 + 2;
  p.telefones.forEach((t, i) => campo(xEsq, y + 30 + i * 11, t.rotulo, t.numero, w / 2 - 16));
  campo(xDir, y + 30, "Site", p.site, w / 2 - 14);
  campo(xDir, y + 41, "Empresa", p.empresa, w / 2 - 14);
  campo(xDir, y + 52, "E-mail", p.email, w / 2 - 14);
  doc.setDrawColor(...BORDA);
  doc.setLineWidth(0.3);
  doc.line(MARGEM + w / 2 - 2, y + 24, MARGEM + w / 2 - 2, y + h - 5);
  return y + h;
}

/** Dados de mercado para a página PLD × Energia I5: PLD mensal por submercado e spread (R$/MWh). */
export type DadosMercado = {
  pld: DadosPld;
  spread: number;
  fonte: string;
  atualizadoEm: string | null;
};

const AZUL: RGB = [42, 152, 210];
const MESES_ROTULO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (k: string) => `${MESES_ROTULO[Number(k.slice(5, 7)) - 1]}/${k.slice(2, 4)}`;
const inteiro = (v: number) => Math.round(v).toLocaleString("pt-BR");

function chaveSubmercado(nome: string): string {
  const s = nome.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
  if (s.includes("NORDESTE")) return "NORDESTE";
  if (s.includes("SUDESTE")) return "SUDESTE";
  if (s.includes("NORTE")) return "NORTE";
  if (s.includes("SUL")) return "SUL";
  return "SUDESTE";
}

/** Curva suave (Fritsch-Carlson) em segmentos de Bézier relativos, no formato de `doc.lines`. */
function curvaSuave(doc: jsPDF, pts: { x: number; y: number }[]) {
  const n = pts.length;
  if (n < 2) return;
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
  const segs: number[][] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    segs.push([h, t[i] * h, dx[i] - h, pts[i + 1].y - pts[i].y - t[i + 1] * h, dx[i], pts[i + 1].y - pts[i].y]);
  }
  doc.lines(segs, pts[0].x, pts[0].y, [1, 1], "S");
}

function cartaoPld(doc: jsPDF, x: number, y: number, w: number, rotulo: string, valor: string, escuro: boolean) {
  const h = 22;
  if (escuro) {
    doc.setFillColor(...VERDE);
    doc.roundedRect(x, y, w, h, 2.5, 2.5, "F");
    doc.setFillColor(...AMARELO);
    doc.rect(x + 1.5, y, w - 3, 1.2, "F");
  } else {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...BORDA);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, w, h, 2.5, 2.5, "FD");
    doc.setFillColor(...VERDE);
    doc.rect(x + 1.5, y, w - 3, 1.2, "F");
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.3);
  doc.setTextColor(...(escuro ? ([207, 230, 226] as RGB) : CINZA));
  doc.text(rotulo, x + 4, y + 8, { charSpace: 0.25, maxWidth: w - 6 });
  doc.setFontSize(13);
  doc.setTextColor(...(escuro ? AMARELO : VERDE));
  doc.text(valor, x + 4, y + 17);
}

/** Página "PLD × Energia I5": cards, gráfico e comparação com a proposta vencedora. */
function paginaPld(c: Contexto, resultado: Resultado, mercado: DadosMercado, lider: LinhaRanking | undefined) {
  const { doc, larg, alt } = c;
  const sub = chaveSubmercado(resultado.params.submercado);
  const nomeSub = sub.charAt(0) + sub.slice(1).toLowerCase();
  const serie = mercado.pld[sub] ?? {};
  const meses = Object.keys(serie).sort();
  const ate = meses[meses.length - 1];
  const de = meses.find((m) => m >= "2025-01") ?? meses[0];
  const periodo = meses.filter((m) => m >= de && m <= ate);
  if (periodo.length < 2) return;

  doc.addPage();
  cabecalhoPagina(c, "Cenário de mercado", "PLD × Energia I5");

  const pontos = periodo.map((m) => ({ mes: m, pld: serie[m], i5: serie[m] + mercado.spread }));
  const media = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const mediaI5 = media(pontos.map((p) => p.i5));
  const mediaPld = media(pontos.map((p) => p.pld));
  const vals = pontos.map((p) => p.pld);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...CINZA);
  doc.text(
    `Submercado ${nomeSub} · ${rotuloMes(periodo[0])} a ${rotuloMes(periodo[periodo.length - 1])} · PLD médio mensal da CCEE e Energia I5 (PLD + spread).`,
    MARGEM,
    44,
    { maxWidth: larg - 2 * MARGEM },
  );

  // Cards do app
  const gap = 4;
  const wc = (larg - 2 * MARGEM - 3 * gap) / 4;
  let x = MARGEM;
  const cards: [string, string, boolean][] = [
    ["MÉDIA i5", moeda(mediaI5), true],
    ["MÉDIA PLD", moeda(mediaPld), false],
    ["SPREAD I5 - PLD", moeda(mercado.spread), false],
    ["PLD MÍN – MÁX", `${inteiro(Math.min(...vals))} – ${inteiro(Math.max(...vals))}`, false],
  ];
  for (const [r, v, esc] of cards) {
    cartaoPld(doc, x, 52, wc, r, v, esc);
    x += wc + gap;
  }

  // Gráfico
  const gx = MARGEM + 11, gw = larg - MARGEM - gx - 2;
  const gy = 100, gh = 108;
  const maxV = Math.max(...pontos.flatMap((p) => [p.i5, p.pld]), lider?.["Preço Médio (R$/MWh)"] ?? 0, 50);
  const bruto = maxV / 6;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const f = bruto / pot;
  const passo = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pot;
  const topo = Math.ceil((maxV * 1.1) / passo) * passo;
  const px = (i: number) => gx + (i * gw) / (pontos.length - 1);
  const py = (v: number) => gy + gh - (v / topo) * gh;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...VERDE);
  doc.text(`Preço de Energia I5 × PLD — Submercado ${nomeSub}`, larg / 2, 92, { align: "center" });

  doc.setLineWidth(0.15);
  for (let t = 0; t <= topo + 1e-9; t += passo) {
    doc.setDrawColor(227, 235, 233);
    doc.line(gx, py(t), gx + gw, py(t));
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...CINZA);
    doc.text(String(Math.round(t)), gx - 2, py(t) + 1.2, { align: "right" });
  }
  doc.setDrawColor(185, 201, 198);
  doc.line(gx, gy + gh, gx + gw, gy + gh);
  doc.setFontSize(6.5);
  doc.text("R$/MWh", MARGEM, gy - 3);
  const pulo = Math.ceil(pontos.length / 14);
  pontos.forEach((p, i) => {
    if (i % pulo === 0) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.3);
      doc.setTextColor(31, 45, 43);
      doc.text(rotuloMes(p.mes), px(i), gy + gh + 4.5, { align: "center" });
    }
  });

  // Linha de referência: preço médio da proposta vencedora
  const refPreco = lider?.["Preço Médio (R$/MWh)"];
  if (lider && refPreco != null) {
    doc.setDrawColor(...AZUL);
    doc.setLineWidth(0.5);
    doc.setLineDashPattern([0.8, 1.4], 0);
    doc.line(gx, py(refPreco), gx + gw, py(refPreco));
    doc.setLineDashPattern([], 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(...AZUL);
    doc.text(`Proposta vencedora (${lider.Fornecedor}): ${num2(refPreco)}`, gx + gw, py(refPreco) - 1.4, { align: "right" });
  }

  // Curvas
  const sPld = pontos.map((p, i) => ({ x: px(i), y: py(p.pld) }));
  const sI5 = pontos.map((p, i) => ({ x: px(i), y: py(p.i5) }));
  doc.setDrawColor(...AMARELO);
  doc.setLineWidth(0.7);
  doc.setLineDashPattern([2, 1.4], 0);
  curvaSuave(doc, sPld);
  doc.setLineDashPattern([], 0);
  doc.setDrawColor(...VERDE);
  doc.setLineWidth(0.9);
  curvaSuave(doc, sI5);

  // Rótulos
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.8);
  pontos.forEach((p, i) => {
    doc.setTextColor(138, 90, 0);
    doc.text(inteiro(p.pld), px(i), py(p.pld) + 3.6, { align: "center" });
    doc.setFillColor(...VERDE);
    doc.circle(px(i), py(p.i5), 0.9, "F");
    doc.setFillColor(...VERDE_CLARO);
    doc.setDrawColor(...VERDE);
    doc.setLineWidth(0.2);
    doc.roundedRect(px(i) - 3.2, py(p.i5) - 6.2, 6.4, 3.8, 0.7, 0.7, "FD");
    doc.setTextColor(...VERDE);
    doc.text(inteiro(p.i5), px(i), py(p.i5) - 3.4, { align: "center" });
  });

  // Legenda
  const ly = gy + gh + 11;
  doc.setLineWidth(0.9);
  doc.setDrawColor(...VERDE);
  doc.line(MARGEM + 8, ly, MARGEM + 16, ly);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...CINZA);
  doc.text("Energia I5 (PLD + spread)", MARGEM + 18, ly + 1);
  doc.setLineWidth(0.7);
  doc.setDrawColor(...AMARELO);
  doc.setLineDashPattern([2, 1.4], 0);
  doc.line(MARGEM + 62, ly, MARGEM + 70, ly);
  doc.setLineDashPattern([], 0);
  doc.text("PLD médio mensal", MARGEM + 72, ly + 1);
  if (lider && refPreco != null) {
    doc.setDrawColor(...AZUL);
    doc.setLineWidth(0.5);
    doc.setLineDashPattern([0.8, 1.4], 0);
    doc.line(MARGEM + 108, ly, MARGEM + 116, ly);
    doc.setLineDashPattern([], 0);
    doc.text("Preço médio da proposta vencedora", MARGEM + 118, ly + 1);
  }

  // Leitura do resultado
  let yt = ly + 12;
  if (lider && refPreco != null) {
    const dif = mediaI5 - refPreco;
    const pct = (Math.abs(dif) / mediaI5) * 100;
    doc.setFillColor(...AMARELO_CLARO);
    doc.roundedRect(MARGEM, yt, larg - 2 * MARGEM, 15, 2, 2, "F");
    doc.setFillColor(...AMARELO);
    doc.rect(MARGEM, yt, 2, 15, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...VERDE);
    doc.text(
      `${lider.Fornecedor}: ${moeda(refPreco)}/MWh, ${moeda(Math.abs(dif))} (${num2(pct)}%) ${dif >= 0 ? "abaixo" : "acima"} da média I5 do período`,
      MARGEM + 6,
      yt + 6.3,
      { maxWidth: larg - 2 * MARGEM - 10 },
    );
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...CINZA);
    doc.text(`Média I5 do período: ${moeda(mediaI5)}/MWh (PLD médio ${moeda(mediaPld)} + spread ${moeda(mercado.spread)}).`, MARGEM + 6, yt + 11.5);
    yt += 20;
  }

  doc.setFont("helvetica", "italic");
  doc.setFontSize(6.8);
  doc.setTextColor(...CINZA);
  const atualiz = mercado.atualizadoEm ? `, atualizado em ${new Date(mercado.atualizadoEm).toLocaleDateString("pt-BR")}` : "";
  doc.text(
    doc.splitTextToSize(
      `Fonte do PLD: ${mercado.fonte}${atualiz}. A Energia I5 é calculada como o PLD médio mensal somado ao spread informado (R$/MWh). Valores históricos de referência; não constituem projeção.`,
      larg - 2 * MARGEM,
    ),
    MARGEM,
    Math.min(yt, alt - 24),
  );
}

/** Gera o relatório de equalização em PDF (retrato) no navegador e dispara o download. */
export async function gerarRelatorioPdf(resultado: Resultado, mercado?: DadosMercado) {
  const { jsPDF: JsPdf } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new JsPdf({ orientation: "portrait", unit: "mm", format: "a4" });
  const larg = doc.internal.pageSize.getWidth();
  const alt = doc.internal.pageSize.getHeight();
  const { ranking, cliente, params } = resultado;
  const lider = ranking.find((r) => r.Rank !== "-");
  const nomeCliente = String(cliente["Razão Social"] ?? "Cliente");
  const c: Contexto = { doc, larg, alt, cliente: nomeCliente };
  const finalY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const margem = { left: MARGEM, right: MARGEM, top: 40, bottom: 20 };

  // Página 1: capa
  capa(c, lider);

  // Página 2: resumo (mesmo formato da tela) e gráficos
  doc.addPage();
  cabecalhoPagina(c, "Resultado", "Ranking da Equalização");
  const util = larg - 2 * MARGEM;
  let y = 46;
  if (lider) {
    tituloSecao(doc, "Resumo", y);
    y += 4;
    const w4 = (util - 12) / 4;
    cartaoResumo(doc, MARGEM, y, w4, lider.Fornecedor, "1º COLOCADO NO RANK", true);
    cartaoResumo(doc, MARGEM + (w4 + 4), y, w4, moeda(lider["VPL (R$)"]), "VPL DO 1º COLOCADO");
    cartaoResumo(doc, MARGEM + 2 * (w4 + 4), y, w4, moeda(lider["Preço Médio (R$/MWh)"]), "PREÇO MÉDIO DO 1º COLOCADO");
    cartaoResumo(doc, MARGEM + 3 * (w4 + 4), y, w4, String(ranking.length), "PROPOSTAS RECEBIDAS");
    y += 31;
  }

  const propostaLider = resultado.propostas.find((p) => p.Fornecedor === lider?.Fornecedor);
  const precos = propostaLider
    ? Object.entries(propostaLider)
        .map(([k, v]) => ({ m: k.match(/^Preço (\d{4}) /), v }))
        .filter((x) => x.m && typeof x.v === "number")
        .map((x) => ({ ano: x.m![1], preco: x.v as number }))
    : [];
  const comPreco = ranking.filter((r) => r["Preço Médio (R$/MWh)"] != null);
  const itensPreco = comPreco.map((r) => ({ nome: r.Fornecedor, valor: r["Preço Médio (R$/MWh)"] as number, lider: r.Rank === lider?.Rank }));

  // Linha de gráficos: curva de preço do 1º colocado (esquerda) e preço médio por proposta (direita).
  const duplo = lider !== undefined && precos.length > 0;
  const wCart = duplo ? (util - 4) / 2 : util;
  const xDir = duplo ? MARGEM + wCart + 4 : MARGEM;
  const topoBarras = 15;
  const passoPreco = Math.max(3.8, Math.min(6.4, (alt - 16 - y - topoBarras - 8) / Math.max(1, itensPreco.length)));
  const hCart = topoBarras + itensPreco.length * passoPreco + 8;

  if (duplo) {
    cartaoBase(doc, MARGEM, y, wCart, hCart, VERDE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...VERDE);
    doc.text(cortarTexto(doc, `Curva de preço — ${lider!.Fornecedor} (R$/MWh)`, wCart - 8), MARGEM + 4, y + 10);
    colunasPorAno(doc, MARGEM + 6, y + 16, wCart - 12, Math.min(40, hCart - 28), precos);
  }
  cartaoBase(doc, xDir, y, wCart, hCart, VERDE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...VERDE);
  doc.text("Preço médio por proposta (R$/MWh)", xDir + 4, y + 10);
  barrasCartao(doc, xDir + 4, y + topoBarras - 1, wCart - 8, itensPreco, num2, duplo ? 33 : 45, passoPreco);
  y += hCart + 6;

  // VPL por proposta (menor é melhor), em cartão de largura total; vai para a página seguinte se não couber.
  const comVpl = ranking.filter((r) => r["VPL (R$)"] != null);
  if (comVpl.length > 0) {
    // Reduz o espaçamento para o VPL caber na mesma página quando possível.
    const passoVpl = Math.max(3.8, Math.min(5.6, (alt - 16 - y - topoBarras - 8) / comVpl.length));
    const hVpl = topoBarras + comVpl.length * passoVpl + 8;
    if (y + hVpl > alt - 16) {
      doc.addPage();
      cabecalhoPagina(c, "Resultado", "VPL por Proposta");
      y = 46;
    }
    cartaoBase(doc, MARGEM, y, util, hVpl, VERDE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...VERDE);
    doc.text("VPL por proposta (R$) — menor é melhor", MARGEM + 4, y + 10);
    barrasCartao(
      doc,
      MARGEM + 4,
      y + topoBarras - 1,
      util - 8,
      comVpl.map((r) => ({ nome: r.Fornecedor, valor: r["VPL (R$)"] as number, lider: r.Rank === lider?.Rank })),
      (v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 }),
      45,
      passoVpl,
    );
  }

  // Página 3: tabela do ranking e observações
  doc.addPage();
  cabecalhoPagina(c, "Detalhamento", "Propostas Equalizadas");
  autoTable(doc, {
    startY: 42,
    head: [["#", "Fornecedor", "Tipo", "Preço médio", "VPL (R$)", "Aderência"]],
    body: ranking.map((r) => [
      String(r.Rank),
      r.Fornecedor,
      r["Tipo de Proposta"],
      num2(r["Preço Médio (R$/MWh)"] ?? 0),
      (r["VPL (R$)"] ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 }),
      r["Aderente ao Produto"],
    ]),
    theme: "plain",
    headStyles: { fillColor: VERDE, textColor: 255, fontStyle: "bold", lineColor: AMARELO_TABELA, lineWidth: { bottom: 0.8 } as never },
    styles: { fontSize: 8, cellPadding: 2.2, lineColor: BORDA, lineWidth: { bottom: 0.2 } as never },
    columnStyles: { 0: { halign: "center", cellWidth: 8 }, 3: { halign: "right" }, 4: { halign: "right" } },
    didParseCell: (d) => {
      if (d.section === "body" && d.row.index === 0 && lider?.Rank === 1) {
        d.cell.styles.fillColor = AMARELO_CLARO;
        d.cell.styles.fontStyle = "bold";
      }
    },
    margin: margem,
  });

  let yObs = finalY() + 12;
  if (yObs > alt - 50) {
    doc.addPage();
    cabecalhoPagina(c, "Detalhamento", "Observações");
    yObs = 46;
  }
  tituloSecao(doc, "Observações por proposta", yObs);
  autoTable(doc, {
    startY: yObs + 4,
    head: [["Fornecedor", "Flexibilidade ofertada", "Observações"]],
    body: ranking.map((r) => [r.Fornecedor, r.Flex, r.Observações]),
    theme: "plain",
    headStyles: { fillColor: VERDE, textColor: 255, fontStyle: "bold", lineColor: AMARELO_TABELA, lineWidth: { bottom: 0.8 } as never },
    styles: { fontSize: 7.5, cellPadding: 2, lineColor: BORDA, lineWidth: { bottom: 0.2 } as never, overflow: "linebreak" },
    columnStyles: { 0: { cellWidth: 30, fontStyle: "bold" }, 1: { cellWidth: 40 } },
    margin: margem,
  });

  // Página 4: cenário de mercado (PLD × Energia I5)
  if (mercado) paginaPld(c, resultado, mercado, lider);

  // Página final: dados do cliente e parâmetros
  doc.addPage();
  cabecalhoPagina(c, "Premissas", "Cliente e Parâmetros");
  const dado = (k: string) => String(cliente[k] ?? "—");
  let yp = 46;
  yp = painelDados(doc, larg, yp, "Dados do cliente", [
    { rotulo: "Razão social", valor: dado("Razão Social"), destaque: true, colunas: 3 },
    { rotulo: "CNPJ", valor: dado("CNPJ") },
    { rotulo: "Modalidade", valor: dado("Modalidade") },
    { rotulo: "Tipo de energia", valor: dado("Tipo de Energia") },
    { rotulo: "Submercado", valor: dado("Submercado") },
    { rotulo: "Período", valor: dado("Período") },
    { rotulo: "Volume (MWm)", valor: dado("Volume (MWm)") },
    { rotulo: "Flexibilidade", valor: dado("Flexibilidade") },
    { rotulo: "Sazonalização", valor: dado("Sazo") },
    { rotulo: "Modulação", valor: dado("Modulação") },
  ]) + 8;
  yp = painelDados(doc, larg, yp, "Parâmetros de cálculo", [
    { rotulo: "TMA (% a.a.)", valor: num2(params.tma_pct) },
    { rotulo: "Horas por ano", valor: String(params.horas_por_ano) },
    { rotulo: "Ano base", valor: String(params.ano_base) },
  ]) + 8;
  painelDados(doc, larg, yp, "Premissas de aderência", [
    { rotulo: "Fonte incentivada exigida", valor: `${params.fonte_percentual}%` },
    { rotulo: "Submercado", valor: params.submercado },
    { rotulo: "Período de fornecimento", valor: `${params.ano_inicio} a ${params.ano_fim}` },
    { rotulo: "Modulação", valor: params.modulacao },
    { rotulo: "Flexibilidade (+ / -)", valor: `+${params.flex_superior}% / -${params.flex_inferior}%` },
    {
      rotulo: "Sazonalização",
      valor: params.sazonalizacao === "Personalizada" ? `Personalizada (+${params.sazo_superior}% / -${params.sazo_inferior}%)` : "Flat",
    },
  ]);

  // Página de contatos
  doc.addPage();
  cabecalhoPagina(c, "Fale com a gente", "Nossos Contatos");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...CINZA);
  doc.text("Estamos à disposição para esclarecer dúvidas sobre esta análise e apoiar a sua decisão.", MARGEM, 48);
  let yc = 60;
  for (const p of CONTATOS) {
    yc = cartaoContato(doc, larg, yc, p) + 14;
  }
  // Faixa de encerramento, no estilo da capa.
  const yFaixa = alt - 50;
  faixaGradiente(doc, MARGEM, yFaixa, larg - 2 * MARGEM, 26);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Obrigado pela confiança", MARGEM + 8, yFaixa + 9, { charSpace: 0.6 });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Ludfor Energia", MARGEM + 8, yFaixa + 20);
  doc.setFontSize(8.5);
  ["ENERGIA", "SOLIDEZ", "RESULTADO"].forEach((t, i) => doc.text(t, larg - MARGEM - 8, yFaixa + 9 + i * 5.5, { align: "right", charSpace: 0.8 }));

  // Rodapé em todas as páginas (exceto a capa) e numeração
  const total = doc.getNumberOfPages();
  for (let i = 2; i <= total; i++) {
    doc.setPage(i);
    rodapePagina(c, i, total);
  }
  void VERDE_ESCURO;

  const nome = nomeCliente.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "");
  doc.save(`Relatorio_Equalizacao_${nome}.pdf`);
}
