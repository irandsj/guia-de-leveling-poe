// Cronômetro da campanha: tempo total e tempo por ato. Conta o relógio da parede.
// Tudo aqui é função pura: quem chama diz que horas são (`agora`, em ms).

export interface EstadoTimer {
  /** Tempo já fechado, em ms. */
  total_ms: number;
  /** Tempo já fechado de cada ato, em ms. A chave é o número do ato. */
  por_ato: Record<string, number>;
  /** Quando o trecho em andamento começou. `null` = parado. */
  desde: number | null;
  /** Ato em que o trecho em andamento está contando. */
  ato: number;
  /** O jogador pausou à mão: o jogo não religa sozinho. */
  pausado_a_mao: boolean;
  /**
   * O cronômetro está no ato desde o começo dele, sem buraco: a corrida começou nele (ato 1) ou
   * chegou nele vindo do ato anterior, e o guia não ficou fechado com o tempo correndo.
   * Só ato inteiro vale pra recorde.
   */
  inteiro: boolean;
  /** Tempo de cada ato na primeira vez que ele foi concluído inteiro, em ms. A chave é o ato. */
  concluidos: Record<string, number>;
}

/** Ato mais curto que isso não vale como concluído (avançou o passo na mão pra testar, por exemplo). */
export const ATO_MINIMO_MS = 2 * 60_000;

export function novoTimer(): EstadoTimer {
  return { total_ms: 0, por_ato: {}, desde: null, ato: 1, pausado_a_mao: false, inteiro: true, concluidos: {} };
}

/** Um cronômetro novo já contando desde `desde`, no começo do ato 1 (corrida nova na praia). */
export function timerDaCorridaNova(desde: number): EstadoTimer {
  return { ...novoTimer(), desde };
}

/** Fecha o trecho em andamento, somando o que passou até `ate`. */
function fechar(t: EstadoTimer, ate: number): EstadoTimer {
  if (t.desde === null) return t;
  const passou = Math.max(0, ate - t.desde);
  const chave = String(t.ato);
  return {
    ...t,
    total_ms: t.total_ms + passou,
    por_ato: { ...t.por_ato, [chave]: (t.por_ato[chave] ?? 0) + passou },
    desde: null,
  };
}

/** O jogo deu sinal de vida (entrou numa zona): liga, a não ser que esteja pausado à mão. */
export function tocarTimer(t: EstadoTimer, agora: number, ato: number): EstadoTimer {
  if (t.pausado_a_mao) return t;
  if (t.desde !== null) return mudarAtoDoTimer(t, agora, ato);
  const comeco = t.total_ms === 0 && Object.keys(t.por_ato).length === 0;
  // Cronômetro zerado ligando no meio da campanha: este ato não foi cronometrado desde o começo.
  const inteiro = comeco ? ato === 1 : t.inteiro && t.ato === ato;
  return { ...t, desde: agora, ato, inteiro };
}

/** O jogador mandou continuar. */
export function retomarTimer(t: EstadoTimer, agora: number, ato: number): EstadoTimer {
  const solto = { ...t, pausado_a_mao: false };
  return tocarTimer(solto, agora, ato);
}

/** Para de contar. `aMao` = foi o jogador (e não o jogo fechando). */
export function pausarTimer(t: EstadoTimer, agora: number, aMao: boolean): EstadoTimer {
  return { ...fechar(t, agora), pausado_a_mao: aMao || t.pausado_a_mao };
}

/**
 * A rota mudou de ato: o tempo passa a contar no ato novo.
 * `conta` = a mudança veio do jogo ou das teclas de passo; pular de ato pelo modo de edição não
 * conclui o ato de antes nem deixa o novo valer pra recorde.
 */
export function mudarAtoDoTimer(t: EstadoTimer, agora: number, ato: number, conta = true): EstadoTimer {
  if (t.ato === ato) return t;
  const fechado = fechar(t, agora);
  const seguinte = conta && ato === t.ato + 1;
  const chave = String(t.ato);
  const tempo = fechado.por_ato[chave] ?? 0;
  const concluiu = seguinte && t.inteiro && !(chave in t.concluidos) && tempo >= ATO_MINIMO_MS;
  return {
    ...fechado,
    desde: t.desde === null ? null : agora,
    ato,
    inteiro: seguinte,
    concluidos: concluiu ? { ...t.concluidos, [chave]: tempo } : t.concluidos,
  };
}

/**
 * O estado veio do disco: o app esteve fechado. O trecho em andamento fecha na hora em que o
 * estado foi salvo pela última vez (`salvoEm`), pra não contar o tempo com o app fechado.
 * Se estava contando, o tempo com o guia fechado ficou de fora: o ato não vale mais pra recorde.
 */
export function aoCarregarTimer(t: EstadoTimer, salvoEm: number): EstadoTimer {
  const cortado = t.desde !== null;
  const fechado = fechar(t, Math.max(salvoEm, t.desde ?? salvoEm));
  return cortado ? { ...fechado, inteiro: false } : fechado;
}

export interface LeituraDoTimer {
  rodando: boolean;
  total_ms: number;
  /** Tempo do ato em que a rota está. */
  ato_ms: number;
  por_ato: Record<string, number>;
}

export function lerTimer(t: EstadoTimer, agora: number): LeituraDoTimer {
  const fechado = fechar(t, agora);
  return {
    rodando: t.desde !== null,
    total_ms: fechado.total_ms,
    ato_ms: fechado.por_ato[String(t.ato)] ?? 0,
    por_ato: fechado.por_ato,
  };
}

/** 83 s → "1:23"; 1 h 2 min 3 s → "1:02:03". */
export function formatarTempo(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const dois = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${dois(m)}:${dois(s)}` : `${m}:${dois(s)}`;
}

/** Tempo por ato que veio do disco: só chaves de ato e números que fazem sentido. */
function temposPorAto(valor: unknown): Record<string, number> {
  if (typeof valor !== "object" || valor === null) return {};
  const tempos: Record<string, number> = {};
  for (const [chave, ms] of Object.entries(valor)) {
    if (/^\d{1,2}$/.test(chave) && typeof ms === "number" && Number.isFinite(ms) && ms >= 0) tempos[chave] = ms;
  }
  return tempos;
}

/**
 * Lê o cronômetro que veio do disco. `null` = fora do formato. Arquivo de antes do recorde
 * (sem `inteiro` e `concluidos`) continua valendo, sem nenhum ato concluído.
 */
export function lerTimerGuardado(valor: unknown): EstadoTimer | null {
  if (typeof valor !== "object" || valor === null) return null;
  const t = valor as Partial<EstadoTimer>;
  const certo =
    typeof t.total_ms === "number" &&
    Number.isFinite(t.total_ms) &&
    typeof t.por_ato === "object" &&
    t.por_ato !== null &&
    (t.desde === null || typeof t.desde === "number") &&
    typeof t.ato === "number" &&
    typeof t.pausado_a_mao === "boolean";
  if (!certo) return null;
  return {
    total_ms: t.total_ms as number,
    por_ato: temposPorAto(t.por_ato),
    desde: t.desde as number | null,
    ato: t.ato as number,
    pausado_a_mao: t.pausado_a_mao as boolean,
    inteiro: typeof t.inteiro === "boolean" ? t.inteiro : false,
    concluidos: temposPorAto(t.concluidos),
  };
}
