import { upload } from "@vercel/blob/client";
import type { Cliente, Params, Proposta, Resultado } from "./types";

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

export async function enviarPdf(arquivo: File, pasta: string): Promise<string> {
  const blob = await upload(`cotacao/${pasta}/${arquivo.name}`, arquivo, {
    access: "public",
    handleUploadUrl: "/api/blob-upload",
    contentType: "application/pdf",
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
