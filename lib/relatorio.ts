import type { jsPDF } from "jspdf";
import { LOGO_30_ANOS, LOGO_30_ANOS_PROPORCAO } from "./logo30";
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

/** Gráfico de barras horizontais. Retorna a posição Y logo abaixo do gráfico. */
function barrasHorizontais(
  doc: jsPDF,
  y: number,
  itens: { nome: string; valor: number; lider: boolean }[],
  formatar: (v: number) => string,
  larg: number,
): number {
  const xNome = MARGEM;
  const wNome = 36;
  const xBarra = xNome + wNome + 2;
  const wMax = larg - MARGEM - xBarra - 2;
  // A escala começa um pouco abaixo do menor valor para evidenciar as diferenças.
  const max = Math.max(1e-9, ...itens.map((i) => i.valor));
  const piso = Math.min(...itens.map((i) => i.valor)) * 0.9;
  const altBarra = 5.4;
  const passo = 7;
  itens.forEach((it, i) => {
    const yy = y + i * passo;
    doc.setFont("helvetica", it.lider ? "bold" : "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...(it.lider ? VERDE : CINZA));
    doc.text(it.nome, xNome + wNome, yy + 3.9, { align: "right", maxWidth: wNome });
    doc.setFillColor(...VERDE_CLARO);
    doc.roundedRect(xBarra, yy, wMax, altBarra, 1, 1, "F");
    const w = Math.max(14, ((it.valor - piso) / Math.max(1e-9, max - piso)) * wMax);
    doc.setFillColor(...(it.lider ? VERDE : VERDE_SUAVE));
    doc.roundedRect(xBarra, yy, w, altBarra, 1, 1, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    doc.setTextColor(255, 255, 255);
    doc.text(formatar(it.valor), xBarra + w - 1.5, yy + 3.8, { align: "right" });
  });
  doc.setFont("helvetica", "italic");
  doc.setFontSize(6.5);
  doc.setTextColor(...CINZA);
  doc.text("Escala das barras iniciada abaixo do menor valor, para evidenciar as diferenças.", xBarra, y + itens.length * passo + 2);
  return y + itens.length * passo + 3;
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

/** Gera o relatório de equalização em PDF (retrato) no navegador e dispara o download. */
export async function gerarRelatorioPdf(resultado: Resultado) {
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

  // Página 2: resumo e gráficos
  doc.addPage();
  cabecalhoPagina(c, "Resultado", "Ranking da Equalização");
  let y = 44;
  if (lider) {
    const w = (larg - 2 * MARGEM - 8) / 3;
    cartaoKpi(doc, MARGEM, y, w, "1º COLOCADO", lider.Fornecedor, true);
    cartaoKpi(doc, MARGEM + w + 4, y, w, "VPL DO 1º COLOCADO", moeda(lider["VPL (R$)"]));
    cartaoKpi(doc, MARGEM + 2 * (w + 4), y, w, "PREÇO MÉDIO DO 1º (R$/MWh)", moeda(lider["Preço Médio (R$/MWh)"]));
    y += 32;
  }

  const comPreco = ranking.filter((r) => r["Preço Médio (R$/MWh)"] != null);
  tituloSecao(doc, "Preço médio por proposta (R$/MWh)", y);
  y = barrasHorizontais(
    doc,
    y + 5,
    comPreco.map((r) => ({ nome: r.Fornecedor, valor: r["Preço Médio (R$/MWh)"] as number, lider: r.Rank === lider?.Rank })),
    num2,
    larg,
  );

  y += 8;
  const comVpl = ranking.filter((r) => r["VPL (R$)"] != null);
  tituloSecao(doc, "VPL por proposta (R$) — menor é melhor", y);
  y = barrasHorizontais(
    doc,
    y + 5,
    comVpl.map((r) => ({ nome: r.Fornecedor, valor: r["VPL (R$)"] as number, lider: r.Rank === lider?.Rank })),
    (v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 }),
    larg,
  );

  const propostaLider = resultado.propostas.find((p) => p.Fornecedor === lider?.Fornecedor);
  const precos = propostaLider
    ? Object.entries(propostaLider)
        .map(([k, v]) => ({ m: k.match(/^Preço (\d{4}) /), v }))
        .filter((x) => x.m && typeof x.v === "number")
        .map((x) => ({ ano: x.m![1], preco: x.v as number }))
    : [];
  if (lider && precos.length > 0) {
    y += 8;
    if (y + 50 > alt - 16) {
      doc.addPage();
      cabecalhoPagina(c, "Resultado", "Curva de Preço");
      y = 50;
    }
    tituloSecao(doc, `Curva de preço — ${lider.Fornecedor} (R$/MWh)`, y);
    colunasPorAno(doc, MARGEM + 4, y + 6, larg - 2 * MARGEM - 8, 32, precos);
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
