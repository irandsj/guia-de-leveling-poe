// Escolhe a etapa da vez (gemas, árvore e itens) pelo nível do personagem e pelo ato da rota.
// É aqui que acontece a "troca de conjunto" quando o personagem chega no nível do próximo.
// A árvore manda na fase: quando ela vira de etapa, gemas e itens viram junto (`faseDaArvore`).
// Cada PoB rotula de um jeito (um conjunto só, faixas "1-11"/"11-60", pontos "12"/"50", atos,
// misturas): `trechosDeNivel` e `escolherEtapa` cobrem as formas.

import { lerRotulo, NIVEL_DE_MAPAS, NIVEL_DO_ATO } from "./plano";
import type { DicaDeItem, EtapaBase, EtapaDeArvore, EtapaDeGemas, EtapaDeItens, Plano } from "./plano";

export interface Situacao {
  nivel: number;
  ato: number;
}

type ComGatilho = EtapaBase & { nivel_gatilho?: number | null };

function temGatilho(etapa: EtapaBase): boolean {
  return etapa.nivel_min !== null || etapa.ato_min !== null;
}

/** O personagem já chegou na etapa? */
export function chegouNaEtapa(etapa: ComGatilho, s: Situacao): boolean {
  if (!temGatilho(etapa)) return false;
  if (etapa.nivel_min !== null && s.nivel < etapa.nivel_min) return false;
  if (etapa.ato_min !== null && s.ato < etapa.ato_min) return false;
  if (etapa.nivel_gatilho != null && s.nivel < etapa.nivel_gatilho) return false;
  return true;
}

/** Etapa da campanha (antes dos mapas), com rótulo de nível ou de ato. */
function daCampanha(etapa: EtapaBase): boolean {
  return temGatilho(etapa) && etapa.estimativa !== null && etapa.estimativa < NIVEL_DE_MAPAS;
}

/**
 * Regra geral: entre as etapas em que o personagem já chegou, vale a mais adiantada.
 * Se ainda não chegou em nenhuma: a "inicial"; sem ela, a primeira da campanha com rótulo;
 * sem nenhuma da campanha, a que estava ativa no PoB (é dela que saem as gemas da rota).
 */
export function escolherEtapa<T extends ComGatilho>(
  etapas: T[],
  s: Situacao,
  ativaNoPob: string | null,
): T | null {
  let melhor: T | null = null;
  for (const etapa of etapas) {
    if (!chegouNaEtapa(etapa, s)) continue;
    if (melhor === null || (etapa.estimativa ?? 0) >= (melhor.estimativa ?? 0)) melhor = etapa;
  }
  if (melhor) return melhor;

  const inicial = etapas.find((e) => e.inicial);
  if (inicial) return inicial;

  let primeira: T | null = null;
  for (const etapa of etapas) {
    if (!daCampanha(etapa)) continue;
    if (primeira === null || (etapa.estimativa ?? 0) < (primeira.estimativa ?? 0)) primeira = etapa;
  }
  if (primeira) return primeira;

  return etapas.find((e) => e.id === ativaNoPob) ?? etapas[0] ?? null;
}

interface Trecho<T> {
  etapa: T;
  /** A etapa vale até este nível: no nível dela já é a vez da seguinte. */
  fim: number;
}

/**
 * A lista lida como a árvore: cada etapa vale ATÉ o fim dela, e no fim já entra a seguinte.
 * Faixa ("Level 1 - 11", "11-60") acaba no fim da faixa; nível solto ("Level 26", "26", "82+") é
 * como a build deve estar NAQUELE nível, então acaba nele. Cobre um conjunto só, duas faixas,
 * vários pontos ("12", "50", "72") e misturas ("Level 1 - 11", "Level 60").
 * `null` = alguma etapa tem ato, lab, mapas ou "Leveling" no título, ou há etapa inicial sem
 * rótulo, ou a lista começa num nível solto "Level 1" (que só pode ser "a partir do nível 1"):
 * aí vale a regra "a partir de" de `escolherEtapa`.
 */
