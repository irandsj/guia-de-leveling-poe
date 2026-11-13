import { describe, expect, it } from "vitest";

import {
  aoCarregarTimer,
  formatarTempo,
  lerTimer,
  lerTimerGuardado,
  mudarAtoDoTimer,
  novoTimer,
  pausarTimer,
  retomarTimer,
  timerDaCorridaNova,
  tocarTimer,
} from "./timer";

describe("cronômetro", () => {
  it("começa parado e zerado", () => {
    expect(lerTimer(novoTimer(), 5_000)).toEqual({ rodando: false, total_ms: 0, ato_ms: 0, por_ato: {} });
  });

  it("liga no primeiro sinal do jogo e conta o relógio", () => {
    const t = tocarTimer(novoTimer(), 1_000, 1);
    expect(t.desde).toBe(1_000);
    expect(lerTimer(t, 61_000)).toEqual({
      rodando: true,
      total_ms: 60_000,
      ato_ms: 60_000,
      por_ato: { "1": 60_000 },
    });
  });

  it("outro sinal no mesmo ato não muda nada", () => {
    const t = tocarTimer(novoTimer(), 1_000, 1);
    expect(tocarTimer(t, 30_000, 1)).toBe(t);
  });

  it("mudar de ato fecha o tempo do ato anterior", () => {
    let t = tocarTimer(novoTimer(), 0, 1);
    t = tocarTimer(t, 600_000, 2);
    expect(t.ato).toBe(2);
    expect(t.por_ato).toEqual({ "1": 600_000 });

    const leitura = lerTimer(t, 900_000);
    expect(leitura.total_ms).toBe(900_000);
    expect(leitura.ato_ms).toBe(300_000);
    expect(leitura.por_ato).toEqual({ "1": 600_000, "2": 300_000 });
  });

  it("voltar a um ato soma no tempo dele", () => {
    let t = tocarTimer(novoTimer(), 0, 3);
    t = mudarAtoDoTimer(t, 100_000, 4);
    t = mudarAtoDoTimer(t, 130_000, 3);
    expect(lerTimer(t, 150_000)).toEqual({
      rodando: true,
      total_ms: 150_000,
      ato_ms: 120_000,
      por_ato: { "3": 120_000, "4": 30_000 },
    });
  });

  it("a soma dos atos é sempre o total", () => {
    let t = tocarTimer(novoTimer(), 0, 1);
    for (let ato = 2; ato <= 10; ato++) t = mudarAtoDoTimer(t, (ato - 1) * 777_000, ato);
    const leitura = lerTimer(t, 9_999_999);
    const soma = Object.values(leitura.por_ato).reduce((a, b) => a + b, 0);
    expect(soma).toBe(leitura.total_ms);
    expect(leitura.total_ms).toBe(9_999_999);
  });

  it("pausa à mão: o jogo não religa sozinho, só o jogador", () => {
    let t = tocarTimer(novoTimer(), 0, 1);
    t = pausarTimer(t, 10_000, true);
    expect(t.desde).toBeNull();
    expect(t.pausado_a_mao).toBe(true);
    expect(tocarTimer(t, 20_000, 1)).toBe(t);
    expect(lerTimer(t, 99_000)).toMatchObject({ rodando: false, total_ms: 10_000 });

    t = retomarTimer(t, 30_000, 1);
    expect(t.pausado_a_mao).toBe(false);
    expect(lerTimer(t, 35_000)).toMatchObject({ rodando: true, total_ms: 15_000 });
  });

  it("o jogo fechou: para, e volta no próximo sinal", () => {
    let t = tocarTimer(novoTimer(), 0, 3);
    t = pausarTimer(t, 10_000, false);
    expect(t.pausado_a_mao).toBe(false);
    expect(lerTimer(t, 40_000)).toMatchObject({ rodando: false, total_ms: 10_000 });

    t = tocarTimer(t, 50_000, 3);
    expect(lerTimer(t, 60_000)).toMatchObject({ rodando: true, total_ms: 20_000, ato_ms: 20_000 });
  });

  it("o jogo fechando não desfaz a pausa à mão", () => {
    let t = pausarTimer(tocarTimer(novoTimer(), 0, 1), 5_000, true);
    t = pausarTimer(t, 9_000, false);
    expect(t.pausado_a_mao).toBe(true);
    expect(t.total_ms).toBe(5_000);
  });

  it("mudar de ato com o cronômetro parado só troca o ato", () => {
    const t = mudarAtoDoTimer(novoTimer(), 5_000, 4);
    expect(t).toEqual({ ...novoTimer(), ato: 4, inteiro: false });
    expect(mudarAtoDoTimer(t, 6_000, 4)).toBe(t);
  });

  it("ao carregar do disco: o trecho aberto fecha na hora em que foi salvo", () => {
    const t = tocarTimer(novoTimer(), 1_000, 2);
    const carregado = aoCarregarTimer(t, 31_000);
    expect(carregado.desde).toBeNull();
    expect(carregado.total_ms).toBe(30_000);
    expect(carregado.por_ato).toEqual({ "2": 30_000 });
    // O tempo com o guia fechado ficou de fora: o ato não vale pra recorde.
    expect(carregado.inteiro).toBe(false);
    // O app ficou fechado por horas: esse tempo não entra.
    expect(lerTimer(carregado, 9_000_000).total_ms).toBe(30_000);
  });

  it("ao carregar do disco: hora de salvar esquisita não vira tempo negativo", () => {
    const t = tocarTimer(novoTimer(), 1_000, 2);
    expect(aoCarregarTimer(t, 500)).toMatchObject({ desde: null, total_ms: 0 });

    const parado = pausarTimer(t, 4_000, true);
    expect(aoCarregarTimer(parado, 99_000)).toBe(parado);
  });

  it("relógio do Windows andando pra trás não vira tempo negativo", () => {
    const t = tocarTimer(novoTimer(), 10_000, 1);
    expect(lerTimer(t, 5_000).total_ms).toBe(0);
    expect(pausarTimer(t, 5_000, true).total_ms).toBe(0);
  });
});

