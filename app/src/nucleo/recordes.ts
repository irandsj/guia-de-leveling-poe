// Melhor tempo de cada ato (arquivo "recordes"). Vale pra todas as corridas e builds.
// Só entra ato cronometrado inteiro (ver `concluidos` no cronômetro).

import { formatarTempo } from "./timer";

export const VERSAO_DOS_RECORDES = 1;

export interface RecordeDoAto {
  /** Melhor tempo do ato, em ms. */
  ms: number;
  /** Mortes no ato na corrida do recorde. */
  mortes: number;
  /** Quando o recorde foi feito (ms desde 1970). */
  em: number;
}

export interface Recordes {
  versao: number;
  /** A chave é o número do ato. */
  atos: Record<string, RecordeDoAto>;
}

export function novosRecordes(): Recordes {
  return { versao: VERSAO_DOS_RECORDES, atos: {} };
}

function numeroBom(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

/** Lê os recordes do disco. O que vier fora do formato fica de fora. */
export function lerRecordes(valor: unknown): Recordes {
  if (typeof valor !== "object" || valor === null) return novosRecordes();
  const bruto = valor as Partial<Recordes>;
  if (bruto.versao !== VERSAO_DOS_RECORDES || typeof bruto.atos !== "object" || bruto.atos === null) {
    return novosRecordes();
  }
  const atos: Record<string, RecordeDoAto> = {};
  for (const [ato, r] of Object.entries(bruto.atos as Record<string, unknown>)) {
    if (!/^\d{1,2}$/.test(ato) || typeof r !== "object" || r === null) continue;
    const { ms, mortes, em } = r as Partial<RecordeDoAto>;
    if (!numeroBom(ms) || ms === 0) continue;
    atos[ato] = { ms, mortes: numeroBom(mortes) ? Math.trunc(mortes) : 0, em: numeroBom(em) ? em : 0 };
  }
  return { versao: VERSAO_DOS_RECORDES, atos };
}

export interface AtoAnotado {
  recordes: Recordes;
  /** O recorde de antes. `null` = primeira vez que o ato termina inteiro. */
  anterior: RecordeDoAto | null;
  /** O tempo novo virou o recorde. */
  bateu: boolean;
}

/**
 * Anota um ato concluído. Só troca o recorde se o tempo novo for menor. Anotar o mesmo tempo de
 * novo não muda nada.
 */
export function anotarAto(r: Recordes, ato: string, ms: number, mortes: number, agora: number): AtoAnotado {
  const anterior = r.atos[ato] ?? null;
  const bateu = anterior === null || ms < anterior.ms;
  if (!bateu) return { recordes: r, anterior, bateu };
  return { recordes: { ...r, atos: { ...r.atos, [ato]: { ms, mortes, em: agora } } }, anterior, bateu };
}

/** Atos que estão concluídos agora e não estavam antes, em ordem. */
export function atosRecemConcluidos(antes: Record<string, number>, depois: Record<string, number>): string[] {
  return Object.keys(depois)
    .filter((ato) => !(ato in antes))
    .sort((a, b) => Number(a) - Number(b));
}

/** A frase que aparece quando o ato termina. */
export function textoDoAto(ato: string, ms: number, anotado: AtoAnotado): string {
  const tempo = `Ato ${ato} em ${formatarTempo(ms)}`;
  const { anterior } = anotado;
  if (anterior === null) return `${tempo}. Primeiro tempo guardado.`;
  if (anotado.bateu) return `${tempo}: recorde! Era ${formatarTempo(anterior.ms)}.`;
  return `${tempo}. Recorde: ${formatarTempo(anterior.ms)} (+${formatarTempo(ms - anterior.ms)}).`;
}
