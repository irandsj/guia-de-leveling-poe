import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { hashDoCodigo, importar, type Baixar, type ResultadoDaImportacao } from "./importar";
import { MAXROLL_DESLIGADO, MAXROLL_LIGADO, SITES_DE_BUILD } from "./links";
import type { Plano } from "./plano";
import { codificar, POR_NIVEL, xmlDeExemplo } from "./teste/pob-de-exemplo";

const XML = xmlDeExemplo(POR_NIVEL);
const CODIGO = codificar(XML);
const AGORA = new Date("2026-11-10T12:00:00Z");
const PAGINA_HTML = "<!DOCTYPE html><html><head><title>Not found</title></head><body>404</body></html>";
const DICA = "Se o link não funcionar, cole o código do PoB.";

/** Internet de mentira: responde só os endereços da tabela e anota cada pedido. */
function baixador(respostas: Record<string, string | Error>): { baixar: Baixar; pedidos: string[] } {
  const pedidos: string[] = [];
  const baixar: Baixar = async (url) => {
    pedidos.push(url);
    const resposta = respostas[url];
    if (resposta === undefined) throw new Error("O site não achou essa build (erro 404). Confira o link.");
    if (resposta instanceof Error) throw resposta;
    return resposta;
  };
  return { baixar, pedidos };
}

const semInternet: Baixar = async (url) => {
  throw new Error(`não era pra baixar nada (${url})`);
};

function planoDe(resultado: ResultadoDaImportacao): Plano {
  if (resultado.tipo !== "plano") throw new Error(`esperava um plano, veio ${JSON.stringify(resultado)}`);
  return resultado.plano;
}

function erroDe(resultado: ResultadoDaImportacao): string {
  if (resultado.tipo !== "erro") throw new Error(`esperava um erro, veio ${resultado.tipo}`);
  return resultado.mensagem;
}

describe("colar o código ou o XML", () => {
  it("código do PoB: vira plano sem tocar na internet", async () => {
    const plano = planoDe(await importar(CODIGO, semInternet, AGORA));
    expect(plano.personagem.classe).toBe("Marauder");
    expect(plano.criado_em).toBe("2026-11-10T12:00:00.000Z");
    expect(plano.fonte).toMatchObject({ tipo: "pob", url: null, id: null, site: "código colado" });
    expect(plano.fonte.hash_codigo).toBe(await hashDoCodigo(CODIGO));
    expect(plano.gemas.etapas.length).toBeGreaterThan(1);
  });

  it("código colado com quebras de linha e espaços em volta", async () => {
    const quebrado = `\n  ${CODIGO.slice(0, 60)}\n${CODIGO.slice(60, 200)}\r\n${CODIGO.slice(200)}  \n`;
    const plano = planoDe(await importar(quebrado, semInternet, AGORA));
    expect(plano.fonte.hash_codigo).toBe(await hashDoCodigo(CODIGO));
  });

  it("a build que o teste de ponta a ponta cola (scripts/build-de-teste.txt) continua valendo", async () => {
    const aqui = dirname(fileURLToPath(import.meta.url));
    const colado = readFileSync(resolve(aqui, "../../scripts/build-de-teste.txt"), "utf8");
    const plano = planoDe(await importar(colado, semInternet, AGORA));
    // O teste de ponta a ponta conta com estes dados: classe, primeira troca de conjunto e a gema do passo 3.
    expect(plano.personagem.classe).toBe("Marauder");
    expect(plano.gemas.etapas.slice(0, 2).map((e) => e.titulo)).toEqual(["Level 1 - 4", "Level 4 - 12"]);
    expect(JSON.stringify(plano.gemas.etapas[0].grupos)).toContain("Ground Slam");
  });

  it("XML do PoB colado direto", async () => {
    const plano = planoDe(await importar(XML, semInternet, AGORA));
    expect(plano.personagem.classe).toBe("Marauder");
    expect(plano.fonte).toMatchObject({ url: null, id: null, site: "XML colado" });
  });

  it("código que não é de PoB: mensagem, não erro lançado", async () => {
    const naoEhPob = btoa("isto aqui nao e um PoB, e so um texto qualquer em base64".repeat(2));
    expect(erroDe(await importar(naoEhPob, semInternet, AGORA))).toBe(
      "Não consegui abrir o código: ele não parece ser de um Path of Building.",
    );
  });

  it("código cortado no meio: explica como copiar de novo", async () => {
    expect(erroDe(await importar("A".repeat(41), semInternet, AGORA))).toBe(
      "O código não está inteiro. No PoB: Import/Export Build > Generate > Copy, e cole tudo.",
    );
  });

  it("PoB de PoE 2: recusa dizendo por quê", async () => {
    const poe2 = codificar(xmlDeExemplo({ raiz: "PathOfBuilding2", conjuntos: [] }));
    expect(erroDe(await importar(poe2, semInternet, AGORA))).toMatch(/PoE 2/);
  });

  it("nada colado, ou um texto qualquer", async () => {
    expect(erroDe(await importar("", semInternet, AGORA))).toBe("Cole o link da build ou o código do PoB.");
    expect(erroDe(await importar("  \n ", semInternet, AGORA))).toBe("Cole o link da build ou o código do PoB.");
    expect(erroDe(await importar("oi, tudo bem?", semInternet, AGORA))).toMatch(/^Não reconheci o que foi colado/);
  });
});

