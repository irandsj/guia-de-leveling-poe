import { describe, expect, it } from "vitest";

import {
  arvoreAlvo,
  arvoreDepoisDe,
  chegouNaEtapa,
  conjuntosEmOrdem,
  dicasDoAto,
  etapaDeGemas,
  etapaDeItens,
  faseDaArvore,
  itensDaFase,
} from "./conjuntos";
import { montarPlano, type Plano } from "./plano";
import { lerPob } from "./pob";
import { EARLY_GAME_ANTES_DOS_ATOS, POR_ATO, POR_NIVEL, xmlDeExemplo, type PobDeExemplo } from "./teste/pob-de-exemplo";

function planoDe(pob: PobDeExemplo): Plano {
  const origem = { url: null, id: null, site: "teste", hash_codigo: "sha256:teste" };
  return montarPlano(lerPob(xmlDeExemplo(pob)), origem, new Date("2026-11-10T12:00:00Z"));
}

const porNivel = planoDe(POR_NIVEL);
const porAto = planoDe(POR_ATO);

function gemas(plano: Plano, nivel: number, ato: number, manual: string | null = null) {
  const escolha = etapaDeGemas(plano, { nivel, ato }, manual);
  return { etapa: escolha.etapa?.titulo ?? null, proxima: escolha.proxima?.titulo ?? null, automatica: escolha.automatica };
}

describe("troca de conjunto de gemas pelo nível", () => {
  it("troca exatamente no nível do próximo conjunto", () => {
    const esperado: [number, string, string | null][] = [
      [1, "Level 1 - 4", "Level 4 - 12"],
      [3, "Level 1 - 4", "Level 4 - 12"],
      [4, "Level 4 - 12", "Level 12 - 38"],
      [11, "Level 4 - 12", "Level 12 - 38"],
      [12, "Level 12 - 38", "Level 38 - Maps"],
      [37, "Level 12 - 38", "Level 38 - Maps"],
      [38, "Level 38 - Maps", null],
      [68, "Level 38 - Maps", null],
      [95, "Level 38 - Maps", null],
    ];
    for (const [nivel, etapa, proxima] of esperado) {
      expect(gemas(porNivel, nivel, 1), `nível ${nivel}`).toEqual({ etapa, proxima, automatica: true });
    }
  });

  it("o ato não importa quando o rótulo é de nível", () => {
    expect(gemas(porNivel, 12, 1).etapa).toBe("Level 12 - 38");
    expect(gemas(porNivel, 12, 9).etapa).toBe("Level 12 - 38");
  });

  it("conjunto fixado à mão vale até soltar; id que não existe é ignorado", () => {
    expect(gemas(porNivel, 5, 1, "g4")).toMatchObject({ etapa: "Level 38 - Maps", automatica: false });
    expect(gemas(porNivel, 5, 1, "g6")).toMatchObject({ etapa: "Endgame", automatica: false });
    expect(gemas(porNivel, 5, 1, "g99")).toMatchObject({ etapa: "Level 4 - 12", automatica: true });
  });

  it("os conjuntos de fim de jogo nunca entram sozinhos", () => {
    for (let nivel = 1; nivel <= 100; nivel++) {
      const etapa = etapaDeGemas(porNivel, { nivel, ato: 10 }, null).etapa;
      expect(etapa?.fim_de_jogo, `nível ${nivel}`).toBe(false);
    }
  });
});

