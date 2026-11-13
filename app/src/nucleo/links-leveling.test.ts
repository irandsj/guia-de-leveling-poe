import { describe, expect, it } from "vitest";

import { linksDoLeveling, linksNoNivel, proximaMudanca, usarLinksDoLeveling } from "./links-leveling";
import type { EtapaDeGemas, GemaDoPlano, GrupoDoPlano } from "./plano";

function gema(nome: string, nivel: number, suporte = false): GemaDoPlano {
  return {
    gem_id: `Metadata/Items/Gems/${nome.replace(/\W/g, "")}`,
    skill_id: null,
    nome,
    suporte,
    cor: "intelligence",
    nivel_req: nivel,
    quantidade: 1,
    conhecida: true,
  };
}

function grupo(rotulo: string, gemas: GemaDoPlano[], principal = false): GrupoDoPlano {
  return { rotulo, principal, gemas };
}

// Parecido com o "Low Budget End-Game" do Raise Spectre Necromancer (só conjuntos de endgame).
function endgame(): EtapaDeGemas {
  return {
    id: "g1",
    titulo: "Low Budget End-Game",
    nivel_min: null,
    nivel_max: null,
    ato_min: null,
    ato_max: null,
    estimativa: null,
    inicial: false,
    fim_de_jogo: true,
    chave: null,
    origem: { tipo: "SkillSet", id: "1" },
    nivel_gatilho: null,
    mudancas: { novas: [], sairam: [], trocas: [] },
    grupos: [
      grupo("==== Main Skills ====", []),
      grupo(
        "6L Spectres",
        [
          gema("Raise Spectre", 28),
          gema("Spell Echo Support", 38, true),
          gema("Volley Support", 4, true),
          gema("Minion Damage Support", 8, true),
          gema("Controlled Destruction Support", 18, true),
          gema("Hypothermia Support", 31, true),
        ],
        true,
      ),
      grupo("4L FF Golem/Zombie", [
        gema("Feeding Frenzy Support", 31, true),
        gema("Raise Zombie", 1),
        gema("Summon Stone Golem", 34),
        gema("Elemental Army Support", 31, true),
      ]),
      grupo("2L Trigger", [gema("Desecrate", 16), gema("Bone Offering", 12)]),
      grupo("3L Mobility", [gema("Shield Charge", 4), gema("Frostblink", 4), gema("Lifetap Support", 8, true)]),
      grupo("1S Curse", [gema("Frostbite", 24)]),
    ],
  };
}

describe("links do leveling a partir de um PoB só de endgame", () => {
  it("troca o conjunto de endgame só durante a campanha e sem conjunto fixado à mão", () => {
    const etapa = endgame();
    expect(usarLinksDoLeveling(etapa, 10, true)).toBe(true);
    expect(usarLinksDoLeveling(etapa, 10, false)).toBe(false);
    expect(usarLinksDoLeveling(etapa, 70, true)).toBe(false);
    expect(usarLinksDoLeveling({ ...etapa, estimativa: 12, fim_de_jogo: false }, 10, true)).toBe(false);
    expect(usarLinksDoLeveling(null, 10, true)).toBe(false);
  });

  it("no nível 1 só mostra o que já existe: nada de Raise Spectre", () => {
    const l = linksDoLeveling(endgame(), 1);
    expect(l.links.map((x) => [x.habilidade.nome, x.suportes.length, x.ate?.nome])).toEqual([
      ["Raise Zombie", 0, "Raise Spectre"],
    ]);
    expect(l.soltas).toEqual([]);
  });

  it("até a principal chegar, o minion que já existe usa os suportes de minion do conjunto", () => {
    const l = linksDoLeveling(endgame(), 10);
    expect(l.links.map((x) => [x.habilidade.nome, ...x.suportes.map((s) => s.nome)])).toEqual([
      ["Raise Zombie", "Minion Damage Support"],
      ["Shield Charge", "Lifetap Support"],
    ]);
    expect(l.links[0]).toMatchObject({ principal: true, ate: { nome: "Raise Spectre", nivel: 28 } });
    expect(l.soltas.map((g) => g.nome)).toEqual(["Frostblink"]);
  });

  it("build que não é de minion não ganha link inventado", () => {
    const etapa = endgame();
    etapa.grupos[1].gemas[0] = gema("Arc", 12);
    const l = linksDoLeveling(etapa, 10);
    expect(l.links.every((x) => x.ate === null)).toBe(true);
    expect(l.soltas.map((g) => g.nome)).toContain("Raise Zombie");
  });

  it("quando a principal chega, ela vem primeiro e respeita o limite de links", () => {
    const l = linksDoLeveling(endgame(), 30);
    expect(linksNoNivel(30)).toBe(4);
    expect(l.links[0]).toMatchObject({ principal: true, ate: null });
    expect([l.links[0].habilidade.nome, ...l.links[0].suportes.map((s) => s.nome)]).toEqual([
      "Raise Spectre",
      "Volley Support",
      "Minion Damage Support",
      "Controlled Destruction Support",
    ]);
    expect(l.soltas.map((g) => g.nome)).toContain("Frostbite");
  });

  it("antes do nível 12 o link tem no máximo 3 gemas", () => {
    const etapa = endgame();
    etapa.grupos[1].gemas[0] = gema("Raise Spectre", 1);
    const l = linksDoLeveling(etapa, 10);
    expect(l.links[0].suportes.map((s) => s.nome)).toEqual(["Volley Support", "Minion Damage Support"]);
  });

  it("avisa o próximo nível em que entra gema nova", () => {
    expect(proximaMudanca(endgame(), 1)).toEqual({ nivel: 4, gemas: ["Frostblink", "Shield Charge"] });
    expect(proximaMudanca(endgame(), 27)).toEqual({
      nivel: 28,
      gemas: ["Raise Spectre", "Volley Support", "Controlled Destruction Support"],
    });
  });
});
