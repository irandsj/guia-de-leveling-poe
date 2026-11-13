// Onde o jogador está na rota e como o passo anda sozinho quando ele troca de zona.
//
// A rota tem "bordas": cada borda é uma troca de zona, na ordem do caminho. O passo que tem
// uma borda é o que manda trocar de zona ("➞ The Coast"). Quando o Client.txt diz que o
// jogador chegou na zona da PRÓXIMA borda, esse passo está feito e o guia pula pro seguinte.
// A regra só olha pra frente (uma borda, ou duas quando a zona não é cidade e é nova na
// rota), então andar pra trás no mapa ou visitar a cidade fora de hora não bagunça o guia.

import { Data } from "../terceiros/exile-leveling/src/data";
import "./dados-330";
import { nomeDaZona, type Rota } from "./rota";

export function limitarPasso(rota: Rota, passo: number): number {
  if (!Number.isFinite(passo)) return 0;
  return Math.min(Math.max(0, Math.trunc(passo)), Math.max(0, rota.passos.length - 1));
}

/** Em que borda o jogador está quando o passo atual é `passo`. */
export function bordaDoPasso(rota: Rota, passo: number): number {
  const atual = limitarPasso(rota, passo);
  for (let q = atual; q >= 0; q--) {
    const p = rota.passos[q];
    if (!p || p.borda === null) continue;
    // O passo atual ainda vai trocar de zona: o jogador está na borda de antes.
    return q === atual && p.termina_em_troca ? p.borda - 1 : p.borda;
  }
  return 0;
}

/** Passo em que o guia fica quando o jogador chega na zona da borda. */
function passoAoChegar(rota: Rota, borda: number): number {
  const q = rota.passo_da_borda[borda] ?? 0;
  return limitarPasso(rota, q + (rota.passos[q]?.termina_em_troca ? 1 : 0));
}

export function ehCidade(areaId: string): boolean {
  return Data.Areas[areaId]?.is_town_area === true;
}

function avancarSeBater(rota: Rota, passo: number, bate: (borda: number) => boolean, cidade: boolean): number {
  const b = bordaDoPasso(rota, passo);
  const ultima = rota.bordas.length - 1;
  if (b + 1 <= ultima && bate(b + 1)) return Math.max(passo, passoAoChegar(rota, b + 1));
  // Já está nessa zona: entrou de novo nela, nada a fazer.
  if (b >= 0 && bate(b)) return passo;
  // Uma borda passou despercebida (ou o jogador cortou caminho): aceita a seguinte.
  // Com cidade não vale, porque ir à cidade fora de hora é comum. E só vale pra zona nova:
  // voltar pra uma zona por onde a rota já passou (morreu e veio andando, esqueceu o waypoint)
  // não é atalho, mesmo que a rota vá passar por ela de novo mais adiante.
  if (!cidade && b + 2 <= ultima && bate(b + 2) && zonaNova(bate, b + 2)) {
    return Math.max(passo, passoAoChegar(rota, b + 2));
  }
  return passo;
}

/** A zona da borda aparece ali pela primeira vez na rota? */
function zonaNova(bate: (borda: number) => boolean, borda: number): boolean {
  for (let anterior = 0; anterior < borda; anterior++) {
    if (bate(anterior)) return false;
  }
  return true;
}

/**
 * O jogo gerou a zona `areaId` (linha "Generating level..."). Devolve o passo novo.
 * `anterior` é o id da zona de onde o jogador veio (pra alcançar quem saiu da ordem da rota).
 */
export function aoChegarNaZona(rota: Rota, passo: number, areaId: string, anterior: string | null = null): number {
  const novo = avancarSeBater(rota, passo, (borda) => rota.bordas[borda] === areaId, ehCidade(areaId));
  if (novo !== passo) return novo;
  return alcancar(rota, passo, areaId, anterior) ?? passo;
}

function atoDaZona(areaId: string | undefined): number | null {
  return areaId === undefined ? null : (Data.Areas[areaId]?.act ?? null);
}

/**
 * O jogador saiu da ordem da rota (fez uma parte depois, pulou uma opcional) e ficou mais de
 * duas trocas de zona à frente do guia. Sem isto o guia nunca mais andava sozinho.
 * Só pula com prova de que o jogador está lá na frente:
 * - entrou numa zona de um ATO mais adiante (não dá pra chegar lá sem ter passado pelo ato atual);
 * - ou passou por DUAS zonas seguidas da rota, as duas novas (ainda não visitadas pela rota),
 *   nessa mesma ordem, mais à frente no ato. Uma zona sozinha não basta: ir antes a uma zona
 *   opcional é comum e não quer dizer que o resto ficou pra trás.
 */