function trechosDeNivel<T extends EtapaBase>(etapas: T[]): Trecho<T>[] | null {
  if (etapas.some((e) => e.inicial)) return null;
  const trechos: Trecho<T>[] = [];
  for (const etapa of etapas) {
    if (!temGatilho(etapa)) continue;
    if (etapa.nivel_min === null || etapa.ato_min !== null) return null;
    if (etapa.nivel_max !== null) trechos.push({ etapa, fim: etapa.nivel_max });
    else if (lerRotulo(etapa.titulo).ponto) trechos.push({ etapa, fim: etapa.nivel_min });
    else return null;
  }
  if (trechos.length === 0) return null;
  // (`sort` mantém a ordem do PoB entre as que acabam no mesmo nível.)
  trechos.sort((a, b) => a.fim - b.fim || (a.etapa.nivel_min ?? 0) - (b.etapa.nivel_min ?? 0));
  return trechos[0].fim > 1 ? trechos : null;
}

/** A primeira etapa cujo fim a fase ainda não alcançou; passou de todas, a última. */
function escolherTrecho<T extends EtapaBase>(trechos: Trecho<T>[], nivel: number): T {
  return (trechos.find((t) => nivel < t.fim) ?? trechos[trechos.length - 1]).etapa;
}

/** A etapa que vem depois de `etapa`, e o nível em que ela entra (o fim de `etapa`). */
function trechoSeguinte<T extends EtapaBase>(
  trechos: Trecho<T>[],
  etapa: T | null,
): { proxima: T | null; entra: number | null } {
  const i = trechos.findIndex((t) => t.etapa === etapa);
  if (i < 0 || i + 1 >= trechos.length) return { proxima: null, entra: null };
  return { proxima: trechos[i + 1].etapa, entra: trechos[i].fim };
}

/**
 * A fase da build. A árvore manda: quando ela vira de etapa (porque o personagem chegou no nível ou
 * no ato, ou porque a etapa ficou pronta antes, o `minimo`), gemas e itens viram junto. É a situação
 * do personagem, levada até o fim da etapa da árvore que acabou de ficar pra trás: "Level 12" leva o
 * nível a 12; "Act 3" leva o ato a 4 (a árvore "Act 3" é a do fim do ato 3).
 */
export function faseDaArvore(plano: Plano, s: Situacao, minimo = 0): Situacao {
  const comGatilho = etapasDaArvore(plano);
  const alvo = arvoreAlvo(plano, s, minimo);
  const indice = alvo ? comGatilho.indexOf(alvo) : -1;
  const anterior = indice > 0 ? comGatilho[indice - 1] : null;
  if (anterior?.nivel_min != null) {
    return { nivel: Math.max(s.nivel, anterior.nivel_max ?? anterior.nivel_min), ato: s.ato };
  }
  if (anterior?.ato_min != null) {
    return { nivel: s.nivel, ato: Math.max(s.ato, Math.min((anterior.ato_max ?? anterior.ato_min) + 1, 10)) };
  }
  return s;
}

export interface EscolhaDeGemas {
  etapa: EtapaDeGemas | null;
  /** `false` quando o jogador fixou um conjunto à mão. */
  automatica: boolean;
  /** A próxima etapa que vai entrar sozinha, pra avisar antes. */
  proxima: EtapaDeGemas | null;
  /** Nível em que a próxima entra ("Level 26" entra no nível 12; "Level 11 - 60", no 11). */
  entra: number | null;
}

/**
 * O conjunto de gemas da vez. `manual` é o id de uma etapa fixada pelo jogador. `minimo` é o da
 * árvore (ver `arvoreAlvo`): o conjunto vira junto com a árvore.
 */
export function etapaDeGemas(plano: Plano, s: Situacao, manual: string | null, minimo = 0): EscolhaDeGemas {
  const etapas = plano.gemas.etapas;
  const fixada = manual ? etapas.find((e) => e.id === manual) : undefined;
  const fase = faseDaArvore(plano, s, minimo);

  const trechos = trechosDeNivel(etapas);
  if (trechos) {
    const etapa = fixada ?? escolherTrecho(trechos, fase.nivel);
    return { etapa, automatica: fixada === undefined, ...trechoSeguinte(trechos, etapa) };
  }

  const automatica = escolherEtapa(etapas, fase, plano.gemas.ativa_no_pob);
  const etapa = fixada ?? automatica;
  let proxima: EtapaDeGemas | null = null;
  for (const candidata of etapas) {
    if (candidata === etapa || !temGatilho(candidata) || chegouNaEtapa(candidata, fase)) continue;
    if ((candidata.estimativa ?? 0) < (etapa?.estimativa ?? 0)) continue;
    if (proxima === null || (candidata.estimativa ?? 0) < (proxima.estimativa ?? 0)) proxima = candidata;
  }
  return { etapa, automatica: fixada === undefined, proxima, entra: null };
}

