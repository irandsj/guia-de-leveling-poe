// A ascendência e o panteão da build, pro balão mostrar (em roxo) com a árvore de passivas aberta.
//
// A ascendência sai das árvores do PoB: cada etapa que traz nós de ascendência novos vira um grupo,
// e os pontos somados até ali dizem de qual lab é (2 pontos por lab). Dentro do grupo, os nós vão
// na ordem do caminho (o mais perto do início primeiro).

import { TIPO, type ArvoreDoJogo } from "./arvore/dados";
import type { Plano } from "./plano";

/** O jogo dá 2 pontos de ascendência por lab, em 4 labs. */
const PONTOS_POR_LAB = 2;
const NOMES_DOS_LABS = ["normal", "cruel", "merciless", "eternal"];
/** Nível da área de cada lab: dá pra fazer a partir daí (o eternal pede mapas, mas a área é 75). */
const NIVEL_DOS_LABS = [33, 55, 68, 75];

export interface NoDoLab {
  nome: string;
  notavel: boolean;
}

export interface LabDaBuild {
  /** "Lab 1 (normal)", "Labs 2 e 3 (cruel e merciless)". */
  rotulo: string;
  /** A etapa do PoB onde os nós aparecem ("Level 48"). */
  etapa: string;
  /** Os labs do grupo, de 1 a 4. */
  primeiro: number;
  ultimo: number;
  nos: NoDoLab[];
}

export interface AscendenciaDaBuild {
  /** Nome da ascendência ("Pathfinder"), se a build tem. */
  nome: string | null;
  labs: LabDaBuild[];
  /** "Soul of the Brine King". */
  panteao: { maior: string | null; menor: string | null };
}

function rotuloDosLabs(primeiro: number, ultimo: number): string {
  const nome = (lab: number) => NOMES_DOS_LABS[lab - 1] ?? "";
  if (ultimo <= primeiro) return `Lab ${primeiro}${nome(primeiro) ? ` (${nome(primeiro)})` : ""}`;
  const numeros = Array.from({ length: ultimo - primeiro + 1 }, (_, i) => primeiro + i);
  const juntar = (lista: string[]) => `${lista.slice(0, -1).join(", ")} e ${lista[lista.length - 1]}`;
  const nomes = numeros.map(nome).filter((n) => n !== "");
  return `Labs ${juntar(numeros.map(String))}${nomes.length === numeros.length ? ` (${juntar(nomes)})` : ""}`;
}

/** Os nós de ascendência de cada lab, na ordem em que as árvores do PoB pegam. */
export function labsDaBuild(plano: Plano, arvore: ArvoreDoJogo): { nome: string | null; labs: LabDaBuild[] } {
  const vistos = new Set<number>();
  const labs: LabDaBuild[] = [];
  let nome: string | null = plano.personagem.ascendencia;
  let pontos = 0;
  for (const etapa of plano.arvore.etapas) {
    const novos = [];
    for (const id of etapa.nos) {
      const no = arvore.nosDeAscendencia.get(id);
      if (!no || vistos.has(id)) continue;
      vistos.add(id);
      nome ??= no.dona;
      if (no.tipo !== TIPO.INICIO_DE_ASCENDENCIA) novos.push(no);
    }
    if (novos.length === 0) continue;
    novos.sort((a, b) => a.distancia - b.distancia || Number(a.tipo === TIPO.NOTAVEL) - Number(b.tipo === TIPO.NOTAVEL));
    const primeiro = Math.floor(pontos / PONTOS_POR_LAB) + 1;
    pontos += novos.length;
    const ultimo = Math.max(primeiro, Math.ceil(pontos / PONTOS_POR_LAB));
    labs.push({
      rotulo: rotuloDosLabs(primeiro, ultimo),
      etapa: etapa.titulo,
      primeiro,
      ultimo,
      nos: novos.map((no) => ({ nome: no.nome, notavel: no.tipo === TIPO.NOTAVEL })),
    });
  }
  return { nome, labs };
}

/** Os nomes do jogo pros deuses do panteão, pelo id do PoB. */
const DEUSES: Record<string, string> = {
  TheBrineKing: "the Brine King",
};

/** "TheBrineKing" → "Soul of the Brine King"; "Ryslatha" → "Soul of Ryslatha". */
export function nomeDoDeus(id: string | null): string | null {
  const limpo = id?.trim() ?? "";
  if (limpo === "" || limpo.toLowerCase() === "none") return null;
  const nome = DEUSES[limpo] ?? limpo.replace(/([a-z])([A-Z])/g, "$1 $2");
  return `Soul of ${nome}`;
}

export function ascendenciaDaBuild(plano: Plano, arvore: ArvoreDoJogo | null): AscendenciaDaBuild {
  const { nome, labs } = arvore ? labsDaBuild(plano, arvore) : { nome: plano.personagem.ascendencia, labs: [] };
  return {
    nome,
    labs,
    panteao: { maior: nomeDoDeus(plano.personagem.panteao.maior), menor: nomeDoDeus(plano.personagem.panteao.menor) },
  };
}

/** O lab mais difícil que o nível já deixa fazer (0 antes do normal). */
export function labDoNivel(nivel: number): number {
  return NIVEL_DOS_LABS.filter((minimo) => nivel >= minimo).length;
}

/** O grupo do lab que o nível já deixa fazer, pra ficar em destaque (-1 se nenhum). */
export function labDeAgora(labs: readonly LabDaBuild[], nivel: number): number {
  const lab = labDoNivel(nivel);
  return lab === 0 ? -1 : labs.findIndex((grupo) => grupo.primeiro <= lab && lab <= grupo.ultimo);
}

/** Tem algo pra mostrar. */
export function temAscendencia(a: AscendenciaDaBuild): boolean {
  return a.labs.length > 0 || a.panteao.maior !== null || a.panteao.menor !== null;
}
