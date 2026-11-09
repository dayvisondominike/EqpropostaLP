import type { jsPDF } from "jspdf";
import { LOGO_30_ANOS, LOGO_30_ANOS_PROPORCAO } from "./logo30";
import type { DadosPld } from "./ccee";
import { PESOS_PADRAO, type LinhaRanking, type Pesos, type Resultado } from "./types";
import { comparar, lerData } from "./comparativo";

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
    doc.text(`1º colocado no RANK: ${lider.Fornecedor}`, 32, 201);
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
  // O espaçamento entre letras (charSpace) alarga o texto sem o maxWidth perceber: reduz o espaçamento e,
  // se preciso, a fonte até o rótulo caber dentro do cartão.
  let cs = 0.3, tamR = 6.2;
  const cabe = () => doc.getTextWidth(rotulo) + cs * rotulo.length <= w - 8;
  while (!cabe() && cs > 0) cs = Math.max(0, cs - 0.05);
  while (!cabe() && tamR > 5.2) {
    tamR -= 0.2;
    doc.setFontSize(tamR);
  }
  doc.text(rotulo, x + 4, y + 18.5, { charSpace: cs, maxWidth: w - 8 });
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
  return itens.length * passo;
}

const CRITERIOS_PONTOS: { rotulo: string; chaves: (keyof Pesos)[]; cor: RGB }[] = [
  { rotulo: "Preço médio", chaves: ["preco"], cor: VERDE },
  { rotulo: "VPL", chaves: ["vpl"], cor: [76, 140, 166] },
  { rotulo: "Flexibilidade", chaves: ["flex_inferior", "flex_superior"], cor: VERDE_SUAVE },
  { rotulo: "Sazonalização", chaves: ["sazo_inferior", "sazo_superior"], cor: AMARELO },
  { rotulo: "Modulação", chaves: ["modulacao"], cor: [160, 175, 172] },
];

/** Barras empilhadas da pontuação (0 a 100) por critério, com legenda no topo e o total ao fim da barra. */
function barrasPontuacao(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  itens: { nome: string; lider: boolean; pontos: Pesos; total: number }[],
  nomeW: number,
  passo: number,
  alturaLegenda: number,
) {
  // Legenda
  let xl = x + nomeW + 2;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.6);
  CRITERIOS_PONTOS.forEach((cr) => {
    doc.setFillColor(...cr.cor);
    doc.roundedRect(xl, y + 0.4, 3, 3, 0.6, 0.6, "F");
    doc.setTextColor(...CINZA);
    doc.text(cr.rotulo, xl + 4.2, y + 3);
    xl += 4.2 + doc.getTextWidth(cr.rotulo) + 5;
  });

  const xBarra = x + nomeW + 2;
  const wTotal = 11;
  const wMax = x + w - xBarra - wTotal;
  const altBarra = Math.min(5, passo - 1.2);
  const y0 = y + alturaLegenda;
  itens.forEach((it, i) => {
    const yy = y0 + i * passo;
    doc.setFont("helvetica", it.lider ? "bold" : "normal");
    doc.setFontSize(7);
    doc.setTextColor(...CINZA);
    doc.text(cortarTexto(doc, it.nome, nomeW), x + nomeW, yy + altBarra / 2 + 1.1, { align: "right" });
    doc.setFillColor(...VERDE_CLARO);
    doc.roundedRect(xBarra, yy, wMax, altBarra, 1.2, 1.2, "F");
    let xs = xBarra;
    CRITERIOS_PONTOS.forEach((cr) => {
      const pts = cr.chaves.reduce((s, k) => s + it.pontos[k], 0);
      const largura = (pts / 100) * wMax;
      if (largura <= 0.05) return;
      doc.setFillColor(...cr.cor);
      doc.rect(xs, yy, largura, altBarra, "F");
      if (largura > 7) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6);
        doc.setTextColor(255, 255, 255);
        doc.text(pts.toLocaleString("pt-BR", { maximumFractionDigits: 0 }), xs + largura / 2, yy + altBarra / 2 + 0.9, { align: "center" });
      }
      xs += largura;
    });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...(it.lider ? VERDE : CINZA));
    doc.text(it.total.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }), xBarra + wMax + 2, yy + altBarra / 2 + 1.1);
  });
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

/** Dados de mercado para a página PLD × Energia i5 Spot: PLD mensal por submercado e spread (R$/MWh). */
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

