import { describe, expect, it } from "vitest";

import { ascendenciaDaBuild, labDeAgora, labDoNivel, nomeDoDeus, temAscendencia } from "./ascendencia";
import { TIPO, type ArvoreDoJogo, type NoDeAscendencia } from "./arvore/dados";
import type { EtapaDeArvore, Plano } from "./plano";

function no(nome: string, tipo: number, distancia: number): NoDeAscendencia {
  return { nome, tipo, dona: "Pathfinder", distancia };
}

// A Pathfinder da build de Poisonous Concoction, com os ids de mentira.
const NOS = new Map<number, NoDeAscendencia>([
  [1, no("Pathfinder", TIPO.INICIO_DE_ASCENDENCIA, 0)],
  [2, no("Flask Effect, Chaos Damage", TIPO.NORMAL, 1)],
  [3, no("Nature's Reprisal", TIPO.NOTAVEL, 2)],
  [4, no("Poison Duration", TIPO.NORMAL, 1)],
  [5, no("Nature's Adrenaline", TIPO.NOTAVEL, 2)],
  [6, no("Flask Effect and Duration", TIPO.NORMAL, 1)],
  [7, no("Master Toxicist", TIPO.NOTAVEL, 2)],
  [8, no("Flask Effect and Charges Gained", TIPO.NORMAL, 3)],
  [9, no("Nature's Boon", TIPO.NOTAVEL, 4)],
]);
const ARVORE = { nosDeAscendencia: NOS } as ArvoreDoJogo;

function etapa(titulo: string, nos: number[]): EtapaDeArvore {
  return { titulo, nos } as EtapaDeArvore;
}

function plano(etapas: EtapaDeArvore[], maior: string | null = "TheBrineKing", menor: string | null = "Ryslatha"): Plano {
  return {
    personagem: { classe: "Ranger", ascendencia: null, bandido: "None", panteao: { maior, menor } },
    arvore: { etapas, ativa_no_pob: null, ascendencias: [] },
  } as unknown as Plano;
}

describe("ascendenciaDaBuild", () => {
  it("separa os nós por lab, na ordem do caminho, pelas árvores do PoB", () => {
    const a = ascendenciaDaBuild(
      plano([
        etapa("Level 12", [100, 200]),
        etapa("Level 48", [3, 100, 2, 1]),
        etapa("Level 71", [3, 7, 4, 5, 2, 6, 1]),
        etapa("Level 82", [9, 3, 7, 4, 5, 2, 6, 1, 8]),
        etapa("Level 92", [9, 3, 7, 4, 5, 2, 6, 1, 8]),
      ]),
      ARVORE,
    );
    expect(a.nome).toBe("Pathfinder");
    expect(a.labs.map((lab) => [lab.rotulo, lab.etapa, lab.nos.map((n) => n.nome)])).toEqual([
      ["Lab 1 (normal)", "Level 48", ["Flask Effect, Chaos Damage", "Nature's Reprisal"]],
      [
        "Labs 2 e 3 (cruel e merciless)",
        "Level 71",
        // Dois notáveis na mesma distância ficam na ordem do PoB.
        ["Poison Duration", "Flask Effect and Duration", "Master Toxicist", "Nature's Adrenaline"],
      ],
      ["Lab 4 (eternal)", "Level 82", ["Flask Effect and Charges Gained", "Nature's Boon"]],
    ]);
    expect(a.labs[0].nos.map((n) => n.notavel)).toEqual([false, true]);
    expect(a.labs.map((lab) => [lab.primeiro, lab.ultimo])).toEqual([[1, 1], [2, 3], [4, 4]]);
    // Destaque pelo nível: normal no 33, cruel no 55, merciless no 68, eternal no 75.
    expect([20, 33, 54, 55, 68, 74, 75, 90].map((n) => labDeAgora(a.labs, n))).toEqual([-1, 0, 0, 1, 1, 1, 2, 2]);
    expect([32, 33, 55, 68, 75].map(labDoNivel)).toEqual([0, 1, 2, 3, 4]);
    expect(a.panteao).toEqual({ maior: "Soul of the Brine King", menor: "Soul of Ryslatha" });
  });

  it("árvore única com os 8 pontos vira um grupo só", () => {
    const a = ascendenciaDaBuild(plano([etapa("Endgame", [9, 3, 7, 4, 5, 2, 6, 1, 8])]), ARVORE);
    expect(a.labs).toHaveLength(1);
    expect(a.labs[0].rotulo).toBe("Labs 1, 2, 3 e 4 (normal, cruel, merciless e eternal)");
  });

  it("sem dados da árvore fica só o panteão; sem nada, não mostra", () => {
    const so = ascendenciaDaBuild(plano([etapa("Level 48", [3])], null, "Gruthkul"), null);
    expect(so.labs).toEqual([]);
    expect(so.panteao).toEqual({ maior: null, menor: "Soul of Gruthkul" });
    expect(temAscendencia(so)).toBe(true);
    expect(temAscendencia(ascendenciaDaBuild(plano([], null, null), ARVORE))).toBe(false);
  });
});

describe("nomeDoDeus", () => {
  it("põe o nome do jogo", () => {
    expect(nomeDoDeus("Arakaali")).toBe("Soul of Arakaali");
    expect(nomeDoDeus("TheBrineKing")).toBe("Soul of the Brine King");
    expect(nomeDoDeus("None")).toBeNull();
    expect(nomeDoDeus(null)).toBeNull();
  });
});
