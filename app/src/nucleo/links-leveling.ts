// Links pro leveling quando o PoB só traz conjuntos de endgame.
//
// Muito PoB não tem conjunto "Act 1-2" / "Level 12": só "Low Budget End-Game", "Mirror Tier"...
// Durante a campanha, mostrar o 6L do endgame não ajuda (a gema principal nem existe ainda no
// nível 5). Aqui o guia monta, a partir do próprio conjunto de endgame, o que dá pra ligar AGORA:
// em cada grupo, só as gemas que o nível já permite usar, até o número de links que um item da
// campanha costuma ter.

import { NIVEL_DE_MAPAS, type EtapaDeGemas, type GemaDoPlano } from "./plano";

/** A etapa vale pra campanha (tem rótulo de nível/ato abaixo dos mapas)? */
export function ehConjuntoDeLeveling(etapa: EtapaDeGemas): boolean {
  return etapa.estimativa !== null && etapa.estimativa < NIVEL_DE_MAPAS;
}

/**
 * Deve trocar o conjunto de endgame pelos links do leveling? Só durante a campanha, quando o
 * conjunto da vez não é de leveling e o jogador não fixou um à mão.
 */
export function usarLinksDoLeveling(etapa: EtapaDeGemas | null, nivel: number, automatica: boolean): boolean {
  return etapa !== null && automatica && nivel < NIVEL_DE_MAPAS && !ehConjuntoDeLeveling(etapa);
}

/** Quantos links um item da campanha costuma ter nesse nível. */
export function linksNoNivel(nivel: number): number {
  return nivel < 12 ? 3 : 4;
}

export interface LinkDoLeveling {
  /** A habilidade (gema ativa) que puxa o link. */
  habilidade: GemaDoPlano;
  suportes: GemaDoPlano[];
  /** O grupo do endgame de onde o link saiu é o principal da build. */
  principal: boolean;
  /**
   * Link que segura o lugar da habilidade principal enquanto ela não existe ainda
   * (Raise Zombie com os suportes de minion até o Raise Spectre do nível 28).
   */
  ate: { nome: string; nivel: number } | null;
}

export interface LinksDoLeveling {
  /** Links de 2 gemas ou mais, o principal primeiro. */
  links: LinkDoLeveling[];
  /** Gemas ativas soltas (aura, maldição, movimento) que já dá pra usar. */
  soltas: GemaDoPlano[];
}

function pode(gema: GemaDoPlano, nivel: number): boolean {
  return gema.conhecida && gema.nivel_req !== null && gema.nivel_req <= nivel;
}

const RE_MINION_ATIVA = /^(Raise|Summon|Animate) /;
const RE_MINION_SUPORTE =
  /^(Minion (Damage|Life|Speed)|Feeding Frenzy|Elemental Army|Meat Shield|Predator|Infernal Legion|Summon Phantasm) Support$/;

/**
 * Build de minion cuja habilidade principal ainda não chegou: o primeiro minion que já existe no
 * conjunto segura o lugar, com os suportes de minion do conjunto que o nível já permite.
 * Só pra minion: pros outros tipos, sem as tags das gemas, não dá pra saber o que combina.
 */
function linkSubstituto(etapa: EtapaDeGemas, nivel: number, maximo: number): LinkDoLeveling | null {
  const principal = etapa.grupos.find((g) => g.principal);
  const alvo = principal?.gemas.find((g) => !g.suporte);
  if (!principal || !alvo || alvo.nivel_req === null || pode(alvo, nivel)) return null;
  if (!RE_MINION_ATIVA.test(alvo.nome)) return null;
  const todas = [...principal.gemas, ...etapa.grupos.filter((g) => g !== principal).flatMap((g) => g.gemas)];
  const habilidade = todas.find((g) => !g.suporte && RE_MINION_ATIVA.test(g.nome) && pode(g, nivel));
  if (!habilidade) return null;
  const suportes: GemaDoPlano[] = [];
  for (const g of todas) {
    if (suportes.length >= maximo - 1) break;
    if (g.suporte && RE_MINION_SUPORTE.test(g.nome) && pode(g, nivel) && !suportes.some((s) => s.nome === g.nome)) {
      suportes.push(g);
    }
  }
  return { habilidade, suportes, principal: true, ate: { nome: alvo.nome, nivel: alvo.nivel_req } };
}

/** O que do conjunto de endgame já dá pra ligar neste nível. */
export function linksDoLeveling(etapa: EtapaDeGemas, nivel: number): LinksDoLeveling {
  const maximo = linksNoNivel(nivel);
  const links: LinkDoLeveling[] = [];
  const soltas: GemaDoPlano[] = [];
  const vistas = new Set<string>();
  const substituto = linkSubstituto(etapa, nivel, maximo);
  const usadas = new Set<string>();
  if (substituto) {
    links.push(substituto);
    usadas.add(substituto.habilidade.nome);
  }
  for (const grupo of etapa.grupos) {
    const ativas = grupo.gemas.filter((g) => !g.suporte && pode(g, nivel));
    if (ativas.length === 0) continue;
    // "Pick 1 Golem": num grupo com várias ativas, a primeira puxa o link.
    // As outras ativas do grupo (Frostblink junto do Shield Charge) ficam como soltas.
    const [habilidade, ...outras] = ativas;
    for (const outra of outras) if (!soltas.some((s) => s.nome === outra.nome)) soltas.push(outra);
    // O minion que já segura o lugar da principal não puxa um segundo link.
    if (usadas.has(habilidade.nome)) continue;
    const suportes = grupo.gemas.filter((g) => g.suporte && pode(g, nivel)).slice(0, maximo - 1);
    const chave = `${habilidade.nome}|${suportes.map((s) => s.nome).join("+")}`;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    if (suportes.length === 0) {
      if (!soltas.some((s) => s.nome === habilidade.nome)) soltas.push(habilidade);
      continue;
    }
    links.push({ habilidade, suportes, principal: grupo.principal, ate: null });
  }
  links.sort((a, b) => Number(b.principal) - Number(a.principal) || b.suportes.length - a.suportes.length);
  // A habilidade que puxa um link não aparece de novo como solta.
  const nosLinks = new Set(links.map((l) => l.habilidade.nome));
  return { links, soltas: soltas.filter((s) => !nosLinks.has(s.nome)) };
}

export interface ProximaMudanca {
  nivel: number;
  /** Gemas que entram nos links nesse nível. */
  gemas: string[];
}

function nomesEmUso(l: LinksDoLeveling): Set<string> {
  const nomes = new Set<string>();
  for (const link of l.links) {
    nomes.add(link.habilidade.nome);
    for (const s of link.suportes) nomes.add(s.nome);
  }
  for (const s of l.soltas) nomes.add(s.nome);
  return nomes;
}

/** O próximo nível em que os links mudam, e o que entra. */
export function proximaMudanca(etapa: EtapaDeGemas, nivel: number): ProximaMudanca | null {
  const agora = nomesEmUso(linksDoLeveling(etapa, nivel));
  for (let n = nivel + 1; n < NIVEL_DE_MAPAS; n++) {
    const novas = [...nomesEmUso(linksDoLeveling(etapa, n))].filter((nome) => !agora.has(nome));
    if (novas.length > 0) return { nivel: n, gemas: novas };
  }
  return null;
}