/** Um conjunto de gemas e o nível em que o guia passa a mostrar ele (`null`: nunca entra sozinho). */
export interface ConjuntoNaOrdem {
  etapa: EtapaDeGemas;
  nivel: number | null;
}

/** Nível mais alto que a ordem dos conjuntos percorre. */
const NIVEL_MAXIMO = 100;

/** O ato em que se costuma estar em cada nível (o contrário de `NIVEL_DO_ATO`). */
function atoDoNivel(nivel: number): number {
  let ato = 1;
  for (const [numero, piso] of Object.entries(NIVEL_DO_ATO)) {
    if (nivel >= piso) ato = Math.max(ato, Number(numero));
  }
  return ato;
}

/**
 * Os conjuntos de gemas na ordem em que o guia passa por eles: o nível sobe de 1 a 100 (o ato junto,
 * pelo nível de costume de cada ato) e cada conjunto novo que `etapaDeGemas` escolhe entra na lista,
 * com o nível em que entrou. Os que nunca entram sozinhos (Ubers, sem nível) vão no fim, na ordem
 * do PoB. É por esta lista que as setas do bloco "próximo conjunto" do balão andam.
 */
export function conjuntosEmOrdem(plano: Plano): ConjuntoNaOrdem[] {
  const ordem: ConjuntoNaOrdem[] = [];
  for (let nivel = 1; nivel <= NIVEL_MAXIMO; nivel++) {
    const etapa = etapaDeGemas(plano, { nivel, ato: atoDoNivel(nivel) }, null).etapa;
    if (etapa && !ordem.some((c) => c.etapa === etapa)) ordem.push({ etapa, nivel });
  }
  for (const etapa of plano.gemas.etapas) {
    if (!ordem.some((c) => c.etapa === etapa)) ordem.push({ etapa, nivel: null });
  }
  return ordem;
}

/**
 * A árvore a seguir agora. Os títulos dizem como a árvore deve estar NAQUELE ponto
 * ("Level 22" = no nível 22; "Act 3" = no fim do ato 3), então o alvo é a etapa seguinte
 * à última que o personagem já passou. Título de faixa ("Level 1-12", "Act 1-2") vale até o fim
 * da faixa: a etapa só fica pra trás no nível 12, ou depois do ato 2.
 * `minimo` (posição em `etapasDaArvore`) pula as etapas que o jogador já completou antes do nível
 * delas: o jogo não acaba quando a árvore da etapa fica pronta.
 * `escolhida` (posição em `etapasDaArvore`) é a etapa que o jogador pôs na mão, pelas setas ou pela
 * lista do balão (pra voltar e ver a maestria que ficou pra trás, por exemplo).
 */
export function arvoreAlvo(
  plano: Plano,
  s: Situacao,
  minimo = 0,
  escolhida: number | null = null,
): EtapaDeArvore | null {
  const etapas = plano.arvore.etapas;
  const comGatilho = etapasDaArvore(plano);
  if (comGatilho.length === 0) {
    return etapas.find((e) => e.id === plano.arvore.ativa_no_pob) ?? etapas[0] ?? null;
  }
  if (escolhida !== null && escolhida >= 0 && escolhida < comGatilho.length) return comGatilho[escolhida];
  const passou = (e: EtapaDeArvore) =>
    e.nivel_min !== null
      ? s.nivel >= (e.nivel_max ?? e.nivel_min)
      : e.ato_min !== null && s.ato > (e.ato_max ?? e.ato_min);
  let alvo = 0;
  comGatilho.forEach((e, i) => {
    if (passou(e)) alvo = i + 1;
  });
  return comGatilho[Math.min(Math.max(alvo, minimo), comGatilho.length - 1)];
}

/** As etapas da árvore que têm nível ou ato, na ordem do PoB (é delas que o alvo sai). */
export function etapasDaArvore(plano: Plano): EtapaDeArvore[] {
  return plano.arvore.etapas.filter(temGatilho);
}

