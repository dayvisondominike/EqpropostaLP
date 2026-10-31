export type Params = {
  tma_pct: number;
  horas_por_ano: number;
  ano_base: number;
  fonte_percentual: number;
  submercado: string;
  ano_inicio: number;
  ano_fim: number;
  modulacao: "Flat" | "Carga";
  flex_superior: number;
  flex_inferior: number;
  sazonalizacao: "Flat" | "Personalizada";
  sazo_superior: number;
  sazo_inferior: number;
  /** Pesos da pontuação do rank; ausente em equalizações salvas antes da pontuação (vale o padrão). */
  pesos?: Pesos;
};

export type Pesos = {
  preco: number;
  vpl: number;
  flex_inferior: number;
  flex_superior: number;
  sazo_inferior: number;
  sazo_superior: number;
  modulacao: number;
};

/** Mesmos valores de PESOS_PADRAO em api/_engine/criterio_rank.py. */
export const PESOS_PADRAO: Pesos = {
  preco: 35, vpl: 25, flex_inferior: 10, flex_superior: 10, sazo_inferior: 5, sazo_superior: 5, modulacao: 10,
};

export const ROTULOS_PESOS: { chave: keyof Pesos; rotulo: string }[] = [
  { chave: "preco", rotulo: "Preço médio" },
  { chave: "vpl", rotulo: "VPL" },
  { chave: "flex_inferior", rotulo: "Flexibilidade inferior −" },
  { chave: "flex_superior", rotulo: "Flexibilidade superior +" },
  { chave: "sazo_inferior", rotulo: "Sazonalização inferior −" },
  { chave: "sazo_superior", rotulo: "Sazonalização superior +" },
  { chave: "modulacao", rotulo: "Modulação" },
];

export const SUBMERCADOS = [
  "Nordeste (NE)",
  "Sudeste/Centro-Oeste (SE/CO)",
  "Sul (S)",
  "Norte (N)",
];

export type Cliente = Record<string, string | number | null>;

export type Proposta = Record<string, string | number | boolean | null | Record<string, number>>;

export type LinhaRanking = {
  Rank: number | "-";
  Fornecedor: string;
  Flex: string;
  "Tipo de Proposta": string;
  "Preço Médio (R$/MWh)": number | null;
  "VPL (R$)": number | null;
  /** 0 a 100; ausente em equalizações salvas antes da pontuação e null nas propostas sem dados. */
  Pontuação?: number | null;
  "Aderente ao Produto": string;
  Observações: string;
};

export type Resultado = {
  ranking: LinhaRanking[];
  propostas: Record<string, string | number | null>[];
  cliente: Cliente;
  params: Params;
  xlsx: { nome: string; base64: string };
};

export type EstadoFornecedor = "pendente" | "processando" | "concluido" | "erro";

export type Fornecedor = {
  id: string;
  nome: string;
  arquivos: File[];
  /** URLs no Blob quando os PDFs já foram enviados (arrastar e soltar). */
  urls?: string[];
  /** Proposta já pronta (linha de uma planilha de cotações): dispensa a extração. */
  proposta?: Proposta;
  estado: EstadoFornecedor;
  detalhe?: string;
};
