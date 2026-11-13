// Quantos pontos de passiva o personagem deve ter num certo nível e ato. É só uma estimativa pro texto
// do painel, usada enquanto o guia ainda não viu a árvore do jogo na tela.

/**
 * Pontos de missão ganhos até CHEGAR em cada ato (índice = ato, de 1 a 11; 11 = depois da campanha).
 * Fonte: Path of Building, `src/Modules/Build.lua`, tabela `questPoints` (licença MIT).
 * Não conta o ponto dos bandidos: só ganha quem mata os três, e o guia não sabe.
 */
export const PONTOS_DE_MISSAO_ATE_O_ATO: readonly number[] = [0, 0, 2, 4, 6, 7, 9, 12, 15, 18, 20, 23];

/** Último ato da tabela (11 = campanha terminada). */
const ULTIMO_ATO = PONTOS_DE_MISSAO_ATE_O_ATO.length - 1;

/** Nível máximo do jogo. */
const NIVEL_MAXIMO = 100;

function inteiroEntre(valor: number, minimo: number, maximo: number): number {
  if (!Number.isFinite(valor)) return minimo;
  return Math.min(maximo, Math.max(minimo, Math.floor(valor)));
}

/** Pontos de passiva que o personagem deve ter ganhado: um por nível depois do 1, mais os das missões. */
export function pontosAte(nivel: number, ato: number): number {
  const n = inteiroEntre(nivel, 1, NIVEL_MAXIMO);
  const a = inteiroEntre(ato, 1, ULTIMO_ATO);
  return n - 1 + (PONTOS_DE_MISSAO_ATE_O_ATO[a] ?? 0);
}

/**
 * Quantos passos do trecho do alvo o painel supõe feitos antes de ver a árvore do jogo:
 * a pessoa gastou os pontos que tem seguindo a ordem, sem passar do alvo.
 */
export function passosSupostos(nivel: number, ato: number, ate_alvo: number): number {
  const teto = Number.isFinite(ate_alvo) ? Math.max(0, Math.floor(ate_alvo)) : 0;
  return Math.min(pontosAte(nivel, ato), teto);
}
