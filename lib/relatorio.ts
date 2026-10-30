import type { Resultado } from "./types";

const VERDE: [number, number, number] = [1, 98, 92];
const AMARELO: [number, number, number] = [248, 176, 38];
const AMARELO_CLARO: [number, number, number] = [255, 244, 217];
const CINZA: [number, number, number] = [95, 111, 108];

const moeda = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Gera o relatório de equalização em PDF no navegador e dispara o download. */
export async function gerarRelatorioPdf(resultado: Resultado) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const larg = doc.internal.pageSize.getWidth();
  const alt = doc.internal.pageSize.getHeight();
  const margem = 14;
  const { ranking, cliente, params } = resultado;
  const lider = ranking.find((r) => r.Rank !== "-");

  const cabecalho = () => {
    doc.setFillColor(...VERDE);
    doc.rect(0, 0, larg, 20, "F");
    doc.setFillColor(...AMARELO);
    doc.rect(0, 20, larg, 1.5, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("Relatório de Equalização de Propostas", margem, 13);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Análise de Viabilidade · Mercado Livre de Energia", larg - margem, 13, { align: "right" });
  };

  const titulo = (texto: string, y: number) => {
    doc.setTextColor(...AMARELO);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("//", margem, y);
    doc.setTextColor(...VERDE);
    doc.setFontSize(12);
    doc.text(texto, margem + 8, y);
  };

  cabecalho();
  let y = 34;

  // Dados do cliente
  titulo("Dados do cliente", y);
  const campos = ["Razão Social", "CNPJ", "Modalidade", "Tipo de Energia", "Submercado", "Período", "Volume (MWm)", "Flexibilidade", "Sazo", "Modulação"];
  autoTable(doc, {
    startY: y + 4,
    body: [0, 5].map((i) => campos.slice(i, i + 5).flatMap((c) => [c, String(cliente[c] ?? "—")])),
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 1.8, lineColor: [217, 227, 225] },
    columnStyles: { 0: { fontStyle: "bold", textColor: CINZA }, 2: { fontStyle: "bold", textColor: CINZA }, 4: { fontStyle: "bold", textColor: CINZA }, 6: { fontStyle: "bold", textColor: CINZA }, 8: { fontStyle: "bold", textColor: CINZA } },
    margin: { left: margem, right: margem },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

  // Destaque do 1º colocado
  if (lider) {
    doc.setFillColor(...AMARELO_CLARO);
    doc.roundedRect(margem, y, larg - 2 * margem, 16, 2, 2, "F");
    doc.setTextColor(...VERDE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`1º colocado: ${lider.Fornecedor}`, margem + 4, y + 6.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(
      `VPL ${moeda(lider["VPL (R$)"])}   ·   Preço médio ${moeda(lider["Preço Médio (R$/MWh)"])}/MWh   ·   ${ranking.length} proposta(s) analisada(s)`,
      margem + 4,
      y + 12,
    );
    y += 24;
  }

  // Ranking
  titulo("Ranking da equalização", y);
  autoTable(doc, {
    startY: y + 4,
    head: [["Rank", "Fornecedor", "Flex", "Tipo", "Preço médio (R$/MWh)", "VPL (R$)", "Aderência", "Observações"]],
    body: ranking.map((r) => [
      String(r.Rank),
      r.Fornecedor,
      r.Flex,
      r["Tipo de Proposta"],
      moeda(r["Preço Médio (R$/MWh)"]),
      moeda(r["VPL (R$)"]),
      r["Aderente ao Produto"],
      r.Observações,
    ]),
    headStyles: { fillColor: VERDE, textColor: 255, lineColor: [255, 217, 102], lineWidth: { bottom: 0.8 } as never },
    styles: { fontSize: 8, cellPadding: 2, overflow: "linebreak" },
    columnStyles: { 0: { halign: "center", cellWidth: 12 }, 4: { halign: "right" }, 5: { halign: "right" }, 7: { cellWidth: 70 } },
    didParseCell: (d) => {
      if (d.section === "body" && d.row.index === 0 && lider?.Rank === 1) {
        d.cell.styles.fillColor = AMARELO_CLARO;
        d.cell.styles.fontStyle = "bold";
      }
    },
    margin: { left: margem, right: margem },
  });

  // Parâmetros
  doc.addPage();
  cabecalho();
  y = 34;
  titulo("Parâmetros de cálculo e aderência", y);
  const linhas: [string, string][] = [
    ["TMA (% a.a.)", String(params.tma_pct)],
    ["Horas por ano", String(params.horas_por_ano)],
    ["Ano base", String(params.ano_base)],
    ["Fonte incentivada exigida (%)", String(params.fonte_percentual)],
    ["Submercado", params.submercado],
    ["Período", `${params.ano_inicio} a ${params.ano_fim}`],
    ["Modulação", params.modulacao],
    ["Flexibilidade (+ / −) %", `${params.flex_superior} / ${params.flex_inferior}`],
    ["Sazonalização", params.sazonalizacao === "Personalizada" ? `Personalizada (+${params.sazo_superior}% / −${params.sazo_inferior}%)` : "Flat"],
  ];
  autoTable(doc, {
    startY: y + 4,
    body: linhas,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 2, lineColor: [217, 227, 225] },
    columnStyles: { 0: { fontStyle: "bold", textColor: CINZA, cellWidth: 70 } },
    margin: { left: margem, right: margem },
  });

  // Rodapé e numeração
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...CINZA);
    doc.text("O CLIENTE • RESULTADO • ENERGIA • SOLIDEZ • FOCO NO CLIENTE", margem, alt - 6);
    doc.text(`Página ${i} de ${total}`, larg - margem, alt - 6, { align: "right" });
  }

  const nome = String(cliente["Razão Social"] ?? "cliente").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "");
  doc.save(`Relatorio_Equalizacao_${nome}.pdf`);
}