describe("troca de conjunto de gemas pelo ato", () => {
  it("começa no conjunto inicial e só entra no do ato quando a habilidade já pode ser usada", () => {
    expect(gemas(porAto, 1, 1)).toEqual({ etapa: "Pre-Sunder", proxima: "Act 1", automatica: true });
    expect(gemas(porAto, 11, 1)).toEqual({ etapa: "Pre-Sunder", proxima: "Act 1", automatica: true });
    // Sunder pede nível 12.
    expect(gemas(porAto, 12, 1)).toEqual({ etapa: "Act 1", proxima: "Act 2", automatica: true });
  });

  it("chegar no ato seguinte troca o conjunto", () => {
    expect(gemas(porAto, 13, 2).etapa).toBe("Act 2");
    expect(gemas(porAto, 40, 5)).toMatchObject({ etapa: "Act 2", proxima: "Act 6+" });
    expect(gemas(porAto, 45, 6).etapa).toBe("Act 6+");
    expect(gemas(porAto, 66, 10)).toMatchObject({ etapa: "Act 6+", proxima: "Start of Maps (Boneshatter Swap)" });
  });

  it("entrar no ato sem o nível da habilidade ainda não troca", () => {
    expect(gemas(porAto, 10, 2).etapa).toBe("Pre-Sunder");
  });

  it("os rótulos de nível continuam valendo depois da campanha", () => {
    expect(gemas(porAto, 68, 10)).toMatchObject({ etapa: "Start of Maps (Boneshatter Swap)", proxima: "Level 90" });
    expect(gemas(porAto, 90, 10)).toMatchObject({ etapa: "Level 90", proxima: null });
  });

  it("chegouNaEtapa: sem rótulo nunca 'chega'", () => {
    const inicial = porAto.gemas.etapas[0];
    expect(inicial.inicial).toBe(true);
    expect(chegouNaEtapa(inicial, { nivel: 100, ato: 10 })).toBe(false);
  });
});

describe("PoB sem conjuntos de leveling", () => {
  const plano = planoDe({
    conjuntoAtivo: 1,
    conjuntos: [
      { titulo: "Bossing", grupos: [{ gemas: ["Pride"] }] },
      { titulo: "Mapping", grupos: [{ gemas: ["Boneshatter", "Brutality Support"] }] },
    ],
  });

  it("durante a campanha vale o conjunto que estava ativo no PoB (o mesmo das gemas da rota)", () => {
    expect(gemas(plano, 10, 1)).toMatchObject({ etapa: "Bossing", proxima: "Mapping" });
    expect(gemas(plano, 60, 9).etapa).toBe("Bossing");
  });

  it("no nível de mapas entra o conjunto de mapas", () => {
    expect(gemas(plano, 68, 10).etapa).toBe("Mapping");
  });

  it("um conjunto só, sem título", () => {
    const simples = planoDe({ conjuntos: [{ titulo: "", grupos: [{ gemas: ["Sunder"] }] }] });
    expect(gemas(simples, 1, 1)).toEqual({ etapa: "", proxima: null, automatica: true });
    expect(etapaDeGemas(simples, { nivel: 50, ato: 7 }, null).etapa?.id).toBe("g1");
  });

  it("PoB sem gemas", () => {
    const vazio = planoDe({ conjuntos: [] });
    expect(etapaDeGemas(vazio, { nivel: 1, ato: 1 }, null)).toEqual({
      etapa: null,
      automatica: true,
      proxima: null,
      entra: null,
    });
  });
});

