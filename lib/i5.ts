/** Leitura da planilha de Energia I5 (preço médio comprado no curto prazo), por mês e submercado. */
export type SerieI5 = Record<string, Record<string, number>>;

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const semAcento = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().trim();

function submercado(v: unknown): string | null {
  const s = semAcento(String(v ?? ""));
  if (!s) return null;
  if (s.startsWith("SUDESTE") || s === "SE" || s.startsWith("SE/")) return "SUDESTE";
  if (s.startsWith("SUL") || s === "S") return "SUL";
  if (s.startsWith("NORDESTE") || s === "NE") return "NORDESTE";
  if (s.startsWith("NORTE") || s === "N") return "NORTE";
  return null;
}

function mes(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}`;
  }
  const s = semAcento(String(v ?? "")).toLowerCase();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{4})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}`;
  m = s.match(/^([a-z]{3})[a-z]*[-/. ]+(\d{2}|\d{4})$/);
  if (m && MESES.includes(m[1])) {
    const ano = m[2].length === 2 ? `20${m[2]}` : m[2];
    return `${ano}-${String(MESES.indexOf(m[1]) + 1).padStart(2, "0")}`;
  }
  return null;
}

function numero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").replace(/[R$\s]/g, "");
  if (!s) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
}

function linhasCsv(texto: string): string[][] {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim());
  const sep = (linhas[0]?.match(/;/g)?.length ?? 0) >= (linhas[0]?.match(/,/g)?.length ?? 0) && linhas[0]?.includes(";") ? ";" : linhas[0]?.includes("\t") ? "\t" : ",";
  return linhas.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, "")));
}

export async function lerPlanilhaI5(arquivo: File, submercadoPadrao: string): Promise<{ serie: SerieI5; meses: number }> {
  let linhas: unknown[][];
  if (/\.xlsx$/i.test(arquivo.name)) {
    const { default: lerXlsx } = await import("read-excel-file");
    linhas = (await lerXlsx(arquivo)) as unknown[][];
  } else {
    linhas = linhasCsv(await arquivo.text());
  }
  if (linhas.length < 2) throw new Error("A planilha precisa ter um cabeçalho e ao menos uma linha de dados.");

  const cab = linhas[0].map((c) => semAcento(String(c ?? "")));
  const iMes = cab.findIndex((c) => c.startsWith("MES") || c.includes("DATA") || c.includes("PERIODO"));
  const iSub = cab.findIndex((c) => c.includes("SUBMERCADO"));
  const iVal = cab.findIndex((c) => c.includes("I5") || c.includes("PRECO") || c.includes("VALOR"));
  if (iMes < 0 || iVal < 0) throw new Error("Não encontrei as colunas. Use: Mês, Submercado (opcional) e Energia I5.");

  const serie: SerieI5 = {};
  let meses = 0;
  for (const l of linhas.slice(1)) {
    const k = mes(l[iMes]);
    const v = numero(l[iVal]);
    const s = iSub >= 0 ? submercado(l[iSub]) : submercadoPadrao;
    if (!k || v == null || !s) continue;
    (serie[s] ??= {})[k] = v;
    meses++;
  }
  if (meses === 0) throw new Error("Nenhuma linha válida encontrada (confira mês, submercado e valores).");
  return { serie, meses };
}

export const modeloCsvI5 = () =>
  "Mês;Submercado;Energia I5 (R$/MWh)\r\njan/25;Sul;94,00\r\nfev/25;Sul;129,00\r\nmar/25;Sul;368,00\r\n";
