import { describe, expect, it } from "vitest";

import { interpretarEntrada, linksDePobNoMaxroll, pareceHtml, plannersNoMaxroll, type Entrada } from "./links";

function link(texto: string): Extract<Entrada, { tipo: "link" }> {
  const entrada = interpretarEntrada(texto);
  if (entrada.tipo !== "link") throw new Error(`esperava um link, veio ${JSON.stringify(entrada)}`);
  return entrada;
}

describe("interpretarEntrada", () => {
  it("texto vazio", () => {
    expect(interpretarEntrada("   \n ")).toEqual({ tipo: "vazio" });
  });

  it("XML do PoB colado direto", () => {
    expect(interpretarEntrada("<PathOfBuilding><Build/></PathOfBuilding>").tipo).toBe("xml");
    expect(interpretarEntrada('<?xml version="1.0"?><PathOfBuilding/>').tipo).toBe("xml");
  });

  it("código do PoB, mesmo quebrado em linhas", () => {
    const codigo = "eNrtfVlz4ziy_" + "Ab-9".repeat(30);
    const quebrado = `${codigo.slice(0, 40)}\n${codigo.slice(40)}`;
    expect(interpretarEntrada(quebrado)).toEqual({ tipo: "codigo", codigo });
  });

  it("pobb.in: tenta o endereço do PoB e depois o /raw", () => {
    const esperado = ["https://pobb.in/pob/nvw1iAVOzEKz", "https://pobb.in/nvw1iAVOzEKz/raw"];
    expect(link("https://pobb.in/nvw1iAVOzEKz").enderecos).toEqual(esperado);
    expect(link("pobb.in/nvw1iAVOzEKz").enderecos).toEqual(esperado);
    expect(link("https://pobb.in/nvw1iAVOzEKz/raw").enderecos).toEqual(esperado);
    expect(link("https://pobb.in/pob/nvw1iAVOzEKz").id).toBe("nvw1iAVOzEKz");
    expect(link("https://pobb.in/u/alguem/minha-build").id).toBe("u/alguem/minha-build");
  });

  it("poe.ninja", () => {
    const entrada = link("https://poe.ninja/poe1/pob/73995");
    expect(entrada.site).toBe("poe.ninja");
    expect(entrada.enderecos).toEqual(["https://poe.ninja/poe1/pob/raw/73995"]);
    expect(link("https://poe.ninja/pob/raw/73995").id).toBe("73995");
  });

  it("poe.ninja: página de personagem pede o link do PoB", () => {
    const entrada = interpretarEntrada("https://poe.ninja/poe1/builds/mirage/character/alguem/Boneco");
    expect(entrada.tipo).toBe("desconhecido");
  });

  it("Maxroll: link de PoB, protocolo pob://, guia e planner", () => {
    const api = ["https://maxroll.gg/poe/api/pob/tcjqpe0t"];
    expect(link("https://maxroll.gg/poe/pob/tcjqpe0t").enderecos).toEqual(api);
    expect(link("pob://maxroll/tcjqpe0t").enderecos).toEqual(api);
    expect(link("https://maxroll.gg/poe/api/pob/tcjqpe0t").pagina).toBe("https://maxroll.gg/poe/pob/tcjqpe0t");

    expect(interpretarEntrada("https://maxroll.gg/poe/build-guides/boneshatter-juggernaut-league-starter")).toEqual({
      tipo: "guia-maxroll",
      endereco: "https://maxroll.gg/poe/build-guides/boneshatter-juggernaut-league-starter",
    });

    const planner = {
      tipo: "planner-maxroll",
      id: "zh1t10s5",
      endereco: "https://planners.maxroll.gg/profiles/load/poe/zh1t10s5",
      pagina: "https://maxroll.gg/poe/planner/zh1t10s5",
    };
    for (const colado of [
      "https://maxroll.gg/poe/planner/zh1t10s5",
      "https://www.maxroll.gg/poe/planner/zh1t10s5?ref=x#skills",
      "maxroll.gg/poe/poe-planner/zh1t10s5",
      "https://backend.maxroll.gg/poe/poe-planner/zh1t10s5#2.1",
      "https://backend.maxroll.gg/poe/planner/zh1t10s5",
      "https://planners.maxroll.gg/profiles/load/poe/zh1t10s5",
    ]) {
      expect(interpretarEntrada(colado), colado).toEqual(planner);
    }
    // O planner do PoE 2 e o id com caractere estranho não viram pedido.
    expect(interpretarEntrada("https://planners.maxroll.gg/profiles/load/poe2/zh1t10s5").tipo).toBe("desconhecido");
    expect(interpretarEntrada("https://maxroll.gg/poe/planner/a%2F..").tipo).not.toBe("planner-maxroll");

    expect(interpretarEntrada("https://maxroll.gg/d4/build-guides/alguma").tipo).toBe("desconhecido");
  });

  it("guia do Maxroll: a consulta e a âncora do link não vão no pedido", () => {
    const entrada = interpretarEntrada("https://maxroll.gg/poe/build-guides/algum-guia?ref=abc#gear");
    expect(entrada).toEqual({ tipo: "guia-maxroll", endereco: "https://maxroll.gg/poe/build-guides/algum-guia" });
  });

  it("Pastebin, Rentry, poedb e pob.codes", () => {
    expect(link("https://pastebin.com/AbCd1234").enderecos).toEqual(["https://pastebin.com/raw/AbCd1234"]);
    expect(link("https://pastebin.com/raw/AbCd1234").id).toBe("AbCd1234");
    expect(link("https://rentry.co/minhabuild").enderecos).toEqual(["https://rentry.co/paste/minhabuild/raw"]);
    expect(link("https://poedb.tw/pob/xYz").enderecos).toEqual(["https://poedb.tw/pob/xYz/raw"]);
    expect(link("https://pob.codes/b/abc123").enderecos).toEqual(["https://api.pob.codes/abc123/raw"]);
    expect(link("pob://pobbin/nvw1iAVOzEKz").site).toBe("pobb.in");
  });

  it("acha o link no meio de uma frase e tira a pontuação do fim", () => {
    expect(link("olha essa build: https://pobb.in/nvw1iAVOzEKz, é boa").id).toBe("nvw1iAVOzEKz");
    expect(link("(https://pobb.in/nvw1iAVOzEKz)").id).toBe("nvw1iAVOzEKz");
  });

  it("link embrulhado pelo YouTube", () => {
    const embrulhado =
      "https://www.youtube.com/redirect?event=video_description&q=https%3A%2F%2Fpobb.in%2Fnvw1iAVOzEKz&v=abc";
    expect(link(embrulhado).id).toBe("nvw1iAVOzEKz");
  });

  it("site que não conhece e texto qualquer", () => {
    const outro = interpretarEntrada("https://exemplo.com/build/123");
    expect(outro.tipo).toBe("desconhecido");
    if (outro.tipo === "desconhecido") expect(outro.motivo).toContain("exemplo.com");
    expect(interpretarEntrada("minha build de marauder").tipo).toBe("desconhecido");
  });

  it("id com caracteres estranhos não vira endereço", () => {
    expect(interpretarEntrada("https://pastebin.com/a%2F..%2Fb").tipo).toBe("desconhecido");
    expect(interpretarEntrada("pob://maxroll/../../etc").tipo).toBe("desconhecido");
  });

  it("todo endereço gerado é HTTPS e de um site da lista", () => {
    const permitidos = new Set([
      "pobb.in",
      "poe.ninja",
      "maxroll.gg",
      "pastebin.com",
      "pastebinp.com",
      "api.pob.codes",
      "rentry.co",
      "poedb.tw",
      "planners.maxroll.gg",
    ]);
    const planner = interpretarEntrada("https://maxroll.gg/poe/planner/hhea800t");
    if (planner.tipo !== "planner-maxroll") throw new Error("esperava o planner");
    expect(new URL(planner.endereco).protocol).toBe("https:");
    expect(permitidos.has(new URL(planner.endereco).hostname)).toBe(true);
    const exemplos = [
      "https://pobb.in/abc123",
      "https://poe.ninja/poe1/pob/1",
      "https://maxroll.gg/poe/pob/tcjqpe0t",
      "https://pastebin.com/AbCd1234",
      "https://pastebinp.com/AbCd1234",
      "https://rentry.co/x1",
      "https://poedb.tw/pob/x1",
      "https://pob.codes/b/x1",
    ];
    for (const exemplo of exemplos) {
      for (const endereco of link(exemplo).enderecos) {
        const url = new URL(endereco);
        expect(url.protocol).toBe("https:");
        expect(permitidos.has(url.hostname)).toBe(true);
      }
    }
  });
});