describe("hashDoCodigo", () => {
  it("o mesmo código dá o mesmo resumo, com ou sem espaços", async () => {
    const hash = await hashDoCodigo(CODIGO);
    expect(hash).toMatch(/^(sha256:[0-9a-f]{64}|fnv1a:[0-9a-f]{8})$/);
    expect(await hashDoCodigo(`  ${CODIGO.slice(0, 50)}\n${CODIGO.slice(50)}\n`)).toBe(hash);
  });

  it("códigos diferentes dão resumos diferentes", async () => {
    const outro = codificar(xmlDeExemplo({ ...POR_NIVEL, nivel: 91 }));
    expect(outro).not.toBe(CODIGO);
    expect(await hashDoCodigo(outro)).not.toBe(await hashDoCodigo(CODIGO));
  });
});

describe("links de PoB", () => {
  it("pobb.in: um pedido só, no endereço cru", async () => {
    const { baixar, pedidos } = baixador({ "https://pobb.in/pob/AbCdEf123": CODIGO });
    const plano = planoDe(await importar("https://pobb.in/AbCdEf123", baixar, AGORA));
    expect(pedidos).toEqual(["https://pobb.in/pob/AbCdEf123"]);
    expect(plano.fonte).toMatchObject({ url: "https://pobb.in/AbCdEf123", id: "AbCdEf123", site: "pobb.in" });
    expect(plano.fonte.hash_codigo).toBe(await hashDoCodigo(CODIGO));
  });

  it("pobb.in: se o primeiro endereço vier com página, tenta o segundo", async () => {
    const { baixar, pedidos } = baixador({
      "https://pobb.in/pob/AbCdEf123": PAGINA_HTML,
      "https://pobb.in/AbCdEf123/raw": CODIGO,
    });
    const plano = planoDe(await importar("pobb.in/AbCdEf123", baixar, AGORA));
    expect(pedidos).toEqual(["https://pobb.in/pob/AbCdEf123", "https://pobb.in/AbCdEf123/raw"]);
    expect(plano.fonte.site).toBe("pobb.in");
  });

  it("poe.ninja", async () => {
    const { baixar, pedidos } = baixador({ "https://poe.ninja/poe1/pob/raw/73995": CODIGO });
    const plano = planoDe(await importar("https://poe.ninja/poe1/pob/73995", baixar, AGORA));
    expect(pedidos).toEqual(["https://poe.ninja/poe1/pob/raw/73995"]);
    expect(plano.fonte).toMatchObject({ url: "https://poe.ninja/poe1/pob/73995", id: "73995", site: "poe.ninja" });
  });

  it("Maxroll (link de PoB): usa a API que devolve o código puro", async () => {
    const { baixar, pedidos } = baixador({ "https://maxroll.gg/poe/api/pob/tcjqpe0t": `${CODIGO}\n` });
    const plano = planoDe(await importar("https://maxroll.gg/poe/pob/tcjqpe0t", baixar, AGORA, true));
    expect(pedidos).toEqual(["https://maxroll.gg/poe/api/pob/tcjqpe0t"]);
    expect(plano.fonte).toMatchObject({
      url: "https://maxroll.gg/poe/pob/tcjqpe0t",
      id: "tcjqpe0t",
      site: "Maxroll",
    });
  });

  it("resposta embrulhada em JSON (texto ou objeto)", async () => {
    const comoTexto = baixador({ "https://pastebin.com/raw/abc123": JSON.stringify(CODIGO) });
    expect(planoDe(await importar("https://pastebin.com/abc123", comoTexto.baixar, AGORA)).fonte.site).toBe(
      "Pastebin",
    );

    const comoObjeto = baixador({
      "https://pastebin.com/raw/abc123": JSON.stringify({ id: "abc123", versao: 2, pob: CODIGO }),
    });
    const plano = planoDe(await importar("https://pastebin.com/abc123", comoObjeto.baixar, AGORA));
    expect(plano.fonte.hash_codigo).toBe(await hashDoCodigo(CODIGO));
  });

  it("link que não existe: mostra o erro do site e lembra do código", async () => {
    const { baixar, pedidos } = baixador({});
    expect(erroDe(await importar("https://pobb.in/NaoExiste", baixar, AGORA))).toBe(
      `O site não achou essa build (erro 404). Confira o link. ${DICA}`,
    );
    // Um pedido por endereço, sem insistir.
    expect(pedidos).toEqual(["https://pobb.in/pob/NaoExiste", "https://pobb.in/NaoExiste/raw"]);
  });

  it("erro que já fala do código do PoB não repete a dica", async () => {
    const recusou = "O site recusou o pedido (erro 403). Cole o código do PoB no lugar do link.";
    const { baixar } = baixador({ "https://poe.ninja/poe1/pob/raw/1": new Error(recusou) });
    expect(erroDe(await importar("https://poe.ninja/poe1/pob/1", baixar, AGORA))).toBe(recusou);
  });

  it("erro que chega como texto (é assim que o Rust devolve)", async () => {
    const baixar: Baixar = () => Promise.reject("Não consegui conectar em poe.ninja. Confira a internet.");
    expect(erroDe(await importar("https://poe.ninja/poe1/pob/1", baixar, AGORA))).toBe(
      `Não consegui conectar em poe.ninja. Confira a internet. ${DICA}`,
    );
  });

  it("o site respondeu com uma página no lugar do código", async () => {
    const { baixar } = baixador({ "https://poe.ninja/poe1/pob/raw/1": PAGINA_HTML });
    expect(erroDe(await importar("https://poe.ninja/poe1/pob/1", baixar, AGORA))).toBe(
      `O poe.ninja respondeu com uma página em vez do código (link apagado, errado ou bloqueado). ${DICA}`,
    );
  });

  it("o link funcionou, mas o conteúdo não é um PoB de PoE 1", async () => {
    const poe2 = codificar(xmlDeExemplo({ raiz: "PathOfBuilding2", conjuntos: [] }));
    const { baixar } = baixador({ "https://poe.ninja/poe1/pob/raw/1": poe2 });
    expect(erroDe(await importar("https://poe.ninja/poe1/pob/1", baixar, AGORA))).toBe(
      "Esse código é do Path of Building de PoE 2. Este guia é só do PoE 1.",
    );
  });

  it("site desconhecido: não baixa nada", async () => {
    const { baixar, pedidos } = baixador({});
    expect(erroDe(await importar("https://exemplo.com/build/1", baixar, AGORA))).toMatch(
      /^Não conheço o site "exemplo\.com"/,
    );
    expect(pedidos).toEqual([]);
  });
});

