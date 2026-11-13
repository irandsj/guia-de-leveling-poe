import { describe, expect, it } from "vitest";

import tabelaDeVerdade from "../dados/artes-itens.json";
import { arteDoItem, type TabelaDeArtes } from "./artes-itens";

const tabela: TabelaDeArtes = {
  bases: {
    "Leather Cap": "Armours/Helmets/HelmetDex1",
    "Iron Ring": "Rings/Ring1",
    "Life Flask": "Flasks/lifeflask0",
    "Divine Life Flask": "Flasks/lifeflask11",
    "Quicksilver Flask": "Flasks/sprint",
    Ringmail: "Armours/BodyArmours/Ringmail",
  },
  unicos: { Goldrim: "Armours/Helmets/HelmetDexUnique2" },
};

describe("arteDoItem", () => {
  it("o único vai pelo nome; o que a tabela não conhece vai pela base", () => {
    expect(arteDoItem(tabela, { nome: "Goldrim", base: "Leather Cap", raridade: "UNIQUE" })).toBe(
      "Armours/Helmets/HelmetDexUnique2",
    );
    expect(arteDoItem(tabela, { nome: "Único Novo", base: "Leather Cap", raridade: "UNIQUE" })).toBe(
      "Armours/Helmets/HelmetDex1",
    );
  });

  it("o raro vai pela base; sem base, fica sem foto", () => {
    expect(arteDoItem(tabela, { nome: "Storm Crown", base: "Leather Cap", raridade: "RARE" })).toBe(
      "Armours/Helmets/HelmetDex1",
    );
    expect(arteDoItem(tabela, { nome: "Iron Ring Bane", base: null, raridade: "RARE" })).toBeNull();
  });

  it("o normal é a própria base, com ou sem o Superior do PoB", () => {
    expect(arteDoItem(tabela, { nome: "Iron Ring", base: null, raridade: "NORMAL" })).toBe("Rings/Ring1");
    expect(arteDoItem(tabela, { nome: "Superior Leather Cap", base: null, raridade: "NORMAL" })).toBe(
      "Armours/Helmets/HelmetDex1",
    );
  });

  it("o mágico acha a maior base inteira no meio do nome", () => {
    expect(arteDoItem(tabela, { nome: "Seething Divine Life Flask of Staunching", base: null, raridade: "MAGIC" })).toBe(
      "Flasks/lifeflask11",
    );
    expect(arteDoItem(tabela, { nome: "Chemist's Quicksilver Flask of Adrenaline", base: null, raridade: "MAGIC" })).toBe(
      "Flasks/sprint",
    );
    // "Ring" de Ringmail não é Iron Ring, e base inventada fica sem foto.
    expect(arteDoItem(tabela, { nome: "Glinting Ringmail of the Fox", base: null, raridade: "MAGIC" })).toBe(
      "Armours/BodyArmours/Ringmail",
    );
    expect(arteDoItem(tabela, { nome: "Coisa Inventada", base: null, raridade: "MAGIC" })).toBeNull();
  });

  it("a tabela gerada conhece os itens de sempre do leveling", () => {
    const t = tabelaDeVerdade as TabelaDeArtes;
    for (const [nome, raridade] of [
      ["Goldrim", "UNIQUE"],
      ["Tabula Rasa", "UNIQUE"],
      ["Wanderlust", "UNIQUE"],
      ["Lifesprig", "UNIQUE"],
      ["Iron Ring", "NORMAL"],
      ["Coral Ring", "NORMAL"],
      ["Rustic Sash", "NORMAL"],
    ] as const) {
      expect(arteDoItem(t, { nome, base: null, raridade }), nome).toMatch(/^[A-Za-z0-9_\-/]+$/);
    }
    expect(arteDoItem(t, { nome: "Bubbling Divine Life Flask of Staunching", base: null, raridade: "MAGIC" })).toBe(
      t.bases["Divine Life Flask"],
    );
  });
});