describe("linksDePobNoMaxroll", () => {
  it("lista cada PoB uma vez só", () => {
    const html =
      '<a href="https://maxroll.gg/poe/pob/tcjqpe0t">PoB</a> <a href="https://maxroll.gg/poe/pob/abcd1234">Outro</a>' +
      ' <a href="https://maxroll.gg/poe/pob/tcjqpe0t">de novo</a>';
    expect(linksDePobNoMaxroll(html)).toEqual(["tcjqpe0t", "abcd1234"]);
    expect(linksDePobNoMaxroll("<p>sem link</p>")).toEqual([]);
  });

  it("acha o link relativo e a lista do JSON da página (a maioria dos guias é assim)", () => {
    const html =
      '<a class="poe-pob-link" href="/poe/pob/tcjqpe0t">Path of Building</a>' +
      '<script>{"pobLinks":[{"name":"","link":"tcjqpe0t"},{"name":"Endgame","link":"zh78bc0v"}]}</script>' +
      '<script>{"url":"https:\\/\\/maxroll.gg\\/poe\\/pob\\/su78b60v"}</script>';
    expect(linksDePobNoMaxroll(html)).toEqual(["tcjqpe0t", "su78b60v", "zh78bc0v"]);
  });

  it("não confunde com o planner nem com outro caminho", () => {
    const html =
      '<a href="/poe/planner/hhea800t">Planner</a> <a href="/poe/build-guides/witch-leveling">Guia</a>' +
      ' <a href="/d4/pob/abcdefgh">outro jogo</a> <img src="https://assets.maxroll.gg/poe/pob/icon.png">';
    expect(linksDePobNoMaxroll(html)).toEqual([]);
  });
});

