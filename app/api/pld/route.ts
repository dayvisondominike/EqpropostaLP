import { list, put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { mesclarPld, type DadosPld } from "@/lib/ccee";
import base from "@/lib/pld_base.json";

export const dynamic = "force-dynamic";

// Histórico do PLD guardado no Vercel Blob: um documento JSON atualizado a cada "Atualizar PLD".
const CAMINHO = "pld/historico.json";
const SUBMERCADOS = new Set(["SUDESTE", "SUL", "NORDESTE", "NORTE"]);

type Armazenado = { atualizadoEm: string; dados: DadosPld };

async function lerBanco(): Promise<Armazenado | null> {
  try {
    const { blobs } = await list({ prefix: CAMINHO, limit: 1 });
    if (blobs.length === 0) return null;
    const resp = await fetch(blobs[0].url, { cache: "no-store" });
    return resp.ok ? ((await resp.json()) as Armazenado) : null;
  } catch {
    return null; // banco indisponível: segue com a cópia embutida
  }
}

async function montarResposta() {
  const banco = await lerBanco();
  const copia = base.dados as DadosPld;
  return {
    fonte: banco ? "Banco de dados (Vercel Blob)" : `Cópia embutida — ${base.referencia}`,
    atualizadoEm: banco?.atualizadoEm ?? null,
    dados: banco ? mesclarPld(copia, banco.dados) : copia,
  };
}

function validar(dados: unknown): DadosPld {
  if (typeof dados !== "object" || dados === null) throw new Error("Formato inválido.");
  const saida: DadosPld = {};
  let total = 0;
  for (const [sub, meses] of Object.entries(dados as Record<string, unknown>)) {
    if (!SUBMERCADOS.has(sub) || typeof meses !== "object" || meses === null) throw new Error(`Submercado inválido: ${sub}`);
    for (const [mes, valor] of Object.entries(meses as Record<string, unknown>)) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new Error(`Mês inválido: ${mes}`);
      if (typeof valor !== "number" || !Number.isFinite(valor) || valor < 0 || valor > 5000) throw new Error(`Valor inválido em ${sub} ${mes}`);
      (saida[sub] ??= {})[mes] = valor;
      total++;
    }
  }
  if (total === 0) throw new Error("Nenhum dado informado.");
  return saida;
}

export async function GET() {
  return NextResponse.json(await montarResposta(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const { dados } = (await request.json()) as { dados: unknown };
    const novos = validar(dados);
    const atual = await lerBanco();
    const documento: Armazenado = {
      atualizadoEm: new Date().toISOString(),
      dados: atual ? mesclarPld(atual.dados, novos) : novos,
    };
    await put(CAMINHO, JSON.stringify(documento), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return NextResponse.json(await montarResposta(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message }, { status: 400 });
  }
}
