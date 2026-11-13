import { describe, expect, it } from "vitest";

import { experienciaNaZona, faixaSegura, nivelDaZonaGerada, nivelDaZonaPeloNome } from "./experiencia";

describe("experiência pela diferença de nível", () => {
  it("dentro da faixa segura não perde nada", () => {
    expect(faixaSegura(1)).toBe(3);
    expect(faixaSegura(16)).toBe(4);
    expect(faixaSegura(32)).toBe(5);
    expect(faixaSegura(64)).toBe(7);
    for (const zona of [7, 10, 13]) expect(experienciaNaZona(10, zona)).toMatchObject({ multiplicador: 1, perda: 0 });
  });

  it("passou da faixa: cai rápido, pros dois lados", () => {
    // Nível 30 (faixa 4): 1 além da faixa perde pouco; 2 além já perdem 20%.
    expect(experienciaNaZona(30, 25).perda).toBe(4);
    const dois = experienciaNaZona(30, 24);
    expect(dois.diferenca).toBe(6);
    expect(dois.perda).toBe(20);
    // Bem acima da zona: perda grande.
    expect(experienciaNaZona(30, 18).perda).toBeGreaterThan(35);
    // Zona acima do personagem também perde.
    expect(experienciaNaZona(30, 38).perda).toBeGreaterThan(0);
    expect(experienciaNaZona(30, 38).diferenca).toBe(-8);
  });

  it("valores conferidos com a fórmula do jogo", () => {
    // ((n+5)/(n+5+d^2.5))^1.5
    const esperado = (n: number, d: number) => Math.pow((n + 5) / (n + 5 + Math.pow(d, 2.5)), 1.5);
    expect(experienciaNaZona(20, 13).multiplicador).toBeCloseTo(esperado(20, 3), 10);
    // Nível 45: faixa 5; zona 60 = 15 de diferença, 10 além da faixa.
    expect(experienciaNaZona(45, 60).multiplicador).toBeCloseTo(esperado(45, 10), 10);
  });

  it("nunca abaixo de 1%", () => {
    expect(experienciaNaZona(90, 1)).toMatchObject({ multiplicador: 0.01, perda: 99 });
  });
});

describe("nível da zona", () => {
  it("zona gerada: o nível que o jogo disse; cidade e esconderijo, nenhum", () => {
    expect(nivelDaZonaGerada("1_1_2", 2)).toBe(2);
    expect(nivelDaZonaGerada("1_1_town", 1)).toBeNull();
    expect(nivelDaZonaGerada("HideoutCoastal", 1)).toBeNull();
    expect(nivelDaZonaGerada("1_1_2", Number.NaN)).toBeNull();
    expect(nivelDaZonaGerada("1_1_2", 0)).toBeNull();
  });

  it("pelo nome: a zona do ato em que a rota está", () => {
    expect(nivelDaZonaPeloNome("The Coast", 1)).toBe(2);
    const noAto6 = nivelDaZonaPeloNome("The Coast", 6);
    expect(noAto6).not.toBeNull();
    expect(noAto6).toBeGreaterThan(40);
    expect(nivelDaZonaPeloNome("Lioneye's Watch", 1)).toBeNull();
    expect(nivelDaZonaPeloNome("Lugar Nenhum", 1)).toBeNull();
  });
});