describe("chave do Maxroll", () => {
  it("o texto da tela cita o Maxroll só com a chave ligada", () => {
    expect(/maxroll/i.test(SITES_DE_BUILD)).toBe(MAXROLL_LIGADO);
  });

  it("desligada: guia, planner e link de PoB do Maxroll são recusados sem baixar nada", async () => {
    for (const colado of [
      "https://maxroll.gg/poe/build-guides/shock-nova-hierophant-guide",
      "https://maxroll.gg/poe/planner/hhea800t",
      "https://planners.maxroll.gg/profiles/load/poe/hhea800t",
      "https://maxroll.gg/poe/pob/tcjqpe0t",
      "maxroll.gg/poe/api/pob/tcjqpe0t",
      "pob://maxroll/tcjqpe0t",
    ]) {
      const { baixar, pedidos } = baixador({});
      expect(erroDe(await importar(colado, baixar, AGORA, false))).toBe(MAXROLL_DESLIGADO);
      expect(pedidos).toEqual([]);
    }
  });

  it("desligada: os outros sites continuam iguais", async () => {
    const { baixar } = baixador({ "https://pobb.in/pob/AbCdEf123": CODIGO });
    expect(planoDe(await importar("https://pobb.in/AbCdEf123", baixar, AGORA, false)).fonte.site).toBe("pobb.in");
  });
});

