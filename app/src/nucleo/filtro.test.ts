import { describe, expect, it } from "vitest";

import type { TabelaDeArtes } from "./artes-itens";
import {
  filtroDaBuild,
  filtroErrado,
  limparNome,
  nomeDoFiltro,
  resumoDoFiltro,
  temOQueDestacar,
  textoDoFiltroErrado,
  tituloDoFiltro,
  ULTIMA_AREA_DA_CAMPANHA,
} from "./filtro";
import type { EtapaDeGemas, EtapaDeItens, GemaDoPlano, ItemDoPlano, Plano } from "./plano";

const TABELA: TabelaDeArtes = {
  bases: {
    "Leather Cap": "a",
    "Iron Ring": "b",
    "Divine Life Flask": "c",
    "Life Flask": "d",
    "Short Bow": "e",
  },
  unicos: {},
};

function gema(nome: string, cor: string, conhecida = true): GemaDoPlano {
  return { gem_id: null, skill_id: null, nome, suporte: false, cor, nivel_req: null, quantidade: 1, conhecida };
}

function etapaDeGemas(fimDeJogo: boolean, ...grupos: GemaDoPlano[][]): EtapaDeGemas {
  return {
    fim_de_jogo: fimDeJogo,
    grupos: grupos.map((gemas, i) => ({ rotulo: "", principal: i === 0, gemas })),
  } as EtapaDeGemas;
}

function item(nome: string, base: string, raridade: string): ItemDoPlano {
  return { espaco: "", nome, base, raridade, nivel_req: null };
}

function plano(gemas: EtapaDeGemas[], itens: ItemDoPlano[], fimDeJogo: ItemDoPlano[] = []): Plano {
  return {
    fonte: { titulo: "Ranger\nde Spectral Throw" },
    gemas: { etapas: gemas },
    itens: {
      etapas: [{ fim_de_jogo: false, itens } as EtapaDeItens, { fim_de_jogo: true, itens: fimDeJogo } as EtapaDeItens],
      unicos_desejados: [],
    },
  } as unknown as Plano;
}

describe("filtroDaBuild", () => {
  const p = plano(
    [
      etapaDeGemas(false, [gema("Spectral Throw", "dexterity"), gema("Onslaught Support", "dexterity"), gema("Ancestral Call Support", "strength")]),
      etapaDeGemas(
        false,
        [
          gema("Spectral Throw", "dexterity"),
          gema("Volley Support", "dexterity"),
          gema("Inspiration Support", "strength"),
          gema("Arcane Surge Support", "intelligence"),
          gema("Gema Inventada", "dexterity", false),
        ],
        [gema("Frostblink", "intelligence")],
      ),
      etapaDeGemas(true, [gema("Gema do Fim", "strength"), gema("Outra do Fim", "strength"), gema("Mais Uma", "strength")]),
    ],
    [
      item("Goldrim", "Leather Cap", "UNIQUE"),
      item("Seething Divine Life Flask of Staunching", "", "MAGIC"),
      item("Doom Loop", "Iron Ring", "RARE"),
      item("Raro Sem Base", "", "RARE"),
      item("Arco \"estranho\"", "Short \"Bow\"", "RARE"),
    ],
    [item("Fim de Jogo", "Short Bow", "RARE")],
  );
  const filtro = filtroDaBuild(p, TABELA);

  it("pega bases, únicos, links e gemas só da campanha", () => {
    expect(filtro.unicos).toEqual(["Leather Cap"]);
    expect(filtro.bases).toEqual(["Divine Life Flask", "Iron Ring"]);
    expect(filtro.links).toEqual(["RGGB", "RGG"]);
    expect(filtro.gemas).toEqual([
      "Spectral Throw",
      "Onslaught Support",
      "Ancestral Call Support",
      "Volley Support",
      "Inspiration Support",
      "Arcane Surge Support",
      "Frostblink",
    ]);
  });

  it("escreve blocos que só valem na campanha, o link maior antes", () => {
    const blocos = filtro.texto.split("\n\n").filter((b) => b.startsWith("Show"));
    expect(blocos).toHaveLength(6);
    for (const bloco of blocos) expect(bloco).toContain(`\tAreaLevel <= ${ULTIMA_AREA_DA_CAMPANHA}`);
    const texto = filtro.texto;
    expect(texto.indexOf('SocketGroup "RGGB"')).toBeLessThan(texto.indexOf('SocketGroup "RGG"'));
    expect(texto).toContain('\tBaseType == "Divine Life Flask" "Iron Ring"\n');
    expect(texto).toContain("\tRarity Unique\n\tBaseType == \"Leather Cap\"\n");
    expect(texto).toContain('\tHasExplicitMod "Runner\'s" "Sprinter\'s" "Stallion\'s" "Gazelle\'s" "Cheetah\'s" "Hellion\'s"\n');
    expect(texto).toContain('# Guia de leveling: destaques da build "Ranger de Spectral Throw".');
    expect(texto).not.toContain("Gema Inventada");
    expect(texto).not.toContain("estranho");
  });

  it("build sem itens nem gemas ainda destaca as botas", () => {
    const vazio = filtroDaBuild(plano([], []), TABELA);
    expect(vazio.texto).toContain("botas com movimento");
    expect(vazio.texto).not.toContain("BaseType");
    expect(resumoDoFiltro(vazio)).toBe("botas com movimento");
  });

  it("resume o que destaca", () => {
    expect(resumoDoFiltro(filtro)).toBe("1 único, links RGGB, RGG, botas com movimento, 2 bases de item, 7 gemas");
  });
});