describe("árvore alvo", () => {
  const alvo = (plano: Plano, nivel: number, ato: number) => arvoreAlvo(plano, { nivel, ato })?.titulo ?? null;

  it("rótulo de nível: a árvore é como o personagem deve estar NAQUELE nível", () => {
    expect(alvo(porNivel, 1, 1)).toBe("Level 12");
    expect(alvo(porNivel, 11, 1)).toBe("Level 12");
    expect(alvo(porNivel, 12, 2)).toBe("Level 32 - Normal Lab");
    expect(alvo(porNivel, 31, 3)).toBe("Level 32 - Normal Lab");
    expect(alvo(porNivel, 32, 4)).toBe("Level 67 - Merc Lab & Respec");
    // Passou de todas: fica na última da campanha, nunca nas de fim de jogo.
    expect(alvo(porNivel, 67, 10)).toBe("Level 67 - Merc Lab & Respec");
    expect(alvo(porNivel, 95, 10)).toBe("Level 67 - Merc Lab & Respec");
  });

  it("rótulo de faixa de nível: a etapa vale até o FIM da faixa", () => {
    const faixas = planoDe({
      ...POR_NIVEL,
      arvoreAtiva: 1,
      arvores: [
        { titulo: "Level 1-12", nos: 12 },
        { titulo: "Level 12-22", nos: 22 },
        { titulo: "Level 22-40", nos: 40 },
      ],
    });
    expect(faixas.arvore.etapas.map((e) => [e.nivel_min, e.nivel_max])).toEqual([[1, 12], [12, 22], [22, 40]]);
    expect(alvo(faixas, 1, 1)).toBe("Level 1-12");
    expect(alvo(faixas, 2, 1)).toBe("Level 1-12");
    expect(alvo(faixas, 11, 1)).toBe("Level 1-12");
    expect(alvo(faixas, 12, 2)).toBe("Level 12-22");
    expect(alvo(faixas, 21, 2)).toBe("Level 12-22");
    expect(alvo(faixas, 22, 3)).toBe("Level 22-40");
    expect(alvo(faixas, 90, 10)).toBe("Level 22-40");
  });

  it("rótulo de ato: a árvore é como o personagem deve estar no FIM do ato", () => {
    expect(alvo(porAto, 1, 1)).toBe("Act 1");
    expect(alvo(porAto, 12, 1)).toBe("Act 1");
    expect(alvo(porAto, 13, 2)).toBe("Act 2");
    expect(alvo(porAto, 25, 3)).toBe("Act 6+");
    expect(alvo(porAto, 45, 6)).toBe("Act 6+");
  });

  it('"Act 6+" vale até o fim da campanha', () => {
    expect(alvo(porAto, 55, 8)).toBe("Act 6+");
    expect(alvo(porAto, 66, 10)).toBe("Act 6+");
  });

  it("depois do nível de mapas o alvo passa pra árvore seguinte", () => {
    expect(alvo(porAto, 68, 10)).toBe("Level 90");
    expect(alvo(porAto, 90, 10)).toBe("Level 90");
  });

  it("árvore da etapa pronta antes do nível: o alvo segue pra próxima etapa (o jogo não acaba no nível 12)", () => {
    const nivel11 = { nivel: 11, ato: 1 };
    const doze = arvoreAlvo(porNivel, nivel11)!;
    expect(doze.titulo).toBe("Level 12");
    const minimo = arvoreDepoisDe(porNivel, doze);
    expect(minimo).not.toBeNull();
    expect(arvoreAlvo(porNivel, nivel11, minimo!)?.titulo).toBe("Level 32 - Normal Lab");
    // O nível passa à frente do mínimo: vale o nível.
    expect(arvoreAlvo(porNivel, { nivel: 32, ato: 4 }, minimo!)?.titulo).toBe("Level 67 - Merc Lab & Respec");
    // Na última etapa não há pra onde seguir.
    const ultima = porNivel.arvore.etapas.filter((e) => e.nivel_min !== null || e.ato_min !== null).at(-1)!;
    expect(arvoreDepoisDe(porNivel, ultima)).toBeNull();
    expect(arvoreAlvo(porNivel, nivel11, 99)?.titulo).toBe(ultima.titulo);
  });

  it("sem rótulos: a árvore que estava ativa no PoB", () => {
    const plano = planoDe({
      conjuntos: [],
      arvoreAtiva: 2,
      arvores: [
        { titulo: "Bossing", nos: 100 },
        { titulo: "Minha árvore", nos: 110 },
      ],
    });
    expect(alvo(plano, 1, 1)).toBe("Minha árvore");
    expect(arvoreAlvo(planoDe({ conjuntos: [], arvores: [] }), { nivel: 1, ato: 1 })).toBeNull();
  });
});

