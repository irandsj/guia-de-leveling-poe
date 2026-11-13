import { describe, expect, it } from "vitest";

import { passosSupostos, pontosAte, PONTOS_DE_MISSAO_ATE_O_ATO } from "./pontos";

describe("pontos de passiva por nível e ato", () => {
  it("a tabela das missões é a do Path of Building e nunca desce", () => {
    expect(PONTOS_DE_MISSAO_ATE_O_ATO).toEqual([0, 0, 2, 4, 6, 7, 9, 12, 15, 18, 20, 23]);
    for (let ato = 1; ato < PONTOS_DE_MISSAO_ATE_O_ATO.length; ato++) {
      expect(PONTOS_DE_MISSAO_ATE_O_ATO[ato]).toBeGreaterThanOrEqual(PONTOS_DE_MISSAO_ATE_O_ATO[ato - 1]);
    }
  });

  it("no nível 1 do ato 1 não há ponto nenhum", () => {
    expect(pontosAte(1, 1)).toBe(0);
  });

  it("um ponto por nível, mais os das missões dos atos já terminados", () => {
    expect(pontosAte(2, 1)).toBe(1);
    expect(pontosAte(12, 1)).toBe(11);
    expect(pontosAte(13, 2)).toBe(14);
    expect(pontosAte(33, 4)).toBe(38);
    expect(pontosAte(45, 6)).toBe(53);
    expect(pontosAte(68, 10)).toBe(87);
    expect(pontosAte(70, 11)).toBe(92);
    expect(pontosAte(100, 11)).toBe(122);
  });

  it("valor torto não quebra: fica dentro da tabela", () => {
    expect(pontosAte(0, 0)).toBe(0);
    expect(pontosAte(-5, -3)).toBe(0);
    expect(pontosAte(500, 99)).toBe(122);
    expect(pontosAte(Number.NaN, Number.NaN)).toBe(0);
    expect(pontosAte(Number.POSITIVE_INFINITY, 3)).toBe(4);
    expect(pontosAte(10.9, 2.9)).toBe(11);
  });

  it("cresce com o nível e com o ato", () => {
    for (let ato = 1; ato <= 11; ato++) {
      for (let nivel = 1; nivel < 100; nivel++) {
        expect(pontosAte(nivel + 1, ato)).toBe(pontosAte(nivel, ato) + 1);
        if (ato < 11) expect(pontosAte(nivel, ato + 1)).toBeGreaterThanOrEqual(pontosAte(nivel, ato));
      }
    }
  });

  it("antes de ver a árvore, supõe os pontos gastos na ordem, sem passar do alvo", () => {
    expect(passosSupostos(1, 1, 30)).toBe(0);
    expect(passosSupostos(12, 1, 30)).toBe(11);
    expect(passosSupostos(40, 5, 30)).toBe(30);
    expect(passosSupostos(40, 5, 0)).toBe(0);
    expect(passosSupostos(40, 5, -3)).toBe(0);
    expect(passosSupostos(40, 5, Number.NaN)).toBe(0);
  });
});