/** Página "PLD × Energia i5 Spot": cards, gráfico e comparação com o 1º no RANK. */
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
  cabecalhoPagina(c, "Cenário de mercado", "PLD × Energia i5 Spot × 1º no RANK");

  const pontos = periodo.map((m) => ({ mes: m, pld: serie[m], i5: serie[m] + mercado.spread }));
  const media = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const mediaI5 = media(pontos.map((p) => p.i5));
  const mediaPld = media(pontos.map((p) => p.pld));
  const vals = pontos.map((p) => p.pld);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...CINZA);
  doc.text(
    `Submercado ${nomeSub} · ${rotuloMes(periodo[0])} a ${rotuloMes(periodo[periodo.length - 1])} · PLD médio mensal da CCEE e Energia i5 Spot (PLD + spread).`,
    MARGEM,
    44,
    { maxWidth: larg - 2 * MARGEM },
  );

  // Cards do app
  const gap = 4;
  const wc = (larg - 2 * MARGEM - 3 * gap) / 4;
  let x = MARGEM;
  const cards: [string, string, boolean][] = [
    ["MÉDIA i5 Spot", moeda(mediaI5), true],
    ["MÉDIA PLD", moeda(mediaPld), false],
    ["SPREAD i5 Spot - PLD", moeda(mercado.spread), false],
    ["PLD MÍN – MÁX", `${inteiro(Math.min(...vals))} – ${inteiro(Math.max(...vals))}`, false],
  ];
  for (const [r, v, esc] of cards) {
    cartaoPld(doc, x, 52, wc, r, v, esc);
    x += wc + gap;
  }

  // Gráfico
  const gx = MARGEM + 11, gw = larg - MARGEM - gx - 2 - 26; // 26 mm reservados à direita para o rótulo da média i5 Spot
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
  doc.text(`Preço de Energia I5 Spot × PLD — Submercado ${nomeSub}`, larg / 2, 92, { align: "center" });

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
    doc.line(gx, py(refPreco), gx + gw + 2, py(refPreco));
    doc.setLineDashPattern([], 0);
    // Rótulo na faixa à direita do gráfico (como o da Média i5 Spot), fora das curvas: "1º no RANK" e o
    // valor acima da linha e o nome do fornecedor no nível dela. Se ficar sobre o rótulo da média i5,
    // o bloco do 1º é afastado (para cima ou para baixo) para não sobrepor.
    const pm = py(mediaI5);
    let yr = py(refPreco) - 6.1;
    const topM = pm - 3, botM = pm + 4.5; // faixa vertical ocupada pelo rótulo da média i5
    if (yr + 7.5 > topM && yr - 3 < botM) yr = yr + 2.25 <= pm + 0.75 ? topM - 1.5 - 7.5 : botM + 1.5 + 3;
    const nome = String(lider.Fornecedor);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.3);
    doc.setTextColor(...CINZA);
    doc.text("1º no RANK", gx + gw + 3.5, yr - 0.8);
    doc.setFontSize(7.8);
    doc.setTextColor(...AZUL);
    doc.text(moeda(refPreco), gx + gw + 3.5, yr + 3.6);
    doc.setFontSize(5.5);
    doc.setTextColor(...CINZA);
    doc.text(nome.length > 18 ? `${nome.slice(0, 16)}..` : nome, gx + gw + 3.5, yr + 6.8);
  }

  // Linha da média i5 Spot do período (mesma da tela)
  doc.setDrawColor(...VERDE);
  doc.setLineWidth(0.4);
  doc.setLineDashPattern([0.4, 1.6], 0);
  doc.line(gx, py(mediaI5), gx + gw + 2, py(mediaI5));
  doc.setLineDashPattern([], 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.3);
  doc.setTextColor(...CINZA);
  doc.text("Média i5 Spot", gx + gw + 3.5, py(mediaI5) - 0.8);
  doc.setFontSize(7.8);
  doc.setTextColor(...VERDE);
  doc.text(moeda(mediaI5), gx + gw + 3.5, py(mediaI5) + 3.6);

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
  doc.text("Energia i5 Spot (PLD + spread)", MARGEM + 18, ly + 1);
  doc.setLineWidth(0.7);
  doc.setDrawColor(...AMARELO);
  doc.setLineDashPattern([2, 1.4], 0);
  doc.line(MARGEM + 62, ly, MARGEM + 70, ly);
  doc.setLineDashPattern([], 0);
  doc.text("PLD médio mensal", MARGEM + 72, ly + 1);
  doc.setLineDashPattern([], 0);
  doc.setDrawColor(...VERDE);
  doc.setLineWidth(0.4);
  doc.setLineDashPattern([0.4, 1.6], 0);
  doc.line(MARGEM + 100, ly, MARGEM + 108, ly);
  doc.setLineDashPattern([], 0);
  doc.text("Média i5 Spot", MARGEM + 110, ly + 1);
  if (lider && refPreco != null) {
    doc.setDrawColor(...AZUL);
    doc.setLineWidth(0.5);
    doc.setLineDashPattern([0.8, 1.4], 0);
    doc.line(MARGEM + 134, ly, MARGEM + 142, ly);
    doc.setLineDashPattern([], 0);
    doc.text("Média do 1º no RANK", MARGEM + 144, ly + 1);
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
      `${lider.Fornecedor}: ${moeda(refPreco)}/MWh, ${moeda(Math.abs(dif))} (${num2(pct)}%) ${dif >= 0 ? "abaixo" : "acima"} da média i5 Spot do período`,
      MARGEM + 6,
      yt + 6.3,
      { maxWidth: larg - 2 * MARGEM - 10 },
    );
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...CINZA);
    doc.text(`Média i5 Spot do período: ${moeda(mediaI5)}/MWh (PLD médio ${moeda(mediaPld)} + spread ${moeda(mercado.spread)}).`, MARGEM + 6, yt + 11.5);
    yt += 20;
  }

  // "Em linguagem simples": o que a distância até o spot significa para quem decide.
  const frase = fraseMercado(metricasMercado(resultado, mercado)!, resultado.propostas.find((p) => p.Fornecedor === lider?.Fornecedor)?.["Tipo de Proposta"]);
  if (frase) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    const ls = doc.splitTextToSize(frase, larg - 2 * MARGEM - 8) as string[];
    const h = 13 + ls.length * 4.2;
    const yb = Math.min(yt + 4, alt - 18 - h);
    doc.setFillColor(...VERDE_CLARO);
    doc.roundedRect(MARGEM, yb, larg - 2 * MARGEM, h, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...VERDE);
    doc.text("Em linguagem simples", MARGEM + 4, yb + 6);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(31, 45, 43);
    doc.text(ls, MARGEM + 4, yb + 11.5, { lineHeightFactor: 1.2 });
  }
}