describe("itens da vez e receitas", () => {
  it("conjunto de itens com rótulo de leveling aparece na campanha", () => {
    expect(etapaDeItens(porNivel, { nivel: 1, ato: 1 })?.titulo).toBe("Leveling");
    expect(etapaDeItens(porNivel, { nivel: 60, ato: 9 })?.titulo).toBe("Leveling");
  });

  it("PoB com um conjunto de itens só, sem rótulo: é o que a build tem, aparece sempre", () => {
    const plano = planoDe({
      conjuntos: [],
      itens: [{ id: 1, texto: "Rarity: UNIQUE\nTabula Rasa\nSimple Robe" }],
      conjuntosDeItens: [{ titulo: "", espacos: { "Body Armour": 1 } }],
    });
    expect(itensDaFase(plano, { nivel: 30, ato: 3 })).toMatchObject({ etapa: { titulo: "" }, proxima: null });
  });

  it("conjunto de itens dos mapas só aparece quando chega a hora", () => {
    const plano = planoDe({
      conjuntos: [],
      itens: [{ id: 1, texto: "Rarity: UNIQUE\nTabula Rasa\nSimple Robe" }],
      conjuntosDeItens: [{ titulo: "Maps", espacos: { "Body Armour": 1 } }],
    });
    expect(etapaDeItens(plano, { nivel: 30, ato: 3 })).toBeNull();
    expect(etapaDeItens(plano, { nivel: 68, ato: 10 })?.titulo).toBe("Maps");
  });

  it("receitas de vendedor por ato; conferida só com fonte (patch notes ou poedb)", () => {
    for (let ato = 1; ato <= 10; ato++) {
      const dicas = dicasDoAto(porNivel, ato);
      expect(dicas.every((d) => d.ato_min <= ato && ato <= d.ato_max)).toBe(true);
      expect(dicas.every((d) => !d.verificado || /patch notes oficiais|poedb\.tw/.test(d.fonte))).toBe(true);
    }
    expect(dicasDoAto(porNivel, 1).length).toBeGreaterThan(0);
    expect(dicasDoAto(porNivel, 99)).toEqual([]);
  });
});

describe('"Early Game" antes dos atos', () => {
  const plano = planoDe(EARLY_GAME_ANTES_DOS_ATOS);

  it('no começo, gemas e itens são os do "Early Game"; o "Act 5" vem depois', () => {
    expect(gemas(plano, 1, 1)).toEqual({ etapa: "Early Game", proxima: "Act 5", automatica: true });
    const itens = itensDaFase(plano, { nivel: 1, ato: 1 });
    expect([itens.etapa?.titulo, itens.proxima?.titulo]).toEqual(["Early Game", "Act 5"]);
    expect(itens.etapa?.itens.map((i) => i.base)).toContain("Quartz Wand");
  });

  it('no ato 5 entram as gemas e os itens do "Act 5"', () => {
    expect(gemas(plano, 30, 5).etapa).toBe("Act 5");
    expect(etapaDeItens(plano, { nivel: 30, ato: 5 })?.titulo).toBe("Act 5");
  });
});

