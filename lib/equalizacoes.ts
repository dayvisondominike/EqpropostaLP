import type { Cliente, Params, Proposta, Resultado } from "./types";

/** Equalização completa guardada no banco: cliente, produto (dentro do cliente), propostas extraídas, parâmetros e resultado. */
export type EqualizacaoSalva = {
  id: string;
  criadoEm: string;
  atualizadoEm: string;
  cliente: Cliente;
  params: Params;
  propostas: Proposta[];
  resultado: Resultado;
};

/** Linha da lista "abrir equalização existente". */
export type ResumoEqualizacao = {
  id: string;
  criadoEm: string;
  atualizadoEm: string;
  razaoSocial: string;
  cnpj: string;
  submercado: string;
  periodo: string;
  lider: string;
  propostas: number;
};

export const ID_VALIDO = /^[0-9a-f-]{36}$/;

export function resumir(e: EqualizacaoSalva): ResumoEqualizacao {
  const lider = e.resultado.ranking.find((r) => r.Rank !== "-");
  const c = e.cliente;
  return {
    id: e.id,
    criadoEm: e.criadoEm,
    atualizadoEm: e.atualizadoEm,
    razaoSocial: String(c["Razão Social"] ?? "Sem nome"),
    cnpj: String(c["CNPJ"] ?? ""),
    submercado: String(c["Submercado"] ?? e.params.submercado ?? ""),
    periodo: String(c["Período"] ?? ""),
    lider: lider?.Fornecedor ?? "—",
    propostas: e.resultado.ranking.length,
  };
}
