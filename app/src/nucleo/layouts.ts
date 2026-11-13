// Imagens de layout das zonas (Exile-UI, MIT; ver leveling/terceiros/LEIA-ME.md).
// As imagens (public/layouts) e o índice (src/dados/layouts.json) saem de
// scripts/copiar-layouts.mjs.
//
// Nome das imagens de uma zona:
//   "1", "2"…      pista pra reconhecer o layout: o que se vê na entrada da zona
//   "1_1", "1_2"…  o caminho naquele layout (às vezes com mais um nível: "1_1_1")
//   "x"            dica que vale pra zona toda; "x_x" = dica da segunda parte do caminho

import indice from "../dados/layouts.json";

const INDICE = new Map<string, readonly string[]>(Object.entries(indice));

export interface LayoutsDaZona {
  area_id: string;
  /** A pista de cada layout possível da zona, na ordem ("1", "2"…). */
  pistas: string[];
  /** Dicas da zona ("x", "x_x"). */
  dicas: string[];
}

export function layoutsDaZona(areaId: string | null | undefined): LayoutsDaZona | null {
  if (!areaId) return null;
  const todas = INDICE.get(areaId);
  if (todas === undefined) return null;
  const pistas = todas.filter((nome) => !nome.includes("_") && nome !== "x");
  if (pistas.length === 0) return null;
  return { area_id: areaId, pistas, dicas: todas.filter((nome) => nome.startsWith("x")) };
}

/** A primeira das zonas que tem imagens. Serve pra cair na zona do passo quando a atual não tem. */
export function zonaComLayout(...candidatas: (string | null | undefined)[]): string | null {
  for (const id of candidatas) {
    if (layoutsDaZona(id) !== null) return id ?? null;
  }
  return null;
}

/** As imagens do caminho de um layout: "1" → "1_1", "1_1_1", "1_2"… */
export function caminhoDoLayout(areaId: string, pista: string): string[] {
  return (INDICE.get(areaId) ?? []).filter((nome) => nome.startsWith(`${pista}_`));
}

export function enderecoDaImagem(areaId: string, imagem: string): string {
  return `/layouts/${areaId}/${imagem}.jpg`;
}

/** A imagem que explica os símbolos (ponto de interesse, chefe, ordem sugerida…). */
export const ENDERECO_DA_LEGENDA = "/layouts/legenda.jpg";

/** O painel de layout: fechado, na grade com todas as pistas ou num layout escolhido. */
export interface PainelDeLayout {
  aberto: boolean;
  /** Zona das imagens. `null` = a zona de agora não tem imagens. */
  area_id: string | null;
  /** Posição do layout escolhido em `pistas`. `null` = a grade. */
  escolhido: number | null;
}

export const PAINEL_FECHADO: PainelDeLayout = { aberto: false, area_id: null, escolhido: null };

/** Abre o painel na zona. Zona com um layout só não precisa de grade. */
export function abrirPainel(areaId: string | null): PainelDeLayout {
  const zona = layoutsDaZona(areaId);
  if (zona === null) return { aberto: true, area_id: null, escolhido: null };
  return { aberto: true, area_id: zona.area_id, escolhido: zona.pistas.length === 1 ? 0 : null };
}

/**
 * A tecla do layout: abre na grade, passa por cada layout e fecha depois do último.
 * `areaId` é a zona de agora (só usada na hora de abrir).
 */
export function proximoNoPainel(p: PainelDeLayout, areaId: string | null): PainelDeLayout {
  if (!p.aberto) return abrirPainel(areaId);
  const zona = layoutsDaZona(p.area_id);
  if (zona === null) return PAINEL_FECHADO;
  const seguinte = p.escolhido === null ? 0 : p.escolhido + 1;
  if (seguinte >= zona.pistas.length) return PAINEL_FECHADO;
  return { ...p, escolhido: seguinte };
}

/** Clique no modo de edição: escolhe um layout, ou `null` pra voltar pra grade. */
export function escolherNoPainel(p: PainelDeLayout, posicao: number | null): PainelDeLayout {
  if (!p.aberto) return p;
  const zona = layoutsDaZona(p.area_id);
  if (zona === null) return p;
  if (posicao === null) return zona.pistas.length === 1 ? p : { ...p, escolhido: null };
  if (!Number.isInteger(posicao) || posicao < 0 || posicao >= zona.pistas.length) return p;
  return { ...p, escolhido: posicao };
}

/** A zona mudou: o painel continua aberto e recomeça na zona nova. */
export function aoMudarAZona(p: PainelDeLayout, areaId: string | null): PainelDeLayout {
  if (!p.aberto) return p;
  const zona = layoutsDaZona(areaId);
  if ((zona?.area_id ?? null) === p.area_id) return p;
  return abrirPainel(areaId);
}

export interface ImagemDoPainel {
  /** Nome da imagem ("1", "1_1", "x"). */
  nome: string;
  endereco: string;
  /** Na grade: a posição do layout que esta pista escolhe. */
  escolhe: number | null;
}

export interface VistaDoPainel {
  area_id: string;
  /** Quantos layouts a zona tem. */
  total: number;
  /** Layout escolhido (a contar de 1), ou `null` na grade. */
  atual: number | null;
  imagens: ImagemDoPainel[];
}

/** O que o painel mostra agora. `null` = fechado ou sem imagens pra zona. */
export function vistaDoPainel(p: PainelDeLayout): VistaDoPainel | null {
  if (!p.aberto) return null;
  const zona = layoutsDaZona(p.area_id);
  if (zona === null) return null;
  const imagem = (nome: string, escolhe: number | null = null): ImagemDoPainel => ({
    nome,
    endereco: enderecoDaImagem(zona.area_id, nome),
    escolhe,
  });

  const pista = p.escolhido === null ? undefined : zona.pistas[p.escolhido];
  if (pista === undefined) {
    // Na grade: as pistas e a dica geral. A dica da segunda parte ("x_x") só depois de escolher.
    return {
      area_id: zona.area_id,
      total: zona.pistas.length,
      atual: null,
      imagens: [
        ...zona.pistas.map((nome, posicao) => imagem(nome, posicao)),
        ...zona.dicas.filter((nome) => nome === "x").map((nome) => imagem(nome)),
      ],
    };
  }
  return {
    area_id: zona.area_id,
    total: zona.pistas.length,
    atual: (p.escolhido ?? 0) + 1,
    imagens: [
      imagem(pista),
      ...caminhoDoLayout(zona.area_id, pista).map((nome) => imagem(nome)),
      ...zona.dicas.map((nome) => imagem(nome)),
    ],
  };
}
