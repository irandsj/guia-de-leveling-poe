// Quais gemas a leitura de tela procura agora: as que a build ainda vai pegar ou comprar
// neste ato, do passo atual pra frente, e só com o personagem na cidade (é lá que ficam as
// janelas de recompensa e as lojas).
//
// Gema marcada como comprada/pega fica de fora. Gema de loja de uma parada que já passou e
// que o jogador não marcou continua piscando (vem primeiro: é a que ele esqueceu). Recompensa
// de quest que já passou fica de fora: a recompensa já foi escolhida.

import { ehCidade } from "./avanco";
import type { Rota } from "./rota";
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

/** Muda quando a lista muda (pra não mandar a mesma lista de novo ao programa). */
export function chaveDosAlvos(alvos: AlvoDeGema[]): string {
  return alvos.map((a) => `${a.tipo}:${a.gem_id}`).join("|");
}