// Estes testes ligam a chave na mão, pra conferir o código do Maxroll com a chave como estiver.
describe("páginas do Maxroll", () => {
  const GUIA = "https://maxroll.gg/poe/build-guides/boneshatter-juggernaut-league-starter";

  it("guia: baixa a página uma vez e lista os PoBs citados, sem repetir", async () => {
    const html = `${PAGINA_HTML.replace("Not found", "Guia")}
      <a href="https://maxroll.gg/poe/pob/tcjqpe0t">Leveling</a>
      <a href="https://maxroll.gg/poe/pob/abc123XYZ">Endgame</a>
      <a href="https://maxroll.gg/poe/pob/tcjqpe0t">Leveling de novo</a>`;
    const { baixar, pedidos } = baixador({ [GUIA]: html });

    expect(await importar(`${GUIA}?utm=1#gems`, baixar, AGORA, true)).toEqual({
      tipo: "escolher",
      pagina: GUIA,
      opcoes: [
        { id: "tcjqpe0t", link: "https://maxroll.gg/poe/pob/tcjqpe0t" },
        { id: "abc123XYZ", link: "https://maxroll.gg/poe/pob/abc123XYZ" },
      ],
    });
    expect(pedidos).toEqual([GUIA]);
  });

  it("guia sem PoB nem planner: ensina onde achar", async () => {
    const { baixar } = baixador({ [GUIA]: PAGINA_HTML });
    expect(erroDe(await importar(GUIA, baixar, AGORA, true))).toMatch(/^Não achei PoB nem planner nessa página do Maxroll/);
  });

  it("guia só com planner (os de leveling por classe): lista os planners pra escolher", async () => {
    const html = `${PAGINA_HTML.replace("Not found", "Witch leveling")}
      <div data-poe-profile="hhea800t"></div>
      <a href="https://maxroll.gg/poe/planner/ab12cd34">Planner</a>
      <script>{"src":"https:\\/\\/backend.maxroll.gg\\/poe\\/poe-planner\\/hhea800t#1"}</script>`;
    const { baixar, pedidos } = baixador({ [GUIA]: html });

    expect(await importar(GUIA, baixar, AGORA, true)).toEqual({
      tipo: "escolher",
      pagina: GUIA,
      opcoes: [
        { id: "hhea800t", link: "https://maxroll.gg/poe/planner/hhea800t" },
        { id: "ab12cd34", link: "https://maxroll.gg/poe/planner/ab12cd34" },
      ],
    });
    expect(pedidos).toEqual([GUIA]);
  });

  it("guia com PoB e planner: fica com o PoB", async () => {
    const html = `${PAGINA_HTML}<a href="/poe/pob/tcjqpe0t">PoB</a><div data-poe-profile="hhea800t"></div>`;
    const { baixar } = baixador({ [GUIA]: html });
    const resultado = await importar(GUIA, baixar, AGORA, true);
    expect(resultado.tipo === "escolher" && resultado.opcoes.map((o) => o.link)).toEqual([
      "https://maxroll.gg/poe/pob/tcjqpe0t",
    ]);
  });

  it("guia fora do ar: mostra o erro do site", async () => {
    const { baixar, pedidos } = baixador({});
    expect(erroDe(await importar(GUIA, baixar, AGORA, true))).toBe(
      "O site não achou essa build (erro 404). Confira o link.",
    );
    expect(pedidos).toEqual([GUIA]);
  });

  it("planner: um pedido só, aos dados do planner, e o plano troca gemas e árvore por etapa", async () => {
    const aqui = dirname(fileURLToPath(import.meta.url));
    const dados = readFileSync(resolve(aqui, "teste/maxroll/planner-hhea800t.json"), "utf8");
    const DADOS = "https://planners.maxroll.gg/profiles/load/poe/hhea800t";
    const { baixar, pedidos } = baixador({ [DADOS]: dados });

    const plano = planoDe(await importar("https://maxroll.gg/poe/planner/hhea800t#skills", baixar, AGORA, true));
    expect(pedidos).toEqual([DADOS]);
    expect(plano.fonte).toMatchObject({
      url: "https://maxroll.gg/poe/planner/hhea800t",
      id: "hhea800t",
      site: "Maxroll (planner)",
    });
    expect(plano.fonte.hash_codigo).toMatch(/^(sha256|fnv1a):/);
    expect(plano.personagem.classe).toBe("Witch");
    expect(plano.gemas.etapas.map((e) => e.titulo)).toEqual([
      "Level 1 - 12",
      "Level 12 - 28",
      "Level 28 - 38",
      "Level 38+",
    ]);
    expect(plano.arvore.etapas.length).toBeGreaterThan(4);
    // As maestrias saem do arquivo da árvore, carregado na hora.
    expect(plano.arvore.etapas[plano.arvore.etapas.length - 1].maestrias.length).toBeGreaterThan(0);
    // Os avisos do planner vêm antes dos do plano.
    expect(plano.avisos[0]).toMatch(/^O guia tem 3 árvores/);
    expect(plano.avisos).toContain(
      "O guia mostra mais de uma ascendência (Occultist, Elementalist, Necromancer): escolha a sua no laboratório.",
    );
  });

  it("planner pelo link dos dados ou pelo link interno da página: mesmo pedido", async () => {
    const DADOS = "https://planners.maxroll.gg/profiles/load/poe/ab12cd34";
    for (const colado of [DADOS, "https://backend.maxroll.gg/poe/poe-planner/ab12cd34#2.1"]) {
      const { baixar, pedidos } = baixador({});
      await importar(colado, baixar, AGORA, true);
      expect(pedidos).toEqual([DADOS]);
    }
  });

  it("planner apagado: o erro do site, sem tentar de novo", async () => {
    const { baixar, pedidos } = baixador({});
    expect(erroDe(await importar("https://maxroll.gg/poe/planner/ab12cd34", baixar, AGORA, true))).toBe(
      "O site não achou essa build (erro 404). Confira o link.",
    );
    expect(pedidos).toEqual(["https://planners.maxroll.gg/profiles/load/poe/ab12cd34"]);
  });

  it("planner que responde com página ou é do PoE 2: mensagem pronta", async () => {
    const DADOS = "https://planners.maxroll.gg/profiles/load/poe/ab12cd34";
    const pagina = baixador({ [DADOS]: PAGINA_HTML });
    expect(erroDe(await importar("https://maxroll.gg/poe/planner/ab12cd34", pagina.baixar, AGORA, true))).toMatch(
      /^O Maxroll respondeu com uma página em vez dos dados do planner/,
    );

    const poe2 = baixador({ [DADOS]: JSON.stringify({ id: "ab12cd34", data: "{}", game: "poe2" }) });
    expect(erroDe(await importar("https://maxroll.gg/poe/planner/ab12cd34", poe2.baixar, AGORA, true))).toBe(
      "Esse planner é do Path of Exile 2. O guia é do Path of Exile 1.",
    );
  });

  it("link de outro jogo do Maxroll", async () => {
    const { baixar, pedidos } = baixador({});
    expect(erroDe(await importar("https://maxroll.gg/d4/build-guides/algo", baixar, AGORA, true))).toBe(
      "Esse link do Maxroll não é de Path of Exile 1.",
    );
    expect(pedidos).toEqual([]);
  });
});
