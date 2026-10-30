/** Consulta direta (pelo navegador) ao portal de dados abertos da CCEE: PLD médio mensal por submercado. */
export type DadosPld = Record<string, Record<string, number>>;

const CCEE = "https://dadosabertos.ccee.org.br/api/3/action";

/** Spread I5 − PLD (R$/MWh): chave do navegador e valor inicial, compartilhados pela tela PLD × I5 e pelo relatório. */
export const CHAVE_SPREAD = "equalizacao:spread-i5";
export const SPREAD_PADRAO = 35;

export function lerSpreadSalvo(): number {
  try {
    const salvo = localStorage.getItem(CHAVE_SPREAD);
    if (salvo !== null && salvo.trim() !== "") {
      const n = Number(salvo.replace(",", "."));
      if (Number.isFinite(n)) return n;
    }
  } catch { /* armazenamento indisponível */ }
  return SPREAD_PADRAO;
}

async function obter<T>(url: string): Promise<T> {
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw new Error(`CCEE respondeu HTTP ${resp.status}.`);
  return (await resp.json()) as T;
}

export async function baixarPldCcee(): Promise<DadosPld> {
  const pacote = await obter<{ result: { resources: { id: string; name: string }[] } }>(`${CCEE}/package_show?id=pld_media_mensal`);
  const anos = pacote.result.resources.filter((r) => {
    const ano = r.name.split("_").pop() ?? "";
    return /^\d{4}$/.test(ano) && Number(ano) >= 2021;
  });
  if (anos.length === 0) throw new Error("O portal da CCEE não retornou os arquivos do PLD médio mensal.");

  const dados: DadosPld = {};
  await Promise.all(
    anos.map(async (rec) => {
      const r = await obter<{ result: { records: { MES_REFERENCIA: string | number; SUBMERCADO: string; PLD_MEDIA_MES: number }[] } }>(
        `${CCEE}/datastore_search?resource_id=${rec.id}&limit=1000`,
      );
      for (const x of r.result.records) {
        const mes = String(x.MES_REFERENCIA);
        (dados[x.SUBMERCADO] ??= {})[`${mes.slice(0, 4)}-${mes.slice(4, 6)}`] = Number(x.PLD_MEDIA_MES);
      }
    }),
  );
  if (Object.keys(dados).length === 0) throw new Error("Nenhum dado de PLD retornado pela CCEE.");
  return dados;
}

/** Sobrepõe `novo` a `base`, mês a mês. */
export function mesclarPld(base: DadosPld, novo: DadosPld): DadosPld {
  const saida: DadosPld = {};
  for (const s of new Set([...Object.keys(base), ...Object.keys(novo)])) {
    saida[s] = Object.fromEntries(Object.entries({ ...(base[s] ?? {}), ...(novo[s] ?? {}) }).sort());
  }
  return saida;
}
