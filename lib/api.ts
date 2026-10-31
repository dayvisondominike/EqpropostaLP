import { upload } from "@vercel/blob/client";
import type { Cliente, Params, Proposta, Resultado } from "./types";
import type { EqualizacaoSalva, ResumoEqualizacao } from "./equalizacoes";

async function postar<T>(caminho: string, corpo: unknown): Promise<T> {
  const resp = await fetch(caminho, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const texto = await resp.text();
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    throw new Error(`Resposta inesperada de ${caminho} (HTTP ${resp.status}).`);
  }
  if (!resp.ok) throw new Error((json as { erro?: string }).erro ?? `Erro HTTP ${resp.status}`);
  return json as T;
}

const TIPOS_ARQUIVO: Record<string, string> = {
  pdf: "application/pdf",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
};

export const extensaoDe = (nome: string) => nome.split(".").pop()?.toLowerCase() ?? "";
export const ehPlanilha = (nome: string) => ["csv", "xlsx", "xlsm"].includes(extensaoDe(nome));
export const ehArquivoAceito = (nome: string) => extensaoDe(nome) in TIPOS_ARQUIVO;

/** Envia um PDF, CSV ou XLSX direto ao Blob e devolve a URL. */
export async function enviarPdf(arquivo: File, pasta: string): Promise<string> {
  const blob = await upload(`cotacao/${pasta}/${arquivo.name}`, arquivo, {
    access: "public",
    handleUploadUrl: "/api/blob-upload",
    contentType: TIPOS_ARQUIVO[extensaoDe(arquivo.name)] ?? "application/pdf",
  });
  return blob.url;
}

export type RespostaCliente = {
  dados: Cliente;
  params: Params;
  eventos: Record<string, string>[];
};

export const extrairCliente = (url: string) => postar<RespostaCliente>("/api/cliente", { url });

export type RespostaFornecedor = {
  pasta: string;
  origem: string;
  eventos: Record<string, string>[];
  dados: Proposta;
};

export const extrairFornecedor = (fornecedor: string, urls: string[]) =>
  postar<RespostaFornecedor>("/api/extrair", { fornecedor, urls });

export type RespostaPld = { fonte: string; atualizadoEm: string | null; dados: Record<string, Record<string, number>> };

export async function buscarPld(): Promise<RespostaPld> {
  const resp = await fetch("/api/pld", { cache: "no-store" });
  if (!resp.ok) throw new Error(`Erro HTTP ${resp.status} ao ler o histórico do PLD.`);
  return resp.json();
}

/** Grava no banco (Vercel Blob) os dados baixados da CCEE e devolve o histórico consolidado. */
export const salvarPld = (dados: Record<string, Record<string, number>>) => postar<RespostaPld>("/api/pld", { dados });

export const consolidar = (propostas: Proposta[], cliente: Cliente, params?: Partial<Params>) =>
  postar<Resultado>("/api/consolidar", { propostas, cliente, params });

export async function listarEqualizacoes(): Promise<ResumoEqualizacao[]> {
  const resp = await fetch("/api/equalizacoes", { cache: "no-store" });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.erro ?? `Erro HTTP ${resp.status} ao listar as equalizações.`);
  return json.itens;
}

export async function abrirEqualizacao(id: string): Promise<EqualizacaoSalva> {
  const resp = await fetch(`/api/equalizacoes/${id}`, { cache: "no-store" });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.erro ?? `Erro HTTP ${resp.status} ao abrir a equalização.`);
  return json;
}

/** Cria (sem `id`) ou atualiza (com `id`) a equalização no banco e devolve o `id`. */
export const salvarEqualizacao = (eq: Omit<EqualizacaoSalva, "id" | "criadoEm" | "atualizadoEm"> & { id?: string }) =>
  postar<{ id: string; resumo: ResumoEqualizacao }>("/api/equalizacoes", eq);

export async function excluirEqualizacao(id: string): Promise<void> {
  const resp = await fetch(`/api/equalizacoes/${id}`, { method: "DELETE" });
  if (!resp.ok) throw new Error(((await resp.json().catch(() => ({}))) as { erro?: string }).erro ?? `Erro HTTP ${resp.status} ao excluir.`);
}

export type TipoDocumento = "proposta" | "email_cliente" | "anexo_contrato" | "outro";

export type RespostaIdentificacao = { fornecedor: string; tipo: TipoDocumento; cliente: string; origem: string };

/** Pede à LLM para dizer de qual fornecedor é o PDF (ou se é o e-mail do cliente). */
export const identificarPdf = (url: string, nome: string) => postar<RespostaIdentificacao>("/api/identificar", { url, nome });
