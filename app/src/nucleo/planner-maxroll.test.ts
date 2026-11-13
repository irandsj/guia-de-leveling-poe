import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { arvoreAlvo, etapaDeGemas } from "./conjuntos";
import { montarPlano, type Plano } from "./plano";
import { efeitosDeMaestria, lerPlannerMaxroll, SEM_MAESTRIAS, type PlannerLido } from "./planner-maxroll";
import type { Pob } from "./pob";

const AQUI = dirname(fileURLToPath(import.meta.url));
const URL_DO_PLANNER = "https://maxroll.gg/poe/planner/hhea800t";
const EFEITO = efeitosDeMaestria(JSON.parse(readFileSync(resolve(AQUI, "../dados/arvore/arvore.json"), "utf8")));

function fixture(nome: string): string {
  return readFileSync(resolve(AQUI, "teste/maxroll", nome), "utf8");
}

/** Bloco de guia (Witch de leveling): etapas de gemas por faixa de nível, uma árvore só, sem itens. */
const WITCH = fixture("planner-hhea800t.json");
/** Planner com perfis (Boneshatter): campanha, mapas e fim de jogo, com itens. */
const BONESHATTER = fixture("planner-a89ts0q6.json");

function ler(resposta: string): PlannerLido {
  return lerPlannerMaxroll(resposta, EFEITO, URL_DO_PLANNER);
}

function plano(pob: Pob): Plano {
  return montarPlano(pob, { url: URL_DO_PLANNER, id: "x", site: "Maxroll (planner)", hash_codigo: "h" }, new Date(0));
}