/**
 * A árvore da etapa alvo ficou pronta: o `minimo` novo, pra o guia seguir pra próxima etapa.
 * `null` quando não há próxima (era a última, ou o PoB não separa a árvore em etapas).
 */
export function arvoreDepoisDe(plano: Plano, alvo: EtapaDeArvore): number | null {
  const comGatilho = etapasDaArvore(plano);
  const indice = comGatilho.indexOf(alvo);
  return indice >= 0 && indice + 1 < comGatilho.length ? indice + 1 : null;
}

export interface EscolhaDeItens {
  etapa: EtapaDeItens | null;
  /** O conjunto que vem depois, pra avisar antes. */
  proxima: EtapaDeItens | null;
  /** Nível em que o próximo entra ("50" entra no nível 12). */
  entra: number | null;
}

/**
 * O conjunto de itens da vez. Vira junto com a árvore (`minimo`, ver `arvoreAlvo`).
 * PoB que não separa os itens por nível nem ato (um conjunto só, ou só "Default"): vale o
 * primeiro conjunto que não é de fim de jogo; sem ele, o primeiro. É o que a build tem pra mostrar.
 */
export function itensDaFase(plano: Plano, s: Situacao, minimo = 0): EscolhaDeItens {
  // O "Early Game" antes do "Act 5" não tem rótulo, mas é o conjunto do começo (`inicial`).
  const etapas = plano.itens.etapas.filter((e) => temGatilho(e) || e.inicial);
  if (etapas.length === 0) {
    const todas = plano.itens.etapas;
    return { etapa: todas.find((e) => !e.fim_de_jogo) ?? todas[0] ?? null, proxima: null, entra: null };
  }
  const fase = faseDaArvore(plano, s, minimo);

  const trechos = trechosDeNivel(etapas);
  if (trechos) {
    const etapa = escolherTrecho(trechos, fase.nivel);
    return { etapa, ...trechoSeguinte(trechos, etapa) };
  }

  const escolhida = escolherEtapa(etapas, fase, null);
  // Conjunto que só vale nos mapas não é "o item da vez" durante a campanha.
  const etapa =
    escolhida && (escolhida.inicial || chegouNaEtapa(escolhida, fase) || daCampanha(escolhida)) ? escolhida : null;
  let proxima: EtapaDeItens | null = null;
  for (const candidata of etapas) {
    if (candidata === etapa || chegouNaEtapa(candidata, fase)) continue;
    if ((candidata.estimativa ?? 0) < (etapa?.estimativa ?? 0)) continue;
    if (proxima === null || (candidata.estimativa ?? 0) < (proxima.estimativa ?? 0)) proxima = candidata;
  }
  return { etapa, proxima, entra: null };
}

/**
 * A etapa da vez numa lista qualquer de etapas com rótulo (as buscas que o autor deixou nas notas
 * pra cada nível, por exemplo), pela mesma regra dos itens: vira junto com a árvore. `null` quando
 * nenhuma tem nível nem ato, ou quando as que têm só valem mais adiante (nos mapas).
 */
export function etapaDaFase<T extends EtapaBase>(plano: Plano, etapas: T[], s: Situacao, minimo = 0): T | null {
  const comGatilho = etapas.filter(temGatilho);
  if (comGatilho.length === 0) return null;
  const fase = faseDaArvore(plano, s, minimo);
  const trechos = trechosDeNivel(comGatilho);
  if (trechos) return escolherTrecho(trechos, fase.nivel);
  const escolhida = escolherEtapa(comGatilho, fase, null);
  return escolhida && (chegouNaEtapa(escolhida, fase) || daCampanha(escolhida)) ? escolhida : null;
}

/** Só o conjunto de itens da vez (ver `itensDaFase`). */
export function etapaDeItens(plano: Plano, s: Situacao, minimo = 0): EtapaDeItens | null {
  return itensDaFase(plano, s, minimo).etapa;
}

/** As receitas que fazem sentido no ato atual. */
export function dicasDoAto(plano: Plano, ato: number): DicaDeItem[] {
  return plano.itens.dicas.filter((d) => ato >= d.ato_min && ato <= d.ato_max);
}