/** Textos do resumo da página "Resumo para decisão". Sem eles, valem os textos das regras fixas (lib/comparativo.ts). */
export type Narrativa = {
  /** Texto corrido, ou uma frase de destaque (a conclusão) seguida de tópicos curtos. */
  resumo: string | { destaque: string; topicos: string[] };
};

// ---------------------------------------------------------------------------------------------
// Regras do relatório para o decisor
// ---------------------------------------------------------------------------------------------
type Dict = Record<string, unknown>;

const VERMELHO: RGB = [196, 48, 62];
const VERMELHO_CLARO: RGB = [253, 236, 238];
const OK: RGB = [30, 130, 90];
const TEXTO: RGB = [31, 45, 43];

const dataCurta = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const dataCompleta = (d: Date) => d.toLocaleDateString("pt-BR");
/** "EDP - I5 FLEX 100 SEM ENCARGOS" -> "EDP": nome curto do fornecedor para frases. */
const nomeCurto = (n: string) => n.split(" - ")[0].trim();
const juntar = (ns: string[]) => (ns.length <= 1 ? (ns[0] ?? "") : `${ns.slice(0, -1).join(", ")} e ${ns[ns.length - 1]}`);
const vazio = (v: unknown) => v == null || String(v).trim() === "" || ["nan", "none", "null"].includes(String(v).trim().toLowerCase());

export type Validade = { tipo: "vencida" | "valida" | "sem"; data: Date | null; texto: string };

/** Situação da validade da proposta em relação a `hoje`. */
export function validadeDe(prop: Dict | undefined, hoje: Date): Validade {
  const bruto = prop?.["Validade da Proposta"];
  const fim = vazio(bruto) ? null : lerData(String(bruto));
  if (!fim) return { tipo: "sem", data: null, texto: "Não informada" };
  return fim < hoje
    ? { tipo: "vencida", data: fim, texto: `Vencida em ${dataCurta(fim)}` }
    : { tipo: "valida", data: fim, texto: `Válida até ${dataCurta(fim)}` };
}

/** Frase da faixa de alerta de validade; null quando nenhuma proposta venceu. */
export function textoAlertaValidade(itens: { nome: string; rank: number | string; v: Validade }[]): string | null {
  const vencidas = itens.filter((x) => x.v.tipo === "vencida");
  if (vencidas.length === 0) return null;
  const porData = new Map<string, string[]>();
  for (const x of vencidas) {
    const k = dataCompleta(x.v.data!);
    porData.set(k, [...(porData.get(k) ?? []), nomeCurto(x.nome)]);
  }
  const partes = [...porData].map(([data, ns]) => `${juntar(ns)} ${ns.length > 1 ? "perderam" : "perdeu"} a validade em ${data}.`);
  for (const x of itens.filter((i) => i.v.tipo === "valida")) {
    partes.push(`A ${nomeCurto(x.nome)}${typeof x.rank === "number" ? `, ${x.rank}ª no RANK,` : ""} segue válida até ${dataCompleta(x.v.data!)}.`);
  }
  if (vencidas.some((x) => typeof x.rank === "number" && x.rank <= 2)) partes.push("Para fechar com as propostas vencidas é preciso reabertura ou atualização.");
  return partes.join(" ");
}

