import { describe, expect, it } from "vitest";

import {
  anotarAto,
  atosRecemConcluidos,
  lerRecordes,
  novosRecordes,
  textoDoAto,
  VERSAO_DOS_RECORDES,
} from "./recordes";

const MIN = 60_000;

describe("recordes por ato", () => {
  it("o primeiro tempo do ato vira o recorde", () => {
    const anotado = anotarAto(novosRecordes(), "1", 12 * MIN, 2, 1_000);
    expect(anotado).toMatchObject({ anterior: null, bateu: true });
    expect(anotado.recordes.atos).toEqual({ "1": { ms: 12 * MIN, mortes: 2, em: 1_000 } });
    expect(textoDoAto("1", 12 * MIN, anotado)).toBe("Ato 1 em 12:00. Primeiro tempo guardado.");
  });

  it("tempo menor bate o recorde; maior não mexe", () => {
    const r = anotarAto(novosRecordes(), "2", 10 * MIN, 0, 1).recordes;

    const melhor = anotarAto(r, "2", 9 * MIN, 1, 2);
    expect(melhor.bateu).toBe(true);
    expect(melhor.recordes.atos["2"]).toEqual({ ms: 9 * MIN, mortes: 1, em: 2 });
    expect(textoDoAto("2", 9 * MIN, melhor)).toBe("Ato 2 em 9:00: recorde! Era 10:00.");

    const pior = anotarAto(r, "2", 10 * MIN + 23_000, 0, 3);
    expect(pior.bateu).toBe(false);
    expect(pior.recordes).toBe(r);
    expect(textoDoAto("2", 10 * MIN + 23_000, pior)).toBe("Ato 2 em 10:23. Recorde: 10:00 (+0:23).");
  });

  it("anotar o mesmo tempo de novo não muda nada", () => {
    const r = anotarAto(novosRecordes(), "3", 15 * MIN, 0, 1).recordes;
    expect(anotarAto(r, "3", 15 * MIN, 0, 99).recordes).toBe(r);
  });

  it("atos recém-concluídos, em ordem", () => {
    expect(atosRecemConcluidos({ "1": 5 }, { "1": 5, "10": 3, "2": 4 })).toEqual(["2", "10"]);
    expect(atosRecemConcluidos({ "1": 5 }, { "1": 5 })).toEqual([]);
  });
});

describe("recordes no disco", () => {
  it("ida e volta", () => {
    const r = anotarAto(anotarAto(novosRecordes(), "1", 5 * MIN, 0, 1).recordes, "2", 7 * MIN, 3, 2).recordes;
    expect(lerRecordes(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });

  it("lixo vira recordes vazios ou fica de fora", () => {
    for (const lixo of [null, undefined, "x", 3, [], {}, { versao: VERSAO_DOS_RECORDES + 1, atos: {} }]) {
      expect(lerRecordes(lixo), JSON.stringify(lixo)).toEqual(novosRecordes());
    }
    const torto = {
      versao: VERSAO_DOS_RECORDES,
      atos: {
        "1": { ms: 300_000, mortes: -1, em: "ontem" },
        "2": { ms: "rápido" },
        "3": { ms: 0 },
        x: { ms: 5 },
        "4": null,
      },
    };
    expect(lerRecordes(torto).atos).toEqual({ "1": { ms: 300_000, mortes: 0, em: 0 } });
  });
});