describe("formatarTempo", () => {
  it("minutos e segundos; horas só quando tem", () => {
    const casos: [number, string][] = [
      [0, "0:00"],
      [999, "0:00"],
      [1_000, "0:01"],
      [59_999, "0:59"],
      [60_000, "1:00"],
      [83_000, "1:23"],
      [3_599_000, "59:59"],
      [3_600_000, "1:00:00"],
      [3_723_000, "1:02:03"],
      [36_000_000, "10:00:00"],
      [-5_000, "0:00"],
    ];
    for (const [ms, esperado] of casos) expect(formatarTempo(ms), `${ms} ms`).toBe(esperado);
  });
});

describe("atos concluídos (pro recorde)", () => {
  const MIN = 60_000;

  it("a corrida da praia em diante: cada ato que termina guarda o tempo dele", () => {
    let t = tocarTimer(novoTimer(), 0, 1);
    expect(t.inteiro).toBe(true);
    t = mudarAtoDoTimer(t, 12 * MIN, 2);
    t = mudarAtoDoTimer(t, 20 * MIN, 3);
    expect(t.concluidos).toEqual({ "1": 12 * MIN, "2": 8 * MIN });
    expect(t.inteiro).toBe(true);
  });

  it("voltar e avançar de novo não troca o tempo já concluído", () => {
    let t = tocarTimer(novoTimer(), 0, 1);
    t = mudarAtoDoTimer(t, 12 * MIN, 2);
    t = mudarAtoDoTimer(t, 13 * MIN, 1);
    t = mudarAtoDoTimer(t, 14 * MIN, 2);
    expect(t.concluidos).toEqual({ "1": 12 * MIN });
  });

  it("cronômetro ligado no meio da campanha: o primeiro ato não vale, o seguinte vale", () => {
    let t = tocarTimer(novoTimer(), 0, 4);
    expect(t.inteiro).toBe(false);
    t = mudarAtoDoTimer(t, 10 * MIN, 5);
    expect(t.concluidos).toEqual({});
    t = mudarAtoDoTimer(t, 25 * MIN, 6);
    expect(t.concluidos).toEqual({ "5": 15 * MIN });
  });

  it("pular de ato pelo modo de edição não conclui nada", () => {
    let t = tocarTimer(novoTimer(), 0, 1);
    t = mudarAtoDoTimer(t, 12 * MIN, 2, false);
    expect(t.concluidos).toEqual({});
    t = mudarAtoDoTimer(t, 20 * MIN, 3);
    expect(t.concluidos).toEqual({});
    t = mudarAtoDoTimer(t, 30 * MIN, 4);
    expect(t.concluidos).toEqual({ "3": 10 * MIN });
  });

  it("pular mais de um ato (achar pela zona) também não conclui", () => {
    let t = tocarTimer(novoTimer(), 0, 1);
    t = mudarAtoDoTimer(t, 12 * MIN, 3);
    expect(t.concluidos).toEqual({});
    expect(t.inteiro).toBe(false);
  });

  it("ato rápido demais (passos avançados na mão) não vale", () => {
    let t = tocarTimer(novoTimer(), 0, 1);
    t = mudarAtoDoTimer(t, 30_000, 2);
    expect(t.concluidos).toEqual({});
  });

  it("guia fechado com o tempo correndo: o ato fica de fora; o próximo vale", () => {
    let t = tocarTimer(novoTimer(), 0, 1);
    t = aoCarregarTimer(t, 5 * MIN);
    t = tocarTimer(t, 20 * MIN, 1);
    t = mudarAtoDoTimer(t, 30 * MIN, 2);
    expect(t.concluidos).toEqual({});
    t = mudarAtoDoTimer(t, 40 * MIN, 3);
    expect(t.concluidos).toEqual({ "2": 10 * MIN });
  });

  it("jogo fechado no meio do ato (pausa) não estraga o ato", () => {
    let t = tocarTimer(novoTimer(), 0, 1);
    t = pausarTimer(t, 5 * MIN, false);
    t = tocarTimer(t, 60 * MIN, 1);
    t = mudarAtoDoTimer(t, 67 * MIN, 2);
    expect(t.concluidos).toEqual({ "1": 12 * MIN });
  });

  it("corrida nova: já conta desde a hora dada, no ato 1", () => {
    const t = timerDaCorridaNova(7_000);
    expect(t).toMatchObject({ desde: 7_000, ato: 1, inteiro: true, total_ms: 0 });
  });
});