describe("a árvore manda na fase: gemas e itens viram junto", () => {
  // Build no estilo "Level 12 / Level 26": cada conjunto é como a build deve estar NAQUELE nível.
  const pontos = planoDe({
    conjuntos: [
      { titulo: "Level 12", grupos: [{ gemas: ["Spectral Throw", "Volley Support"] }] },
      { titulo: "Level 26", grupos: [{ gemas: ["Poisonous Concoction", "Volley Support"] }] },
      { titulo: "Level 68", grupos: [{ gemas: ["Poisonous Concoction", "Unbound Ailments Support"] }] },
      { titulo: "Level 82+", grupos: [{ gemas: ["Poisonous Concoction", "Vicious Projectiles Support"] }] },
      { titulo: "Ubers", grupos: [{ gemas: ["Poisonous Concoction", "Culling Strike Support"] }] },
    ],
    arvores: [
      { titulo: "Level 12", nos: 11 },
      { titulo: "Level 26", nos: 25 },
      { titulo: "Level 48", nos: 47 },
      { titulo: "Level 71", nos: 70 },
      { titulo: "Level 92+ - Ubers", nos: 110 },
    ],
    itens: [
      { id: 1, texto: "Rarity: NORMAL\nCorroded Blade" },
      { id: 2, texto: "Rarity: UNIQUE\nPerandus Blazon\nCloth Belt\nLevelReq: 16" },
      { id: 3, texto: "Rarity: RARE\nRandom 5L Evasion Chest\nLeather Hood" },
    ],
    conjuntosDeItens: [
      { titulo: "12", espacos: { "Weapon 1": 1 } },
      { titulo: "50", espacos: { Belt: 2 } },
      { titulo: "72", espacos: { Belt: 2, "Body Armour": 3 } },
      { titulo: "Ubers", espacos: { Belt: 2 } },
    ],
  });
  const gemasEm = (nivel: number, minimo = 0) => {
    const e = etapaDeGemas(pontos, { nivel, ato: 1 }, null, minimo);
    return [e.etapa?.titulo ?? null, e.proxima?.titulo ?? null, e.entra];
  };
  const itensEm = (nivel: number, minimo = 0) => {
    const e = itensDaFase(pontos, { nivel, ato: 1 }, minimo);
    return [e.etapa?.titulo ?? null, e.proxima?.titulo ?? null, e.entra];
  };

  it('"Level 12" vale ATÉ o nível 12: no 12 já entra o "Level 26", como na árvore', () => {
    expect(gemasEm(1)).toEqual(["Level 12", "Level 26", 12]);
    expect(gemasEm(11)).toEqual(["Level 12", "Level 26", 12]);
    expect(gemasEm(12)).toEqual(["Level 26", "Level 68", 26]);
    expect(gemasEm(25)).toEqual(["Level 26", "Level 68", 26]);
    expect(gemasEm(26)).toEqual(["Level 68", "Level 82+", 68]);
    expect(gemasEm(68)).toEqual(["Level 82+", null, null]);
    // O "Ubers" não tem nível: nunca entra sozinho.
    expect(gemasEm(100)).toEqual(["Level 82+", null, null]);
  });

  it('itens "12", "50", "72": cada conjunto vale até o número dele', () => {
    expect(itensEm(1)).toEqual(["12", "50", 12]);
    expect(itensEm(11)).toEqual(["12", "50", 12]);
    expect(itensEm(12)).toEqual(["50", "72", 50]);
    expect(itensEm(49)).toEqual(["50", "72", 50]);
    expect(itensEm(50)).toEqual(["72", null, null]);
    expect(itensEm(95)).toEqual(["72", null, null]);
    expect(etapaDeItens(pontos, { nivel: 30, ato: 3 })?.titulo).toBe("50");
  });

  it("a árvore da etapa ficou pronta antes do nível: gemas e itens viram junto com ela", () => {
    const nivel11 = { nivel: 11, ato: 1 };
    const minimo = arvoreDepoisDe(pontos, arvoreAlvo(pontos, nivel11)!)!;
    expect(arvoreAlvo(pontos, nivel11, minimo)?.titulo).toBe("Level 26");
    expect(faseDaArvore(pontos, nivel11)).toEqual(nivel11);
    expect(faseDaArvore(pontos, nivel11, minimo)).toEqual({ nivel: 12, ato: 1 });
    expect(gemasEm(11, minimo)).toEqual(["Level 26", "Level 68", 26]);
    expect(itensEm(11, minimo)).toEqual(["50", "72", 50]);
    // O nível passa à frente da árvore: vale o nível.
    expect(faseDaArvore(pontos, { nivel: 30, ato: 3 }, minimo)).toEqual({ nivel: 30, ato: 3 });
  });

  it("conjunto fixado à mão continua valendo, com o próximo dele", () => {
    const e = etapaDeGemas(pontos, { nivel: 5, ato: 1 }, "g3");
    expect([e.etapa?.titulo, e.automatica, e.proxima?.titulo, e.entra]).toEqual(["Level 68", false, "Level 82+", 68]);
    const ubers = etapaDeGemas(pontos, { nivel: 5, ato: 1 }, "g5");
    expect([ubers.etapa?.titulo, ubers.proxima, ubers.entra]).toEqual(["Ubers", null, null]);
  });

  it("conjuntos na ordem em que o guia passa por eles, com o nível em que entram; Ubers no fim", () => {
    const ordem = conjuntosEmOrdem(pontos).map((c) => [c.etapa.titulo, c.nivel]);
    expect(ordem).toEqual([
      ["Level 12", 1],
      ["Level 26", 12],
      ["Level 68", 26],
      ["Level 82+", 68],
      ["Ubers", null],
    ]);
    // Cada conjunto aparece uma vez só, em qualquer formato de PoB.
    for (const plano of [pontos, porNivel, porAto]) {
      const etapas = conjuntosEmOrdem(plano).map((c) => c.etapa);
      expect(new Set(etapas).size).toBe(plano.gemas.etapas.length);
      expect(etapas).toHaveLength(plano.gemas.etapas.length);
    }
  });

  it('lista que começa no "Level 1" é "a partir de": o conjunto vale do nível dele em diante', () => {
    const aPartir = planoDe({
      conjuntos: [
        { titulo: "Level 1", grupos: [{ gemas: ["Spectral Throw"] }] },
        { titulo: "Level 12", grupos: [{ gemas: ["Poisonous Concoction"] }] },
      ],
    });
    const em = (nivel: number) => etapaDeGemas(aPartir, { nivel, ato: 1 }, null).etapa?.titulo;
    expect(em(5)).toBe("Level 1");
    expect(em(11)).toBe("Level 1");
    expect(em(12)).toBe("Level 12");
  });

  it("faixas de nível continuam trocando no começo da faixa, e a árvore também puxa", () => {
    // POR_NIVEL: gemas "Level 1 - 4", "Level 4 - 12", "Level 12 - 38"...; árvore "Level 12", "Level 32 - Normal Lab"...
    const nivel11 = { nivel: 11, ato: 1 };
    const minimo = arvoreDepoisDe(porNivel, arvoreAlvo(porNivel, nivel11)!)!;
    expect(etapaDeGemas(porNivel, nivel11, null).etapa?.titulo).toBe("Level 4 - 12");
    expect(etapaDeGemas(porNivel, nivel11, null, minimo).etapa?.titulo).toBe("Level 12 - 38");
  });
});

