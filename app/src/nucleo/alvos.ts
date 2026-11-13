// Quais gemas a leitura de tela procura agora: as que a build ainda vai pegar ou comprar
// neste ato, do passo atual pra frente, e só com o personagem na cidade (é lá que ficam as
// janelas de recompensa e as lojas).
//
// Gema marcada como comprada/pega fica de fora. Gema de loja de uma parada que já passou e
// que o jogador não marcou continua piscando (vem primeiro: é a que ele esqueceu). Recompensa
// de quest que já passou fica de fora: a recompensa já foi escolhida.

import { ehCidade } from "./avanco";
import type { GemaDoPasso, Rota } from "./rota";
import { chaveDaMarca, comprasQueFicaram, gemasDoAto } from "./vista";

/** O programa procura no máximo este tanto de gemas de uma vez (igual ao lado Rust). */
export const MAXIMO_DE_ALVOS = 12;

export interface AlvoDeGema {
  gem_id: string;
  /** "quest": janela de recompensa. "vendedor": loja. O ícone tem tamanho diferente em cada uma. */
  tipo: "quest" | "vendedor";
  /** Endereço do ícone dentro do app. */
  icone: string;
}

/** `Metadata/Items/Gems/SkillGemFireball` → `/gemas/SkillGemFireball.webp`. */
export function enderecoDoIcone(gemId: string): string {
  return `/gemas/${gemId.split("/").pop() ?? gemId}.webp`;
}

export function alvosDaTela(
  rota: Rota | null,
  passo: number,
  zonaId: string | null,
  ligado: boolean,
  marcadas: readonly string[] = [],
): AlvoDeGema[] {
  if (!ligado || !rota || !zonaId || !ehCidade(zonaId)) return [];
  const alvos: AlvoDeGema[] = [];
  const vistos = new Set<string>(marcadas);
  // A parada mais próxima primeiro, depois as compras esquecidas, depois o resto do ato.
  const [primeira, ...depois] = gemasDoAto(rota, passo);
  const ordem = [
    ...(primeira?.gemas ?? []),
    ...comprasQueFicaram(rota, passo, marcadas),
    ...depois.flatMap((doPasso) => doPasso.gemas),
  ];
  for (const gema of ordem) {
    const chave = chaveDaMarca(gema);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    alvos.push({ gem_id: gema.gem_id, tipo: gema.tipo, icone: enderecoDoIcone(gema.gem_id) });
    if (alvos.length >= MAXIMO_DE_ALVOS) return alvos;
  }
  return alvos;
}

/** As gemas da rota, sem repetir: o programa confere o inventário com todas elas. */
export function gemasDaBuild(rota: Rota | null): string[] {
  if (!rota) return [];
  return [...new Set(rota.passos.flatMap((p) => p.gemas.map((g) => g.gem_id)))];
}

/** O que a leitura de tela viu no inventário (evento "gema-na-mochila"). */
export interface GemaVistaNaMochila {
  gem_id: string;
  /** A janela aberta na hora: loja ("vendedor") ou recompensa ("quest"). `null`: nenhuma. */
  tipo: "quest" | "vendedor" | null;
  /** Quantas cópias dela o inventário tem agora. */
  quantas: number;
}

/**
 * Qual marca a gema vista no inventário vira: uma gema dela na rota, do começo até o fim do ato
 * atual, que ainda não foi marcada (a do tipo da janela aberta, senão a primeira). `null` quando
 * não tem o que marcar: a gema já tem tantas marcas quantas cópias no inventário, ou o jogador
 * desmarcou ela na mão (aí, só na mão).
 */
export function marcaDaMochila(
  rota: Rota | null,
  passo: number,
  marcadas: readonly string[],
  desmarcadas: readonly string[],
  vista: GemaVistaNaMochila,
): string | null {
  if (!rota || rota.passos.length === 0) return null;
  const chaves = (["quest", "vendedor"] as const).map((tipo) => chaveDaMarca({ tipo, gem_id: vista.gem_id }));
  if (chaves.some((c) => desmarcadas.includes(c))) return null;
  if (chaves.filter((c) => marcadas.includes(c)).length >= vista.quantas) return null;
  const atual = Math.min(Math.max(passo, 0), rota.passos.length - 1);
  const ato = rota.passos[atual].ato;
  const livres: GemaDoPasso[] = [];
  for (let q = 0; q < rota.passos.length && (q <= atual || rota.passos[q].ato === ato); q++) {
    for (const gema of rota.passos[q].gemas) {
      if (gema.gem_id === vista.gem_id && !marcadas.includes(chaveDaMarca(gema))) livres.push(gema);
    }
  }
  const escolhida = livres.find((g) => g.tipo === vista.tipo) ?? livres[0];
  return escolhida ? chaveDaMarca(escolhida) : null;
}

/** Muda quando a lista muda (pra não mandar a mesma lista de novo ao programa). */
export function chaveDosAlvos(alvos: AlvoDeGema[]): string {
  return alvos.map((a) => `${a.tipo}:${a.gem_id}`).join("|");
}