describe("nome do filtro novo", () => {
  const comPersonagem = (classe: string, ascendencia: string | null) =>
    ({ personagem: { classe, ascendencia } }) as unknown as Plano;

  it("é a ascendência (ou a classe) e o nome do programa", () => {
    expect(nomeDoFiltro(comPersonagem("Witch", "Elementalist"))).toBe("Elementalist Leveling");
    expect(nomeDoFiltro(comPersonagem("Witch", null))).toBe("Witch Leveling");
    expect(nomeDoFiltro(comPersonagem("", null))).toBe("Build Leveling");
  });

  it("vira um nome de arquivo que o Windows aceita", () => {
    expect(limparNome('  A/B\\C:*?"<>|  d  ')).toBe("ABC d");
    expect(limparNome("Meu filtro.filter")).toBe("Meu filtro");
    expect(limparNome("..x..")).toBe("x");
    expect(limparNome("x".repeat(80))).toHaveLength(60);
    // Tab e quebra de linha (caracteres de controle) saem.
    expect(limparNome("a\tb\nc")).toBe("abc");
  });

  it("toda build tem o que destacar (as gemas, os links ou as bases)", () => {
    expect(temOQueDestacar({ texto: "", bases: [], links: [], gemas: [], unicos: [] })).toBe(false);
    expect(temOQueDestacar({ texto: "", bases: [], links: [], gemas: ["Fireball"], unicos: [] })).toBe(true);
  });
});

describe("filtro errado no jogo", () => {
  const p = plano([], []);
  const titulo = tituloDoFiltro(p);
  const ranger = { arquivo: "Ranger Leveling.filter", nome: "Ranger Leveling", build: titulo };
  const hiero = { arquivo: "Hierophant Leveling.filter", nome: "Hierophant Leveling", build: "Shock Nova Hierophant" };

  it("o cabeçalho dos destaques tem a linha que o Rust lê", () => {
    const texto = filtroDaBuild(p, TABELA).texto;
    expect(titulo).toBe("Ranger de Spectral Throw");
    expect(texto.split("\n")).toContain(`# Guia de leveling: destaques da build "${titulo}".`);
  });

  it("calado se o jogador não criou o filtro desta build", () => {
    expect(filtroErrado(p, { escolhido: "Hierophant Leveling.filter", do_guia: [hiero] })).toBeNull();
    expect(filtroErrado(p, { escolhido: "NeverSink.filter", do_guia: [] })).toBeNull();
    expect(filtroErrado(p, { escolhido: null, do_guia: [{ ...ranger, build: null }] })).toBeNull();
  });

  it("calado se o jogo já está com ele (sem ligar pra maiúsculas)", () => {
    expect(filtroErrado(p, { escolhido: "ranger leveling.FILTER", do_guia: [hiero, ranger] })).toBeNull();
    // Dois filtros desta build: qualquer um serve.
    const outro = { arquivo: "Ranger 2.filter", nome: "Ranger 2", build: titulo };
    expect(filtroErrado(p, { escolhido: "Ranger 2.filter", do_guia: [ranger, outro] })).toBeNull();
  });

  it("avisa quando o jogo ficou no filtro de outra build", () => {
    const errado = filtroErrado(p, { escolhido: "Hierophant Leveling.filter", do_guia: [hiero, ranger] });
    expect(errado).toEqual({ atual: "Hierophant Leveling", de_outra_build: true, certo: "Ranger Leveling" });
    expect(textoDoFiltroErrado(errado!)).toBe(
      'Filtro de itens: o jogo está com o filtro "Hierophant Leveling", de outra build. Os itens da build não vão brilhar: troque em Esc › Options › Game › Item Filter › "Ranger Leveling".',
    );
  });

  it("avisa quando o jogo está num filtro do jogador ou num online", () => {
    const neversink = filtroErrado(p, { escolhido: "NeverSink.filter", do_guia: [ranger] });
    expect(neversink).toEqual({ atual: "NeverSink", de_outra_build: false, certo: "Ranger Leveling" });
    expect(textoDoFiltroErrado(neversink!)).toMatch(/^Filtro de itens: o jogo está com o filtro "NeverSink"\. /);
    const online = filtroErrado(p, { escolhido: null, do_guia: [ranger] });
    expect(online).toEqual({ atual: null, de_outra_build: false, certo: "Ranger Leveling" });
    expect(textoDoFiltroErrado(online!)).toMatch(/^Filtro de itens: o jogo não está com o filtro desta build\. /);
  });
});
