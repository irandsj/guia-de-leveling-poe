import { describe, expect, it } from "vitest";

import {
  BLOCOS,
  BLOCOS_PADRAO,
  ESCALA_MAX,
  ESCALA_MIN,
  FORMAS,
  alternarBloco,
  blocosNoPadrao,
  lerBlocos,
  moverBloco,
  ordemDosBlocos,
  OPACIDADE_MAX,
  OPACIDADE_MIN,
  PREFERENCIAS_PADRAO,
  SECOES,
  corDoFundo,
  lerPreferencias,
  mudarEscala,
  mudarOpacidade,
  opcoesDaRota,
  proximaFormaDaTecla,
  type Forma,
} from "./preferencias";

describe("preferências", () => {
  it("o que não é um objeto vira o padrão", () => {
    for (const ruim of [null, undefined, "x", 3, true]) {
      expect(lerPreferencias(ruim)).toEqual(PREFERENCIAS_PADRAO);
    }
    expect(lerPreferencias([])).toEqual(PREFERENCIAS_PADRAO);
    expect(lerPreferencias({})).toEqual(PREFERENCIAS_PADRAO);
  });

  it("aproveita o que está certo e troca o resto pelo padrão", () => {
    const lido = lerPreferencias({
      liga_nova: false,
      biblioteca: "sim",
      layout_aberto: true,
      escala: 1.2,
      mostrar: { proximos: false, gemas_do_ato: 0, arvore: false, outra: true },
      sobra: 1,
    });
    expect(lido).toEqual({
      liga_nova: false,
      biblioteca: true,
      layout_aberto: true,
      marcar_gemas: true,
      guia_da_arvore: true,
      avisar_filtro: true,
      escala: 1.2,
      opacidade: 0.9,
      forma: "detalhado",
      mostrar: { proximos: false, gemas_do_ato: true, conjunto: true, arvore: false, itens: true },
      blocos: BLOCOS_PADRAO,
    });
  });

  it("a opacidade do fundo fica entre 0 e 1, de 10 em 10%", () => {
    expect(PREFERENCIAS_PADRAO.opacidade).toBe(0.9);
    expect(lerPreferencias({ opacidade: 0.4 }).opacidade).toBe(0.4);
    expect(lerPreferencias({ opacidade: 0 }).opacidade).toBe(OPACIDADE_MIN);
    expect(lerPreferencias({ opacidade: 3 }).opacidade).toBe(OPACIDADE_MAX);
    expect(lerPreferencias({ opacidade: -1 }).opacidade).toBe(OPACIDADE_MIN);
    expect(lerPreferencias({ opacidade: 0.66 }).opacidade).toBe(0.7);
    for (const ruim of ["0.5", null, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(lerPreferencias({ opacidade: ruim }).opacidade).toBe(0.9);
    }
  });

  it("aumenta e diminui a opacidade 10% por vez, sem passar dos limites", () => {
    let p = PREFERENCIAS_PADRAO;
    p = mudarOpacidade(p, 1);
    expect(p.opacidade).toBe(1);
    p = mudarOpacidade(p, 1);
    expect(p.opacidade).toBe(OPACIDADE_MAX);
    p = mudarOpacidade(mudarOpacidade(mudarOpacidade(p, -1), -1), -1);
    expect(p.opacidade).toBe(0.7);
    for (let i = 0; i < 20; i++) p = mudarOpacidade(p, -1);
    expect(p.opacidade).toBe(OPACIDADE_MIN);
    expect(corDoFundo(0.7)).toBe("rgba(14, 12, 11, 0.7)");
    expect(corDoFundo(5)).toBe("rgba(14, 12, 11, 1)");
  });

  it("a tecla de trocar o tamanho passa por bolinha, meio e expandido, e volta", () => {
    expect(proximaFormaDaTecla("bolinha")).toBe("detalhado");
    expect(proximaFormaDaTecla("detalhado")).toBe("expandido");
    expect(proximaFormaDaTecla("expandido")).toBe("bolinha");
    // O resumido (só pelos botões) segue pro expandido.
    expect(proximaFormaDaTecla("resumido")).toBe("expandido");
    // Três toques de qualquer forma do ciclo voltam pra ela.
    for (const forma of ["bolinha", "detalhado", "expandido"] as Forma[]) {
      expect(proximaFormaDaTecla(proximaFormaDaTecla(proximaFormaDaTecla(forma)))).toBe(forma);
    }
    for (const forma of FORMAS) expect(FORMAS).toContain(proximaFormaDaTecla(forma));
  });

  it("a forma do balão volta como estava, e o que não for uma das quatro vira o detalhado", () => {
    expect(PREFERENCIAS_PADRAO.forma).toBe("detalhado");
    expect(lerPreferencias({ forma: "expandido" }).forma).toBe("expandido");
    expect(lerPreferencias({ forma: "resumido" }).forma).toBe("resumido");
    expect(lerPreferencias({ forma: "bolinha" }).forma).toBe("bolinha");
    for (const ruim of ["minimizado", 2, null, true]) {
      expect(lerPreferencias({ forma: ruim }).forma).toBe("detalhado");
    }
  });

  it("o guia da árvore vem ligado, e só um sim ou não de verdade muda isso", () => {
    expect(PREFERENCIAS_PADRAO.guia_da_arvore).toBe(true);
    expect(lerPreferencias({ guia_da_arvore: false }).guia_da_arvore).toBe(false);
    expect(lerPreferencias({ guia_da_arvore: true }).guia_da_arvore).toBe(true);
    for (const ruim of [0, "false", null, {}]) {
      expect(lerPreferencias({ guia_da_arvore: ruim }).guia_da_arvore).toBe(true);
    }
    // Não se mistura com a caixa que só esconde a seção do painel.
    const lido = lerPreferencias({ guia_da_arvore: false, mostrar: { arvore: true } });
    expect(lido.mostrar.arvore).toBe(true);
    expect(lerPreferencias({ mostrar: { arvore: false } }).guia_da_arvore).toBe(true);
  });

  it("o aviso de filtro errado vem ligado e pode ser desligado", () => {
    expect(PREFERENCIAS_PADRAO.avisar_filtro).toBe(true);
    expect(lerPreferencias({ avisar_filtro: false }).avisar_filtro).toBe(false);
    for (const ruim of [0, "false", null]) {
      expect(lerPreferencias({ avisar_filtro: ruim }).avisar_filtro).toBe(true);
    }
  });

  it("o tamanho do texto fica dentro dos limites", () => {
    expect(lerPreferencias({ escala: 9 }).escala).toBe(ESCALA_MAX);
    expect(lerPreferencias({ escala: 0.1 }).escala).toBe(ESCALA_MIN);
    expect(lerPreferencias({ escala: 1.26 }).escala).toBe(1.3);
    expect(lerPreferencias({ escala: Number.NaN }).escala).toBe(1);
    expect(lerPreferencias({ escala: Number.POSITIVE_INFINITY }).escala).toBe(1);
    expect(lerPreferencias({ escala: "1.2" }).escala).toBe(1);
  });

  it("aumenta e diminui o texto um degrau, sem passar dos limites", () => {
    let p = PREFERENCIAS_PADRAO;
    p = mudarEscala(p, 1);
    expect(p.escala).toBe(1.1);
    p = mudarEscala(mudarEscala(p, -1), -1);
    expect(p.escala).toBe(0.9);
    for (let i = 0; i < 20; i++) p = mudarEscala(p, -1);
    expect(p.escala).toBe(ESCALA_MIN);
    for (let i = 0; i < 20; i++) p = mudarEscala(p, 1);
    expect(p.escala).toBe(ESCALA_MAX);
    expect(PREFERENCIAS_PADRAO.escala).toBe(1);
  });

  it("passa as opções da rota", () => {
    expect(opcoesDaRota(PREFERENCIAS_PADRAO)).toEqual({ liga_nova: true, biblioteca: true });
    expect(opcoesDaRota({ ...PREFERENCIAS_PADRAO, liga_nova: false })).toEqual({
      liga_nova: false,
      biblioteca: true,
    });
  });

  it("a lista de seções cobre todas as chaves de `mostrar`", () => {
    // Menos a árvore, que não aparece mais no jogo (só na edição).
    const semArvore = Object.keys(PREFERENCIAS_PADRAO.mostrar).filter((chave) => chave !== "arvore");
    expect(SECOES.map((s) => s.chave).sort()).toEqual(semArvore.sort());
  });
});

describe("blocos do balão", () => {
  const padrao = BLOCOS_PADRAO.ordem;

  it("começa com todos abertos, na ordem do balão", () => {
    expect(padrao).toEqual(["missoes", "gemas", "conjunto", "itens", "proximos"]);
    expect(BLOCOS.map((b) => b.id)).toEqual(padrao);
    expect(PREFERENCIAS_PADRAO.blocos).toEqual({ ordem: padrao, fechados: [] });
    expect(blocosNoPadrao(BLOCOS_PADRAO)).toBe(true);
  });

  it("lê do disco sem repetido e sem desconhecido; o que faltar entra no lugar padrão", () => {
    expect(lerBlocos(undefined)).toEqual(BLOCOS_PADRAO);
    expect(lerBlocos("x")).toEqual(BLOCOS_PADRAO);
    expect(lerBlocos({ ordem: "x", fechados: 3 })).toEqual(BLOCOS_PADRAO);
    expect(
      lerBlocos({ ordem: ["proximos", "missoes", "proximos", "velho", 4], fechados: ["itens", "itens", "nada"] }),
    ).toEqual({ ordem: ["proximos", "missoes", "gemas", "conjunto", "itens"], fechados: ["itens"] });
    // Os que faltam entram logo depois do que vem antes deles na ordem padrão (a missão, no começo).
    expect(lerBlocos({ ordem: ["itens", "gemas"] }).ordem).toEqual(["missoes", "itens", "proximos", "gemas", "conjunto"]);
    expect(lerBlocos({ ordem: ["proximos", "missoes", "gemas"] }).ordem).toEqual([
      "proximos",
      "missoes",
      "gemas",
      "conjunto",
      "itens",
    ]);
    const salvo = { ordem: ["itens", "conjunto", "proximos", "gemas", "missoes"], fechados: ["gemas"] };
    expect(lerPreferencias({ blocos: salvo }).blocos).toEqual(salvo);
  });

  it("abre e fecha um bloco", () => {
    const fechado = alternarBloco(BLOCOS_PADRAO, "proximos");
    expect(fechado).toEqual({ ordem: padrao, fechados: ["proximos"] });
    expect(blocosNoPadrao(fechado)).toBe(false);
    expect(alternarBloco(fechado, "proximos")).toEqual(BLOCOS_PADRAO);
  });

  it("troca de lugar com o vizinho que está aparecendo", () => {
    expect(moverBloco(BLOCOS_PADRAO, "proximos", -1, padrao).ordem).toEqual([
      "missoes",
      "gemas",
      "conjunto",
      "proximos",
      "itens",
    ]);
    expect(moverBloco(BLOCOS_PADRAO, "missoes", 1, padrao).ordem).toEqual([
      "gemas",
      "missoes",
      "conjunto",
      "itens",
      "proximos",
    ]);
    // Sem itens nesta fase: "próximos" pula por cima do bloco escondido e passa do conjunto.
    const semItens = padrao.filter((b) => b !== "itens");
    expect(moverBloco(BLOCOS_PADRAO, "proximos", -1, semItens).ordem).toEqual([
      "missoes",
      "gemas",
      "proximos",
      "conjunto",
      "itens",
    ]);
    // No topo ou no fim, nada muda.
    expect(moverBloco(BLOCOS_PADRAO, "missoes", -1, padrao)).toBe(BLOCOS_PADRAO);
    expect(moverBloco(BLOCOS_PADRAO, "proximos", 1, padrao)).toBe(BLOCOS_PADRAO);
    // A missão pode ir lá pro fim, um passo de cada vez.
    let b = BLOCOS_PADRAO;
    for (let i = 0; i < 4; i++) b = moverBloco(b, "missoes", 1, b.ordem);
    expect(b.ordem).toEqual(["gemas", "conjunto", "itens", "proximos", "missoes"]);
    expect(ordemDosBlocos(alternarBloco(b, "itens"))).toBe("Gemas · Conjunto · (Itens) · Próximos conjuntos · Missões");
  });
});