/** O que a proposta não informou (flexibilidade, sazonalização, modulação, volume). */
export function dadosDe(prop: Dict | undefined): string {
  const faltam: string[] = [];
  if (vazio(prop?.["Flexibilidade"])) faltam.push("flexibilidade");
  if (vazio(prop?.["Sazonalidade"])) faltam.push("sazonalização");
  if (vazio(prop?.["Modulação"])) faltam.push("modulação");
  if (prop?.["Volume informado na proposta"] === false) faltam.push("volume");
  return faltam.length === 0 ? "Completos" : `Faltam ${juntar(faltam)}`;
}

/** "Vinculante (contrato preliminar) (I5 FLEX 100)" -> "Vinculante"; "Firme" -> "Firme". */
const tipoCurto = (t: unknown) => {
  const s = vazio(t) ? "" : String(t);
  if (/vinculante/i.test(s)) return "Vinculante";
  if (/firme/i.test(s)) return "Firme";
  if (/indicativ/i.test(s)) return "Indicativa";
  return s.split(" (")[0] || "—";
};
/** Remove o nome do produto entre parênteses quando há dois grupos: "Vinculante (contrato preliminar) (I5 FLEX 100)". */
const naturezaLonga = (t: string | null) => (t && /\(.*\).*\(.*\)/.test(t) ? t.replace(/\s*\([^()]*\)\s*$/, "") : t);

const textoOuNao = (v: unknown, feminino = true) => (vazio(v) ? (feminino ? "Não informada" : "Não informado") : String(v));

/** "Jan/27 a dez/2027" -> "jan/2027 a dez/2027". */
const periodoLegivel = (s: string) => s.replace(/\b([A-Za-zçÇ]{3,9})\/(\d{2,4})\b/g, (_m, mes: string, ano: string) => `${mes.slice(0, 3).toLowerCase()}/${ano.length === 2 ? `20${ano}` : ano}`);
/** "+-100" -> "±100%". */
const flexLegivel = (s: string) => {
  const m = s.trim().match(/^(?:\+\s*\/?\s*-|±)\s*(\d+(?:[.,]\d+)?)\s*%?$/);
  return m ? `±${m[1].replace(".", ",")}%` : s;
};
const volumeLegivel = (s: string) => (/^\d+\.\d+$/.test(s.trim()) ? s.trim().replace(".", ",") : s);

export type MetricasMercado = { mediaI5: number; mediaPld: number; minI5: number; maxI5: number; precoLider: number | null; pctVsSpot: number | null };

/** Média do spot i5 no período do gráfico e a distância do preço do 1º no RANK até ela; null sem dados de PLD. */
export function metricasMercado(resultado: Resultado, mercado?: DadosMercado): MetricasMercado | null {
  if (!mercado) return null;
  const sub = chaveSubmercado(resultado.params.submercado);
  const serie = mercado.pld[sub] ?? {};
  const meses = Object.keys(serie).sort();
  const ate = meses[meses.length - 1];
  const de = meses.find((m) => m >= "2025-01") ?? meses[0];
  const periodo = meses.filter((m) => m >= de && m <= ate);
  if (periodo.length < 2) return null;
  const pld = periodo.map((m) => serie[m]);
  const i5 = pld.map((v) => v + mercado.spread);
  const media = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const mediaI5 = media(i5);
  const preco = resultado.ranking.find((r) => r.Rank !== "-")?.["Preço Médio (R$/MWh)"] ?? null;
  return {
    mediaI5, mediaPld: media(pld), minI5: Math.min(...i5), maxI5: Math.max(...i5),
    precoLider: preco, pctVsSpot: preco != null && mediaI5 > 0 ? (preco / mediaI5 - 1) * 100 : null,
  };
}

const pct1 = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const reaisMil = (v: number) => (v >= 10000 ? `R$ ${Math.round(v / 1000).toLocaleString("pt-BR")} mil` : `R$ ${Math.round(v).toLocaleString("pt-BR")}`);

/** "Em linguagem simples" da página de mercado. */
function fraseMercado(m: MetricasMercado, tipoLider: unknown): string | null {
  if (m.precoLider == null || m.pctVsSpot == null) return null;
  let t = `O preço do 1º (${moeda(m.precoLider)}) é ${pct1(Math.abs(m.pctVsSpot))}% ${m.pctVsSpot >= 0 ? "maior" : "menor"} que a média histórica do spot i5 no período (${moeda(m.mediaI5)}). ` +
    `O spot oscila mês a mês (de R$ ${inteiro(m.minI5)} a R$ ${inteiro(m.maxI5)} no gráfico).`;
  if (/firme/i.test(String(tipoLider ?? ""))) t += " A proposta firme fixa o preço.";
  else if (/indicativ/i.test(String(tipoLider ?? ""))) t += " Esta proposta é indicativa: o preço ainda pode mudar.";
  return `${t} Valores históricos, sem projeção.`;
}

