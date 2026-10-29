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
};

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
  estado: EstadoFornecedor;
  detalhe?: string;
};
