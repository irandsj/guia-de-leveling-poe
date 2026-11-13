import { describe, expect, it } from "vitest";

import { ligacoesDosSoquetes, posicoesDosSoquetes } from "./soquetes";

const desenho = (n: number) => posicoesDosSoquetes(n).map((s) => `${s.linha}${s.coluna}`).join(" ");

describe("soquetes", () => {
  it("até 3 gemas, uma fileira deitada", () => {
    expect(desenho(1)).toBe("00");
    expect(desenho(2)).toBe("00 01");
    expect(desenho(3)).toBe("00 01 02");
    expect(ligacoesDosSoquetes(posicoesDosSoquetes(3)).every((l) => l.deitada)).toBe(true);
  });

  it("de 4 em diante, duas colunas em zigue-zague como no item", () => {
    expect(desenho(4)).toBe("00 01 11 10");
    expect(desenho(5)).toBe("00 01 11 10 20");
    expect(desenho(6)).toBe("00 01 11 10 20 21");
    expect(ligacoesDosSoquetes(posicoesDosSoquetes(6)).map((l) => (l.deitada ? "-" : "|")).join("")).toBe("-|-|-");
  });

  it("cada soquete fica colado no seguinte", () => {
    for (let n = 1; n <= 8; n++) {
      const s = posicoesDosSoquetes(n);
      for (let i = 1; i < s.length; i++) {
        expect(Math.abs(s[i].linha - s[i - 1].linha) + Math.abs(s[i].coluna - s[i - 1].coluna)).toBe(1);
      }
    }
  });

  it("nenhuma gema, nenhum soquete", () => {
    expect(posicoesDosSoquetes(0)).toEqual([]);
    expect(ligacoesDosSoquetes([])).toEqual([]);
  });
});