describe("plannersNoMaxroll", () => {
  it("acha o bloco embutido e os links, na ordem da página, sem repetir", () => {
    const html =
      '<div class="poe-planner" data-poe-profile="hhea800t"></div>' +
      '<a href="https://maxroll.gg/poe/planner/ab12cd34">Planner</a>' +
      '<script>{"src":"https:\\/\\/backend.maxroll.gg\\/poe\\/poe-planner\\/zz99yy88#1"}</script>' +
      '<script>{"html":"<div data-poe-profile=\\"hhea800t\\">"}</script>' +
      '<a href="/poe/planner/qq11ww22">relativo</a>';
    expect(plannersNoMaxroll(html)).toEqual(["hhea800t", "ab12cd34", "zz99yy88", "qq11ww22"]);
  });

  it("não confunde com PoB, guia ou outro jogo", () => {
    const html =
      '<a href="/poe/pob/tcjqpe0t">PoB</a> <a href="/poe/build-guides/witch-leveling">Guia</a>' +
      ' <a href="https://maxroll.gg/poe2/planner/abcdefgh">PoE 2</a> <a href="/d4/planner/abcdefgh">D4</a>';
    expect(plannersNoMaxroll(html)).toEqual([]);
    expect(plannersNoMaxroll("<p>sem nada</p>")).toEqual([]);
  });
});

describe("pareceHtml", () => {
  it("separa página de erro de código", () => {
    expect(pareceHtml("<!DOCTYPE html><html><head>")).toBe(true);
    expect(pareceHtml("  <html lang='en'>")).toBe(true);
    expect(pareceHtml("eNrtfVlz4ziy_AAAA")).toBe(false);
  });
});
