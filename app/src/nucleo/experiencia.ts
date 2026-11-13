// Quanto de experiência o personagem ganha na zona, pela diferença de nível pros monstros.
// Fórmula do PoE1 (poewiki, "Experience"): até uma faixa segura não perde nada; passou dela,
// o ganho cai rápido. Vale pros dois lados: monstro fraco demais ou forte demais.

import { Data } from "../terceiros/exile-leveling/src/data";
import { ehCidade, ehCidadePeloNome } from "./avanco";
import "./dados-330";

export interface Experiencia {
  /** De 0,01 a 1. 1 = ganha tudo. */
  multiplicador: number;
  /** Quanto o ganho cai, em pontos de porcentagem (0 a 99). */
  perda: number;
  /** Nível dos monstros da zona. */
  nivel_da_zona: number;
  /** Nível do personagem menos o da zona. Positivo = personagem acima. */
  diferenca: number;
  /** Diferença que ainda não perde nada, pra cima ou pra baixo. */
  faixa_segura: number;
}

export function faixaSegura(nivel: number): number {
  return 3 + Math.floor(nivel / 16);
}

export function experienciaNaZona(nivel: number, nivelDaZona: number): Experiencia {
  const faixa = faixaSegura(nivel);
  const diferenca = nivel - nivelDaZona;
  const alem = Math.max(Math.abs(diferenca) - faixa, 0);
  const bruto = Math.pow((nivel + 5) / (nivel + 5 + Math.pow(alem, 2.5)), 1.5);
  const multiplicador = Math.min(1, Math.max(bruto, 0.01));
  return {
    multiplicador,
    perda: Math.round((1 - multiplicador) * 100),
    nivel_da_zona: nivelDaZona,
    diferenca,
    faixa_segura: faixa,
  };
}

/**
 * Nível dos monstros da zona que o jogo gerou ("Generating level N area"). Cidade e esconderijo
 * não têm monstro: `null`.
 */
export function nivelDaZonaGerada(areaId: string, nivelArea: number): number | null {
  if (ehCidade(areaId) || /^hideout/i.test(areaId)) return null;
  return Number.isFinite(nivelArea) && nivelArea >= 1 && nivelArea <= 100 ? Math.trunc(nivelArea) : null;
}

/**
 * Nível da zona só pelo nome (voltou pra uma zona que já existia e o jogo não disse o nível).
 * Os atos 6 a 10 repetem nomes dos atos 1 a 5: vale a zona do ato em que a rota está, ou a do
 * ato mais perto dele. `null` = cidade ou nome que não está nos dados.
 */
export function nivelDaZonaPeloNome(nome: string, ato: number): number | null {
  if (ehCidadePeloNome(nome)) return null;
  let melhor: { nivel: number; distancia: number } | null = null;
  for (const area of Object.values(Data.Areas)) {
    if (area.name !== nome || area.is_town_area) continue;
    const distancia = Math.abs(area.act - ato);
    if (melhor === null || distancia < melhor.distancia) melhor = { nivel: area.level, distancia };
  }
  return melhor?.nivel ?? null;
}