/** Gera o relatório de equalização em PDF (retrato) no navegador e dispara o download. */
export async function gerarRelatorioPdf(resultado: Resultado, mercado?: DadosMercado, narrativa?: Narrativa) {
  const { jsPDF: JsPdf } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new JsPdf({ orientation: "portrait", unit: "mm", format: "a4" });
  const larg = doc.internal.pageSize.getWidth();
  const alt = doc.internal.pageSize.getHeight();
  const { ranking, cliente, params } = resultado;
  const lider = ranking.find((r) => r.Rank !== "-");
  const nomeCliente = String(cliente["Razão Social"] ?? "Cliente");
  const c: Contexto = { doc, larg, alt, cliente: nomeCliente };
  const util = larg - 2 * MARGEM;
  const hoje = new Date();
  const finalY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const propDe = (nome: string) => resultado.propostas.find((p) => p.Fornecedor === nome) as Dict | undefined;
  const estilo = {
    theme: "plain" as const,
    headStyles: { fillColor: VERDE, textColor: 255, fontStyle: "bold" as const, lineColor: AMARELO_TABELA, lineWidth: { bottom: 0.8 } as never },
    styles: {
      fontSize: 8.5, cellPadding: { top: 3.4, bottom: 3.4, left: 2.4, right: 2.4 }, valign: "middle" as const,
      lineColor: BORDA, lineWidth: { bottom: 0.2 } as never, overflow: "linebreak" as const,
    },
    margin: { left: MARGEM, right: MARGEM, top: 40, bottom: 20 },
  };

  // Comparativo 1º × 2º (mesmos cálculos da aba Comparação).
  const topo2 = (resultado.memoria ?? [])
    .filter((m) => m.calculo && typeof m.Rank === "number")
    .sort((p, q) => (p.Rank as number) - (q.Rank as number))
    .slice(0, 2);
  const cmp = topo2.length === 2 ? comparar(resultado, topo2[0], topo2[1], hoje) : null;
  const metricas = metricasMercado(resultado, mercado);

  // ---------- Página 1: capa ----------
  capa(c, lider);

  // ---------- Página 2: resumo para decisão ----------
  doc.addPage();
  cabecalhoPagina(c, "Decisão", "Resumo para decisão");
  let y = 44;

  const situacao = ranking.map((r) => ({ r, p: propDe(r.Fornecedor), v: validadeDe(propDe(r.Fornecedor), hoje) }));
  const alerta = textoAlertaValidade(situacao.map((x) => ({ nome: x.r.Fornecedor, rank: x.r.Rank, v: x.v })));
  if (alerta) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    const ls = doc.splitTextToSize(alerta, util - 14) as string[];
    const hAl = 14 + ls.length * 4.2;
    doc.setFillColor(...VERMELHO_CLARO);
    doc.setDrawColor(...VERMELHO);
    doc.setLineWidth(0.4);
    doc.roundedRect(MARGEM, y, util, hAl, 2.5, 2.5, "FD");
    doc.setFillColor(...VERMELHO);
    doc.roundedRect(MARGEM, y, 2.4, hAl, 1, 1, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...VERMELHO);
    doc.text("ATENÇÃO: PROPOSTAS VENCIDAS", MARGEM + 7, y + 7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...TEXTO);
    doc.text(ls, MARGEM + 7, y + 12, { lineHeightFactor: 1.25 });
    y += hAl + 13;
  }

  // A fonte do PDF não tem o sinal "−" (U+2212): ele desmonta o espaçamento da linha; usa-se o hífen.
  const semMenos = (t: string) => t.replace(/−/g, "-");
  const resumoBruto = narrativa?.resumo ?? (cmp ? cmp.resumo : null);
  const resumo =
    typeof resumoBruto === "string" ? semMenos(resumoBruto)
    : resumoBruto ? { destaque: semMenos(resumoBruto.destaque), topicos: resumoBruto.topicos.map(semMenos) }
    : null;
  if (lider && resumo) {
    tituloSecao(doc, "Em resumo", y);
    y += 4;
    const corrido = typeof resumo === "string";
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    const linhasDestaque = corrido ? [] : (doc.splitTextToSize(resumo.destaque, util - 10) as string[]);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const linhasCorrido = corrido ? (doc.splitTextToSize(resumo, util - 10) as string[]) : [];
    const linhasTopicos = corrido ? [] : resumo.topicos.map((t) => doc.splitTextToSize(t, util - 17) as string[]);
    const hResumo = corrido
      ? 14 + linhasCorrido.length * 4.2
      : 14 + linhasDestaque.length * 4.6 + 3 + linhasTopicos.reduce((a, l) => a + l.length * 4.2 + 4.2, 0);
    cartaoBase(doc, MARGEM, y, util, hResumo, AMARELO, AMARELO_CLARO);
    doc.setTextColor(...TEXTO);
    let yr = y + 10;
    if (corrido) {
      doc.text(linhasCorrido, MARGEM + 5, yr, { lineHeightFactor: 1.25 });
    } else {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...VERDE);
      doc.text(linhasDestaque, MARGEM + 5, yr, { lineHeightFactor: 1.25 });
      yr += linhasDestaque.length * 4.6 + 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...TEXTO);
      linhasTopicos.forEach((l) => {
        doc.setFillColor(...AMARELO);
        doc.circle(MARGEM + 6.4, yr - 1, 0.9, "F");
        doc.text(l, MARGEM + 10, yr, { lineHeightFactor: 1.25 });
        yr += l.length * 4.2 + 4.2;
      });
    }
    y += hResumo + 12;
  }

  // Indicadores: preço do 1º, economia sobre o 2º no período e distância até o spot i5.
  if (lider) {
    const cartoes: [string, string, boolean][] = [
      [moeda(lider["Preço Médio (R$/MWh)"]), "PREÇO MÉDIO DO 1º (POR MWh)", true],
    ];
    if (cmp) {
      const econ = cmp.totalB.valor - cmp.totalA.valor; // > 0: o 1º é o mais barato
      const maior = Math.max(cmp.totalA.valor, cmp.totalB.valor);
      const p = maior > 0 ? (Math.abs(econ) / maior) * 100 : 0;
      const a0 = cmp.anos[0].ano, a1 = cmp.anos[cmp.anos.length - 1].ano;
      const per = a0 === a1 ? `${a0}` : `${a0} A ${a1}`;
      cartoes.push([reaisMil(Math.abs(econ)), econ >= 0 ? `ECONOMIA SOBRE O 2º EM ${per} (${pct1(p)}%)` : `1º É MAIS CARO QUE O 2º EM ${per} (${pct1(p)}%)`, false]);
    }
    if (metricas?.pctVsSpot != null) {
      cartoes.push([`${metricas.pctVsSpot >= 0 ? "+" : "-"}${pct1(Math.abs(metricas.pctVsSpot))}%`, metricas.pctVsSpot >= 0 ? "ACIMA DA MÉDIA SPOT I5" : "ABAIXO DA MÉDIA SPOT I5", false]);
    }
    const wk = (util - 4 * (cartoes.length - 1)) / cartoes.length;
    cartoes.forEach(([v, rot, dest], i) => cartaoResumo(doc, MARGEM + i * (wk + 4), y, wk, v, rot, dest));
    y += 38;
  }

  // Situação das propostas (até 5; as demais ficam na página "Todas as propostas").
  tituloSecao(doc, "Situação das propostas", y);
  const mostradas = situacao.slice(0, 5);
  autoTable(doc, {
    ...estilo,
    startY: y + 3,
    head: [["#", "Proposta", "Preço médio", "Pontos", "Tipo", "Validade", "Dados"]],
    body: mostradas.map((x) => [
      String(x.r.Rank),
      x.r.Fornecedor,
      x.r["Preço Médio (R$/MWh)"] != null ? moeda(x.r["Preço Médio (R$/MWh)"]) : "—",
      x.r.Pontuação != null ? pct1(x.r.Pontuação) : "—",
      tipoCurto(x.p?.["Tipo de Proposta"] ?? x.r["Tipo de Proposta"]),
      x.v.texto,
      dadosDe(x.p),
    ]),
    columnStyles: { 0: { cellWidth: 8, halign: "center" }, 1: { cellWidth: 36 }, 2: { cellWidth: 27, halign: "right" }, 3: { cellWidth: 17, halign: "right" }, 4: { cellWidth: 28 } },
    didParseCell: (d) => {
      if (d.section === "head" && (d.column.index === 2 || d.column.index === 3)) d.cell.styles.halign = "right";
      if (d.section !== "body") return;
      if (d.row.index === 0) {
        d.cell.styles.fillColor = AMARELO_CLARO;
        d.cell.styles.fontStyle = "bold";
      }
      if (d.column.index === 5) {
        const v = mostradas[d.row.index].v;
        d.cell.styles.fontStyle = "bold";
        if (v.tipo === "vencida") d.cell.styles.textColor = VERMELHO;
        else if (v.tipo === "valida") d.cell.styles.textColor = OK;
      }
    },
  });
  if (situacao.length > mostradas.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...CINZA);
    doc.text(`+ ${situacao.length - mostradas.length} proposta(s) na página "Todas as propostas".`, MARGEM, finalY() + 6);
  }

  // ---------- Página 3: comparativo 1º × 2º ----------
  if (cmp) {
    const [mA, mB] = topo2;
    doc.addPage();
    cabecalhoPagina(c, "Decisão", "Comparativo: 1º × 2º");
    y = 42;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...VERDE);
    doc.text(cortarTexto(doc, `1º ${mA.Fornecedor}   ×   2º ${mB.Fornecedor}`, util), MARGEM, y);
    y += 11;

    // Pontuação por grupo de critérios (somando os pesos de cada grupo).
    const pesos = params.pesos ?? PESOS_PADRAO;
    const grupos: { nome: string; chaves: (keyof Pesos)[] }[] = [
      { nome: "Preço e custo (preço médio e VPL)", chaves: ["preco", "vpl"] },
      { nome: "Flexibilidade", chaves: ["flex_inferior", "flex_superior"] },
      { nome: "Sazonalização", chaves: ["sazo_inferior", "sazo_superior"] },
      { nome: "Modulação", chaves: ["modulacao"] },
    ];
    const pt = (m: "a" | "b", chaves: (keyof Pesos)[]) => chaves.reduce((s, k) => s + (cmp.pontos.find((p) => p.chave === k)?.[m] ?? 0), 0);
    const linhasGrupo = [
      ...grupos.map((g) => ({
        nome: `${g.nome} - até ${g.chaves.reduce((s, k) => s + pesos[k], 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}`,
        a: pt("a", g.chaves), b: pt("b", g.chaves),
      })),
      { nome: "Pontuação total", a: mA.Pontuação ?? 0, b: mB.Pontuação ?? 0 },
    ];
    tituloSecao(doc, "Pontuação por grupo", y);
    autoTable(doc, {
      ...estilo,
      startY: y + 3,
      head: [["Grupo", mA.Fornecedor, mB.Fornecedor]],
      body: linhasGrupo.map((l) => [l.nome, pct1(l.a), pct1(l.b)]),
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
      didParseCell: (d) => {
        if (d.section === "head" && d.column.index > 0) d.cell.styles.halign = "right";
        if (d.section !== "body") return;
        const l = linhasGrupo[d.row.index];
        if (d.row.index === linhasGrupo.length - 1) {
          d.cell.styles.fillColor = AMARELO_CLARO;
          d.cell.styles.fontStyle = "bold";
        } else if ((d.column.index === 1 && l.a > l.b + 0.05) || (d.column.index === 2 && l.b > l.a + 0.05)) {
          d.cell.styles.fontStyle = "bold";
          d.cell.styles.textColor = VERDE;
        }
      },
    });
    y = finalY() + 16;

    // Condições que mudam o risco.
    const cond = (item: string) => cmp.condicoes.find((x) => x.item === item);
    const linhasCond: string[][] = [];
    const natureza = cond("Natureza da proposta");
    if (natureza?.diferente) linhasCond.push(["Natureza da proposta", naturezaLonga(natureza.a) ?? "não informada", naturezaLonga(natureza.b) ?? "não informada"]);
    for (const item of ["Flexibilidade", "Sazonalização", "Modulação"]) {
      const x = cond(item);
      // Só entra se as duas informaram e diferem: "não informado" já aparece na linha "Dados" da página 2.
      if (x?.diferente && (item === "Flexibilidade" || (x.a && x.b))) linhasCond.push([item, x.a ?? "não informada", x.b ?? "não informada"]);
    }
    for (const item of ["Garantia", "Ressarcimento TUSD (R$/MWh)", "Pagamento"]) {
      const x = cond(item);
      if (x?.diferente) linhasCond.push([item, x.a ?? "não informado", x.b ?? "não informado"]);
    }
    linhasCond.push(["Validade", validadeDe(propDe(mA.Fornecedor), hoje).texto, validadeDe(propDe(mB.Fornecedor), hoje).texto]);
    const lA = ranking.find((r) => r.Fornecedor === mA.Fornecedor), lB = ranking.find((r) => r.Fornecedor === mB.Fornecedor);
    linhasCond.push(["Aderência ao produto", lA?.["Aderente ao Produto"] ?? "—", lB?.["Aderente ao Produto"] ?? "—"]);
    tituloSecao(doc, "Condições que mudam o risco", y);
    autoTable(doc, {
      ...estilo,
      startY: y + 3,
      head: [["Condição", mA.Fornecedor, mB.Fornecedor]],
      body: linhasCond.map((l) => l.map(semMenos)),
      columnStyles: { 0: { cellWidth: 38, fontStyle: "bold" } },
    });
  }

  // ---------- Página 4: todas as propostas ----------
  doc.addPage();
  cabecalhoPagina(c, "Detalhamento", "Todas as propostas");
  const paginaIni = doc.getNumberOfPages();
  autoTable(doc, {
    ...estilo,
    startY: 42,
    head: [["#", "Proposta", "Preço médio", "VPL (R$)", "Pontos", "Flexibilidade", "Sazonalidade", "Nº de anos"]],
    body: ranking.map((r) => {
      const p = propDe(r.Fornecedor);
      const m = (resultado.memoria ?? []).find((x) => x.Fornecedor === r.Fornecedor);
      const anos = m?.calculo?.anos.length ?? Object.keys(p ?? {}).filter((k) => /^Preço \d{4} /.test(k)).length;
      return [
        String(r.Rank),
        r.Fornecedor,
        r["Preço Médio (R$/MWh)"] != null ? num2(r["Preço Médio (R$/MWh)"]) : "—",
        r["VPL (R$)"] != null ? r["VPL (R$)"].toLocaleString("pt-BR", { maximumFractionDigits: 0 }) : "—",
        r.Pontuação != null ? pct1(r.Pontuação) : "—",
        textoOuNao(p?.["Flexibilidade"]),
        textoOuNao(p?.["Sazonalidade"]),
        anos > 0 ? String(anos) : "—",
      ];
    }),
    columnStyles: { 0: { cellWidth: 8, halign: "center" }, 1: { cellWidth: 44, fontStyle: "bold" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 7: { halign: "center" } },
    didParseCell: (d) => {
      if (d.section === "head" && d.column.index >= 2 && d.column.index <= 4) d.cell.styles.halign = "right";
      if (d.section === "head" && d.column.index === 7) d.cell.styles.halign = "center";
      if (d.section === "body" && d.row.index === 0 && lider?.Rank === 1) d.cell.styles.fillColor = AMARELO_CLARO;
    },
    didDrawPage: () => {
      if (doc.getCurrentPageInfo().pageNumber !== paginaIni) cabecalhoPagina(c, "Detalhamento", "Todas as propostas (continuação)");
    },
  });

  // Como ler este relatório.
  const pesos = params.pesos ?? PESOS_PADRAO;
  const n0 = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  const glossario: [string, string][] = [
    ["RANK", `ordem das propostas pela pontuação de 0 a 100 (preço e custo ${n0(pesos.preco + pesos.vpl)}, flexibilidade ${n0(pesos.flex_inferior + pesos.flex_superior)}, sazonalização ${n0(pesos.sazo_inferior + pesos.sazo_superior)}, modulação ${n0(pesos.modulacao)}).`],
    ["Preço médio", "média ponderada do preço por MWh nos meses do contrato (R$/MWh)."],
    ["VPL", `custo total do contrato trazido a valor de hoje, com a taxa de ${n0(params.tma_pct)}% ao ano. Menor é melhor.`],
    ["Spot i5", "referência de preço de curto prazo da energia incentivada (PLD + spread). Serve de comparação, não é proposta."],
    ["Firme / Indicativa", "firme pode ser contratada na validade; indicativa é só uma cotação de mercado."],
    ["Flexibilidade e sazonalização", "quanto o consumo pode variar de mês a mês e dentro do ano, sem penalidade."],
    ["Modulação", "se a energia segue a curva de consumo (Carga) ou é constante (Flat)."],
  ];
  const hG = 14 + glossario.length * 12;
  let yG = finalY() + 18;
  if (yG + 12 + hG > alt - 18) {
    doc.addPage();
    cabecalhoPagina(c, "Detalhamento", "Como ler este relatório");
    yG = 46;
  } else {
    tituloSecao(doc, "Como ler este relatório", yG);
  }
  cartaoBase(doc, MARGEM, yG + 3, util, hG, VERDE, VERDE_CLARO);
  let yg = yG + 3 + 11;
  for (const [t, def] of glossario) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...VERDE);
    doc.text(t, MARGEM + 5, yg);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...TEXTO);
    doc.text(doc.splitTextToSize(def, util - 52) as string[], MARGEM + 47, yg, { lineHeightFactor: 1.2 });
    yg += 12;
  }

  // ---------- Página 5: cenário de mercado (PLD × Energia i5 Spot × 1º no RANK) ----------
  if (mercado) paginaPld(c, resultado, mercado, lider);

  // ---------- Página 6: dados do cliente e parâmetros ----------
  doc.addPage();
  cabecalhoPagina(c, "Premissas", "Cliente e Parâmetros");
  const dado = (k: string) => (vazio(cliente[k]) ? "—" : String(cliente[k]));
  let yp = 46;
  yp = painelDados(doc, larg, yp, "Dados do cliente", [
    { rotulo: "Razão social", valor: dado("Razão Social"), destaque: true, colunas: 3 },
    { rotulo: "CNPJ", valor: dado("CNPJ") },
    { rotulo: "Modalidade", valor: dado("Modalidade") },
    { rotulo: "Tipo de energia", valor: dado("Tipo de Energia") },
    { rotulo: "Submercado", valor: dado("Submercado") },
    { rotulo: "Período", valor: periodoLegivel(dado("Período")) },
    { rotulo: "Volume (MWm)", valor: volumeLegivel(dado("Volume (MWm)")) },
    { rotulo: "Flexibilidade", valor: flexLegivel(dado("Flexibilidade")) },
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

  // ---------- Página de contatos ----------
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