/** Quantos efeitos de maestria a árvore escolheu ("{no,id},{no,id}" no texto do PoB). */
function maestrias(texto: string): [number, number][] {
  return [...texto.matchAll(/\{(\d+),(\d+)\}/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

/** Planner de mentira, no formato da resposta de planners.maxroll.gg. */
function plannerDeMentira(perfil: Record<string, unknown>, fora: Record<string, unknown> = {}): string {
  const dados = { profiles: [{ id: "p1", name: "Campaign", class: "Str", ...perfil }], items: {} };
  return JSON.stringify({ id: "abc12345", class: "", data: JSON.stringify(dados), type: "planner", game: "poe", ...fora });
}

/** Histórico de cliques com `n` nós (ids 1..n). */
function cliques(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i + 1);
}

describe("lerPlannerMaxroll: bloco de guia (embed)", () => {
  const { pob, avisos } = ler(WITCH);

  it("classe e etapas de gemas com os títulos do guia", () => {
    expect(pob.classe).toBe("Witch");
    expect(pob.ascendencia).toBeNull();
    expect(pob.conjuntosGemas.map((c) => c.titulo)).toEqual([
      "Level 1 - 12",
      "Level 12 - 28",
      "Level 28 - 38",
      "Level 38+",
    ]);
    expect(pob.conjuntoGemasAtivo).toBe("4");
    expect(pob.conjuntosItens).toEqual([]);
  });

  it("acha cada gema nos dados pelo id do planner (suporte e ativa)", () => {
    const primeiro = pob.conjuntosGemas[0].grupos[0];
    expect(primeiro.gemas.map((g) => g.nome)).toEqual([
      "Rolling Magma",
      "Elemental Proliferation Support",
      "Combustion Support",
    ]);
    expect(primeiro.gemas.map((g) => g.skillId)).toEqual([
      "RollingMagma",
      "SupportElementalProliferation",
      "SupportCombustion",
    ]);
    const todas = pob.conjuntosGemas.flatMap((c) => c.grupos.flatMap((g) => g.gemas));
    expect(todas.filter((g) => g.gemId === null).map((g) => g.skillId)).toEqual([]);
  });

  it("a árvore de leveling vira etapas de nível, na ordem dos cliques", () => {
    const titulos = pob.arvores.map((a) => a.titulo);
    expect(titulos[0]).toBe("Level 7 (8 points)");
    expect(titulos[titulos.length - 1]).toBe("Level 61 (80 points)");
    for (const t of titulos) expect(t).toMatch(/^Level \d+ \(\d+ points\)$/);
    const tamanhos = pob.arvores.map((a) => a.nos.length);
    expect(tamanhos).toEqual([...tamanhos].sort((a, b) => a - b));
    expect(new Set(tamanhos).size).toBe(tamanhos.length);
    for (const a of pob.arvores) {
      expect(a.versao).toBe("3_25");
      expect(a.url).toBe(URL_DO_PLANNER);
    }
    expect(pob.arvoreAtiva).toBe(pob.arvores.length - 1);
  });

  it("as maestrias entram só quando o nó já está na etapa", () => {
    expect(maestrias(pob.arvores[0].maestrias)).toEqual([]);
    const ultima = pob.arvores[pob.arvores.length - 1];
    const escolhidas = maestrias(ultima.maestrias);
    expect(escolhidas).toHaveLength(6);
    for (const [no] of escolhidas) expect(ultima.nos).toContain(no);
    for (const a of pob.arvores) for (const [no] of maestrias(a.maestrias)) expect(a.nos).toContain(no);
  });

  it("avisa das árvores alternativas e das ascendências do guia", () => {
    expect(avisos).toHaveLength(2);
    expect(avisos[0]).toMatch(/^O guia tem 3 árvores .*: o guia segue a primeira\.$/);
    expect(avisos[1]).toBe(
      "O guia mostra mais de uma ascendência (Occultist, Elementalist, Necromancer): escolha a sua no laboratório.",
    );
  });

  it("sem o arquivo da árvore, entra sem as maestrias", () => {
    const sem = lerPlannerMaxroll(WITCH, SEM_MAESTRIAS);
    expect(sem.pob.arvores.map((a) => a.nos.length)).toEqual(pob.arvores.map((a) => a.nos.length));
    for (const a of sem.pob.arvores) expect(a.maestrias).toBe("");
  });
});

describe("lerPlannerMaxroll: planner com perfis", () => {
  const { pob, avisos } = ler(BONESHATTER);

  it("classe, ascendência, nível, bandido e panteão do primeiro perfil", () => {
    expect(pob.classe).toBe("Marauder");
    expect(pob.ascendencia).toBe("Juggernaut");
    expect(pob.nivel).toBe(98);
    expect(pob.bandido).toBe("None");
    expect(pob.panteaoMaior).toBe("Lunaris");
    expect(pob.panteaoMenor).toBe("Garukhan");
    expect(avisos).toEqual([]);
  });

  it("gemas de todos os perfis, sem repetir título, com o espaço do item", () => {
    expect(pob.conjuntosGemas.map((c) => c.titulo)).toEqual([
      "Level 1 - 4",
      "Level 4 - 12",
      "Level 12 - 16",
      "Level 16 - 24",
      "Level 24 - 38",
      "Level 38 - Maps",
      "Early Game",
      "Endgame",
    ]);
    const fimDeJogo = pob.conjuntosGemas[pob.conjuntosGemas.length - 1];
    expect(fimDeJogo.grupos[0].slot).toBe("Body Armour");
    expect(fimDeJogo.grupos[0].gemas.map((g) => g.nome)).toContain("Boneshatter");
  });

  it("gema que não está nos dados entra com o nome legível", () => {
    const todas = pob.conjuntosGemas.flatMap((c) => c.grupos.flatMap((g) => g.gemas));
    const desconhecidas = todas.filter((g) => g.gemId === null);
    expect([...new Set(desconhecidas.map((g) => g.nome))]).toEqual(["Quick Guard"]);
  });

  it("corta a árvore de leveling e mantém as de mapas e fim de jogo inteiras", () => {
    const titulos = pob.arvores.map((a) => a.titulo);
    const cortadas = titulos.filter((t) => /^Level \d+ \(\d+ points\)$/.test(t));
    expect(cortadas).toHaveLength(10);
    expect(cortadas[0]).toBe("Level 8 (10 points)");
    expect(titulos.slice(cortadas.length)).toEqual([
      "Early Game",
      "Midgame",
      "Late Maps",
      "Endgame - Corrupted Soul",
      "Endgame - Delirious Bloodline",
    ]);
    for (const a of pob.arvores) expect(a.versao).toBe("3_29");
    expect(maestrias(pob.arvores[titulos.indexOf("Late Maps")].maestrias)).toHaveLength(12);
  });

  it("conjuntos de itens com raridade e nome; o ativo é o último", () => {
    expect(pob.conjuntosItens.map((c) => c.titulo)).toEqual(["Early Game", "Midgame", "Endgame"]);
    expect(pob.conjuntoItensAtivo).toBe(pob.conjuntosItens[2].id);
    const fimDeJogo = pob.conjuntosItens[2];
    const cinto = fimDeJogo.espacos.find((e) => e.nome === "Belt");
    expect(cinto).toBeDefined();
    expect(pob.itens[cinto!.itemId]).toMatchObject({ raridade: "UNIQUE", nome: "Ryslatha's Coil" });
    expect(fimDeJogo.espacos.map((e) => e.nome)).toEqual(expect.arrayContaining(["Weapon 1", "Helmet", "Ring 2", "Flask 1"]));
  });
});

describe("plano do planner: troca gemas e árvore por etapa", () => {
  it("Witch: as gemas viram nas faixas do guia e a árvore cresce com o nível", () => {
    const p = plano(ler(WITCH).pob);
    const gemas = (nivel: number, ato: number) => etapaDeGemas(p, { nivel, ato }, null).etapa?.titulo;
    expect(gemas(1, 1)).toBe("Level 1 - 12");
    expect(gemas(13, 2)).toBe("Level 12 - 28");
    expect(gemas(30, 5)).toBe("Level 28 - 38");
    expect(gemas(40, 7)).toBe("Level 38+");

    const arvore = (nivel: number, ato: number) => arvoreAlvo(p, { nivel, ato });
    expect(arvore(1, 1)?.titulo).toBe("Level 7 (8 points)");
    const pontos = [1, 10, 20, 30, 40, 55, 65].map((n, i) => arvore(n, Math.min(10, i + 1))?.nos.length ?? 0);
    expect(pontos).toEqual([...pontos].sort((a, b) => a - b));
    expect(pontos[0]).toBeLessThan(pontos[pontos.length - 1]);
    // Cada etapa da árvore cortada entra no nível em que o personagem tem aqueles pontos.
    for (const e of p.arvore.etapas) {
      const [, nivel] = /^Level (\d+)/.exec(e.titulo) ?? [];
      expect(e.nivel_min).toBe(Number(nivel));
      expect(e.fim_de_jogo).toBe(false);
    }
  });

  it("Boneshatter: leveling por nível, mapas e fim de jogo depois", () => {
    const p = plano(ler(BONESHATTER).pob);
    const gemas = (nivel: number, ato: number) => etapaDeGemas(p, { nivel, ato }, null).etapa?.titulo;
    expect(gemas(1, 1)).toBe("Level 1 - 4");
    expect(gemas(5, 1)).toBe("Level 4 - 12");
    expect(gemas(13, 2)).toBe("Level 12 - 16");
    expect(gemas(20, 3)).toBe("Level 16 - 24");
    expect(gemas(30, 5)).toBe("Level 24 - 38");
    expect(gemas(40, 7)).toBe("Level 38 - Maps");
    expect(p.gemas.etapas.find((e) => e.titulo === "Endgame")?.fim_de_jogo).toBe(true);

    expect(arvoreAlvo(p, { nivel: 1, ato: 1 })?.titulo).toBe("Level 8 (10 points)");
    expect(arvoreAlvo(p, { nivel: 13, ato: 2 })?.titulo).toBe("Level 16 (20 points)");
    expect(arvoreAlvo(p, { nivel: 40, ato: 7 })?.titulo).toBe("Level 43 (56 points)");
    expect(p.personagem).toMatchObject({ classe: "Marauder", ascendencia: "Juggernaut" });
    expect(p.avisos).toEqual([
      "Gemas que não estão nos nossos dados (novas na liga?): Quick Guard. O guia não sabe onde pegá-las.",
    ]);
  });
});

describe("lerPlannerMaxroll: casos de borda", () => {
  const GEMAS = { steps: [{ name: "Level 1 - 12", skills: [{ gems: [{ id: "GroundSlam" }, { id: "SupportRuthless" }] }] }] };

  it("perfil simples: bandido, panteão, versão 3.30 e gema inventada", () => {
    const { pob } = ler(
      plannerDeMentira({
        ascendancy: "Chieftain",
        level: 90,
        bandits: "Alira",
        pantheon: { Solaris: [true], Ralakesh: [true, false] },
        skills: {
          steps: [{ name: "Level 1 - 12", skills: [{ gems: [{ id: "GroundSlam" }, { id: "SupportCoisaNovaDaLiga" }] }] }],
        },
        passives: { variants: [{ name: "Leveling", version: 3300, history: cliques(20), masteries: {} }] },
      }),
    );
    expect(pob.classe).toBe("Marauder");
    expect(pob.ascendencia).toBe("Chieftain");
    expect(pob.bandido).toBe("Alira");
    expect(pob.panteaoMaior).toBe("Solaris");
    expect(pob.panteaoMenor).toBe("Ralakesh");
    const [slam, nova] = pob.conjuntosGemas[0].grupos[0].gemas;
    expect(slam.nome).toBe("Ground Slam");
    expect(slam.gemId).not.toBeNull();
    expect(nova).toMatchObject({ gemId: null, nome: "Coisa Nova Da Liga Support" });
    expect(pob.arvores.map((a) => a.titulo)).toEqual(["Level 7 (8 points)", "Level 13 (16 points)", "Level 16 (20 points)"]);
    expect(pob.arvores[0].versao).toBe("3_30");
  });

  it("o respec (`remove`) tira os nós da etapa", () => {
    const { pob } = ler(
      plannerDeMentira({
        skills: GEMAS,
        passives: {
          variants: [{ name: "Leveling", version: 3300, history: [...cliques(16), { add: [100], remove: [1, 2] }] }],
        },
      }),
    );
    const ultima = pob.arvores[pob.arvores.length - 1];
    expect(ultima.nos).toContain(100);
    expect(ultima.nos).not.toContain(1);
    expect(ultima.nos).not.toContain(2);
  });

  it("as etapas cortadas param antes da árvore de mapas", () => {
    const comMapas = ler(
      plannerDeMentira({
        skills: GEMAS,
        passives: {
          variants: [
            { name: "Leveling", version: 3300, history: cliques(100) },
            { name: "Early Maps", version: 3300, history: cliques(110) },
          ],
        },
      }),
    ).pob;
    const titulos = comMapas.arvores.map((a) => a.titulo);
    expect(titulos[titulos.length - 1]).toBe("Early Maps");
    const niveis = titulos.slice(0, -1).map((t) => Number(/^Level (\d+)/.exec(t)?.[1]));
    expect(Math.max(...niveis)).toBeLessThan(68);

    const semMapas = ler(
      plannerDeMentira({ skills: GEMAS, passives: { variants: [{ name: "Leveling", version: 3300, history: cliques(100) }] } }),
    ).pob;
    expect(semMapas.arvores[semMapas.arvores.length - 1].nos).toHaveLength(100);
  });

  it("árvore já com título de nível não é cortada", () => {
    const { pob } = ler(
      plannerDeMentira({
        skills: GEMAS,
        passives: {
          variants: [
            { name: "Level 12", version: 3300, history: cliques(11) },
            { name: "Level 30", version: 3300, history: cliques(38) },
          ],
        },
      }),
    );
    expect(pob.arvores.map((a) => a.titulo)).toEqual(["Level 12", "Level 30"]);
  });

  it("perfil com chaves de loadout vale sozinho", () => {
    const dados = {
      profiles: [
        { id: "a", name: "Campaign", class: "Str", skills: GEMAS },
        {
          id: "b",
          name: "Tudo junto",
          class: "Dex",
          skills: {
            steps: [
              { name: "Act 1{1}", skills: [{ gems: [{ id: "SplitArrow" }] }] },
              { name: "Act 2{2}", skills: [{ gems: [{ id: "LightningArrow" }] }] },
            ],
          },
        },
      ],
    };
    const { pob } = ler(JSON.stringify({ id: "x", data: JSON.stringify(dados), type: "planner", game: "poe" }));
    expect(pob.classe).toBe("Ranger");
    expect(pob.conjuntosGemas.map((c) => c.titulo)).toEqual(["Act 1{1}", "Act 2{2}"]);
  });

  it("o `data` já como objeto (o planner que vem dentro da página do guia)", () => {
    const dados = { profiles: [{ id: "p1", name: "Campaign", class: "Int", skills: GEMAS }] };
    expect(ler(JSON.stringify({ id: "x", data: dados, game: "poe" })).pob.classe).toBe("Witch");
  });

  it("erros com a mensagem pronta pra mostrar", () => {
    expect(() => ler("<!DOCTYPE html><html>")).toThrow(/não respondeu com os dados da build/);
    expect(() => ler(plannerDeMentira({ skills: GEMAS }, { game: "poe2" }))).toThrow(/Path of Exile 2/);
    expect(() => ler(JSON.stringify({ id: "x", game: "poe" }))).toThrow(/sem os dados da build/);
    expect(() => ler(JSON.stringify({ id: "x", data: "{}", game: "poe" }))).toThrow(/veio vazio/);
    expect(() => ler(plannerDeMentira({ class: "", skills: GEMAS }))).toThrow(/não diz a classe/);
    expect(() => ler(plannerDeMentira({}))).toThrow(/não tem gemas nem árvore/);
    expect(() => ler("x".repeat(3 * 1024 * 1024 + 1))).toThrow(/grande demais/);
  });
});
