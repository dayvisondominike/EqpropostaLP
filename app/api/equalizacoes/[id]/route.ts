import { list } from "@vercel/blob";
import { NextResponse } from "next/server";
import { ID_VALIDO } from "@/lib/equalizacoes";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID_VALIDO.test(id)) return NextResponse.json({ erro: "Identificador inválido." }, { status: 400 });
  try {
    const { blobs } = await list({ prefix: `equalizacoes/${id}.json`, limit: 1 });
    if (blobs.length === 0) return NextResponse.json({ erro: "Equalização não encontrada." }, { status: 404 });
    const resp = await fetch(blobs[0].url, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Falha ao ler o banco (HTTP ${resp.status}).`);
    return NextResponse.json(await resp.json(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message }, { status: 500 });
  }
}