describe("lerTimerGuardado", () => {
  it("aceita o que o próprio cronômetro produz", () => {
    expect(lerTimerGuardado(novoTimer())).toEqual(novoTimer());
    const contando = tocarTimer(novoTimer(), 5, 2);
    expect(lerTimerGuardado(contando)).toEqual(contando);
    const parado = JSON.parse(JSON.stringify(pausarTimer(tocarTimer(novoTimer(), 5, 2), 9, true)));
    expect(lerTimerGuardado(parado)).toEqual(parado);
  });

  it("arquivo de antes do recorde continua valendo, sem ato concluído", () => {
    const t = tocarTimer(novoTimer(), 5, 1);
    const antigo = { total_ms: t.total_ms, por_ato: t.por_ato, desde: t.desde, ato: t.ato, pausado_a_mao: t.pausado_a_mao };
    expect(lerTimerGuardado(antigo)).toEqual({ ...antigo, inteiro: false, concluidos: {} });
  });

  it("joga fora tempos estranhos dentro do formato", () => {
    const torto = { ...novoTimer(), por_ato: { "1": 5, x: 3, "2": -1 }, concluidos: { "3": "rápido", "4": 9 } };
    expect(lerTimerGuardado(torto)).toMatchObject({ por_ato: { "1": 5 }, concluidos: { "4": 9 } });
  });

  it("recusa o que não tem o formato", () => {
    const ruins: unknown[] = [
      null,
      undefined,
      "timer",
      42,
      [],
      {},
      { ...novoTimer(), total_ms: "0" },
      { ...novoTimer(), total_ms: Number.NaN },
      { ...novoTimer(), por_ato: null },
      { ...novoTimer(), desde: "agora" },
      { ...novoTimer(), ato: "1" },
      { ...novoTimer(), pausado_a_mao: 0 },
    ];
    for (const ruim of ruins) expect(lerTimerGuardado(ruim), JSON.stringify(ruim)).toBeNull();
  });
});