function alcancar(rota: Rota, passo: number, areaId: string, anterior: string | null): number | null {
  const b = bordaDoPasso(rota, passo);
  const atoAtual = atoDaZona(rota.bordas[Math.max(0, b)]);
  const atoDela = atoDaZona(areaId);
  if (atoAtual === null || atoDela === null) return null;

  if (atoDela > atoAtual) {
    for (let e = b + 1; e < rota.bordas.length; e++) {
      if (rota.bordas[e] === areaId) return Math.max(passo, passoAoChegar(rota, e));
    }
    return null;
  }

  if (anterior === null || anterior === areaId || ehCidade(areaId) || atoDela !== atoAtual) return null;
  const visitadas = new Set(rota.bordas.slice(0, Math.max(0, b) + 1));
  if (visitadas.has(areaId) || visitadas.has(anterior)) return null;
  for (let e = b + 2; e < rota.bordas.length; e++) {
    if (atoDaZona(rota.bordas[e]) !== atoAtual) break;
    if (rota.bordas[e] === areaId && rota.bordas[e - 1] === anterior) {
      return Math.max(passo, passoAoChegar(rota, e));
    }
  }
  return null;
}

/**
 * O jogo só disse o nome da zona ("You have entered X"): é o que aparece quando o jogador
 * volta pra uma zona que já existia. Só casa com cliente em inglês.
 */
export function aoChegarPeloNome(rota: Rota, passo: number, nome: string): number {
  return avancarSeBater(
    rota,
    passo,
    (borda) => nomeDaZona(rota.bordas[borda]) === nome,
    ehCidadePeloNome(nome),
  );
}

const NOMES_DE_CIDADE: Set<string> = new Set(
  Object.values(Data.Areas)
    .filter((a) => a.is_town_area)
    .map((a) => a.name),
);

export function ehCidadePeloNome(nome: string): boolean {
  return NOMES_DE_CIDADE.has(nome);
}

const NOMES_DE_ZONA: Set<string> = new Set(Object.values(Data.Areas).map((a) => a.name));

/** O nome é o de alguma zona dos nossos dados (que estão em inglês)? */
export function ehNomeDeZona(nome: string): boolean {
  return NOMES_DE_ZONA.has(nome);
}

/**
 * Acerta o passo pela zona em que o jogador está (tecla de ressincronizar).
 * Procura primeiro pra frente, até o fim do ato seguinte, e depois pra trás. Com o id da
 * zona (e não só o nome), procura por último no resto da campanha.
 * Devolve `null` quando a zona não está na rota.
 */
export function ressincronizar(
  rota: Rota,
  passo: number,
  onde: { id: string | null; nome: string | null },
): number | null {
  const bate = (borda: number): boolean => {
    if (onde.id !== null) return rota.bordas[borda] === onde.id;
    return onde.nome !== null && nomeDaZona(rota.bordas[borda]) === onde.nome;
  };
  if (onde.id === null && onde.nome === null) return null;

  const atual = limitarPasso(rota, passo);
  const b = bordaDoPasso(rota, atual);
  if (b >= 0 && bate(b)) return atual;

  const atoAtual = rota.passos[atual]?.ato ?? 1;
  for (let e = b + 1; e < rota.bordas.length; e++) {
    const q = rota.passo_da_borda[e];
    if ((rota.passos[q]?.ato ?? 99) > atoAtual + 1) break;
    if (bate(e)) return passoAoChegar(rota, e);
  }
  for (let e = b - 1; e >= 0; e--) {
    if (bate(e)) return passoAoChegar(rota, e);
  }
  // O id de uma zona não se repete entre os atos: se ela só existe mais adiante, o jogador
  // está mesmo lá (importou a build no meio da campanha). Só com o nome não dá pra saber,
  // porque os atos 6 a 10 repetem nomes dos atos 1 a 5.
  if (onde.id !== null) {
    for (let e = b + 1; e < rota.bordas.length; e++) {
      if (bate(e)) return passoAoChegar(rota, e);
    }
  }
  return null;
}

/** Faixa de nível com que se costuma passar por cada ato. */
const FAIXA_DO_ATO: Record<number, [number, number]> = {
  1: [1, 12],
  2: [12, 22],
  3: [22, 32],
  4: [32, 40],
  5: [40, 45],
  6: [45, 50],
  7: [50, 55],
  8: [55, 60],
  9: [60, 64],
  10: [64, 68],
};

/** Chute do nível do personagem pelo passo da rota. Vale só até o jogo dizer o nível de verdade. */
export function nivelEstimado(rota: Rota, passo: number): number {
  const atual = rota.passos[limitarPasso(rota, passo)];
  if (!atual) return 1;
  const [piso, teto] = FAIXA_DO_ATO[atual.ato] ?? [1, 68];
  for (let q = atual.indice; q >= 0 && rota.passos[q].ato === atual.ato; q--) {
    const area = Data.Areas[rota.passos[q].zona];
    if (!area || area.is_town_area) continue;
    return Math.min(teto, Math.max(piso, area.level - 2));
  }
  return piso;
}

/** Primeiro passo do ato (ou do ato mais perto que existir na rota). */
export function inicioDoAto(rota: Rota, ato: number): number {
  return rota.inicio_do_ato[ato] ?? 0;
}
