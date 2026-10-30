import { list, put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { ID_VALIDO, resumir, type EqualizacaoSalva } from "@/lib/equalizacoes";

export const dynamic = "force-dynamic";

// Banco de equalizações no Vercel Blob: um documento JSON por equalização em equalizacoes/<id>.json.
const PREFIXO = "equalizacoes/";
const LIMITE_LISTA = 200;

async function lerPorUrl(url: string): Promise<EqualizacaoSalva | null> {
  try {
    const resp = await fetch(url, { cache: "no-store" });
    return resp.ok ? ((await resp.json()) as EqualizacaoSalva) : null;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const { blobs } = await list({ prefix: PREFIXO, limit: LIMITE_LISTA });
    const docs = await Promise.all(blobs.map((b) => lerPorUrl(b.url)));
    const itens = docs
      .filter((d): d is EqualizacaoSalva => d !== null)
      .map(resumir)
      .sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm));
    return NextResponse.json({ itens }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message }, { status: 500 });
  }
}

/** Cria (sem `id`) ou atualiza (com `id`) uma equalização. */
export async function POST(request: Request) {
  try {
    const corpo = (await request.json()) as Partial<EqualizacaoSalva>;
    if (!corpo.cliente || !corpo.params || !Array.isArray(corpo.propostas) || !corpo.resultado?.ranking) {
      throw new Error("Equalização incompleta: faltam cliente, parâmetros, propostas ou resultado.");
    }
    const id = corpo.id ?? crypto.randomUUID();
    if (!ID_VALIDO.test(id)) throw new Error("Identificador inválido.");

    const caminho = `${PREFIXO}${id}.json`;
    let criadoEm = new Date().toISOString();
    if (corpo.id) {
      const { blobs } = await list({ prefix: caminho, limit: 1 });
      const existente = blobs[0] ? await lerPorUrl(blobs[0].url) : null;
      if (existente) criadoEm = existente.criadoEm;
    }
    const doc: EqualizacaoSalva = {
      id,
      criadoEm,
      atualizadoEm: new Date().toISOString(),
      cliente: corpo.cliente,
      params: corpo.params,
      propostas: corpo.propostas,
      resultado: corpo.resultado,
    };
    await put(caminho, JSON.stringify(doc), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return NextResponse.json({ id, resumo: resumir(doc) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message }, { status: 400 });
  }
}