describe("cada build rotula de um jeito", () => {
  const ITENS = [
    { id: 1, texto: "Rarity: NORMAL\nCorroded Blade" },
    { id: 2, texto: "Rarity: UNIQUE\nPerandus Blazon\nCloth Belt\nLevelReq: 16" },
  ];
  const gemas = (plano: Plano, nivel: number, ato = 1, minimo = 0) => {
    const e = etapaDeGemas(plano, { nivel, ato }, null, minimo);
    return [e.etapa?.titulo ?? null, e.proxima?.titulo ?? null, e.entra];
  };
  const itens = (plano: Plano, nivel: number, ato = 1) => {
    const e = itensDaFase(plano, { nivel, ato });
    return [e.etapa?.titulo ?? null, e.proxima?.titulo ?? null, e.entra];
  };

  it("um conjunto só, sem título: vale sempre (gemas e itens)", () => {
    const plano = planoDe({
      conjuntos: [{ titulo: "", grupos: [{ gemas: ["Spectral Throw", "Volley Support"] }] }],
      itens: ITENS,
      conjuntosDeItens: [{ titulo: "Default", espacos: { "Weapon 1": 1, Belt: 2 } }],
    });
    for (const nivel of [1, 30, 90]) {
      expect(gemas(plano, nivel)).toEqual(["", null, null]);
      expect(itens(plano, nivel)).toEqual(["Default", null, null]);
    }
  });

  it("um conjunto só, com nível: vale do começo ao fim", () => {
    const plano = planoDe({
      conjuntos: [{ titulo: "Level 12", grupos: [{ gemas: ["Spectral Throw"] }] }],
      itens: ITENS,
      conjuntosDeItens: [{ titulo: "50", espacos: { Belt: 2 } }],
    });
    for (const nivel of [1, 12, 60]) {
      expect(gemas(plano, nivel)).toEqual(["Level 12", null, null]);
      expect(itens(plano, nivel)).toEqual(["50", null, null]);
    }
  });

  it("vários conjuntos de itens sem rótulo: o primeiro que não é de fim de jogo", () => {
    const plano = planoDe({
      conjuntos: [{ titulo: "", grupos: [{ gemas: ["Spectral Throw"] }] }],
      itens: ITENS,
      conjuntosDeItens: [
        { titulo: "Endgame {2}", espacos: { Belt: 2 } },
        { titulo: "Default", espacos: { "Weapon 1": 1 } },
      ],
    });
    expect(itens(plano, 5)).toEqual(["Default", null, null]);
    const soFimDeJogo = planoDe({
      conjuntos: [{ titulo: "", grupos: [{ gemas: ["Spectral Throw"] }] }],
      itens: ITENS,
      conjuntosDeItens: [
        { titulo: "Early Game {1}", espacos: { "Weapon 1": 1 } },
        { titulo: "Endgame {2}", espacos: { Belt: 2 } },
      ],
    });
    expect(itens(soFimDeJogo, 5)).toEqual(["Early Game", null, null]);
  });

  it('duas faixas ("1-11" e "11-60"): troca no 11, e a árvore pronta antes puxa junto', () => {
    const plano = planoDe({
      conjuntos: [
        { titulo: "Level 1 - 11", grupos: [{ gemas: ["Spectral Throw"] }] },
        { titulo: "Level 11 - 60", grupos: [{ gemas: ["Poisonous Concoction"] }] },
      ],
      arvores: [
        { titulo: "Level 1 - 11", nos: 10 },
        { titulo: "Level 11 - 60", nos: 59 },
      ],
      itens: ITENS,
      conjuntosDeItens: [
        { titulo: "1-11", espacos: { "Weapon 1": 1 } },
        { titulo: "11-60", espacos: { Belt: 2 } },
      ],
    });
    expect(gemas(plano, 1)).toEqual(["Level 1 - 11", "Level 11 - 60", 11]);
    expect(gemas(plano, 10)).toEqual(["Level 1 - 11", "Level 11 - 60", 11]);
    expect(gemas(plano, 11)).toEqual(["Level 11 - 60", null, null]);
    expect(gemas(plano, 80)).toEqual(["Level 11 - 60", null, null]);
    expect(itens(plano, 10)).toEqual(["1-11", "11-60", 11]);
    expect(itens(plano, 11)).toEqual(["11-60", null, null]);

    const nivel8 = { nivel: 8, ato: 1 };
    const minimo = arvoreDepoisDe(plano, arvoreAlvo(plano, nivel8)!)!;
    expect(arvoreAlvo(plano, nivel8, minimo)?.titulo).toBe("Level 11 - 60");
    expect(gemas(plano, 8, 1, minimo)).toEqual(["Level 11 - 60", null, null]);
  });

  it('mistura de faixa e nível solto ("Level 1 - 11", "Level 60")', () => {
    const plano = planoDe({
      conjuntos: [
        { titulo: "Level 1 - 11", grupos: [{ gemas: ["Spectral Throw"] }] },
        { titulo: "Level 60", grupos: [{ gemas: ["Poisonous Concoction"] }] },
      ],
    });
    expect(gemas(plano, 5)).toEqual(["Level 1 - 11", "Level 60", 11]);
    expect(gemas(plano, 11)).toEqual(["Level 60", null, null]);
    expect(gemas(plano, 70)).toEqual(["Level 60", null, null]);
  });

  it("por ato: a árvore do ato pronta antes leva gemas pro ato seguinte", () => {
    // POR_ATO: gemas "Pre-Sunder", "Act 1", "Act 2", "Act 6+"...; árvore "Act 1", "Act 2", "Act 6+"...
    const ato1 = { nivel: 13, ato: 1 };
    const minimo = arvoreDepoisDe(porAto, arvoreAlvo(porAto, ato1)!)!;
    expect(arvoreAlvo(porAto, ato1, minimo)?.titulo).toBe("Act 2");
    expect(faseDaArvore(porAto, ato1, minimo)).toEqual({ nivel: 13, ato: 2 });
    expect(etapaDeGemas(porAto, ato1, null).etapa?.titulo).toBe("Act 1");
    expect(etapaDeGemas(porAto, ato1, null, minimo).etapa?.titulo).toBe("Act 2");
    // Sem árvore pronta, a fase é a do personagem.
    expect(faseDaArvore(porAto, { nivel: 20, ato: 3 })).toEqual({ nivel: 20, ato: 3 });
  });
});
