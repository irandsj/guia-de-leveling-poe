import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { MAXIMO_DE_ALVOS, alvosDaTela, chaveDosAlvos, enderecoDoIcone, gemasDaBuild, marcaDaMochila } from "./alvos";
import { ARCANE_LINK } from "./dados-330";
import { ROTA } from "./teste/rota-de-exemplo";
import { chaveDaMarca, comprasQueFicaram, gemasDoAto } from "./vista";

const CIDADE_DO_ATO_1 = "1_1_town";
const ZONA_COMUM = "1_1_2";

describe("gemas que a leitura de tela procura", () => {
  it("fora da cidade, desligado ou sem rota: nada", () => {
    expect(alvosDaTela(ROTA, 0, ZONA_COMUM, true)).toEqual([]);
    expect(alvosDaTela(ROTA, 0, CIDADE_DO_ATO_1, false)).toEqual([]);
    expect(alvosDaTela(ROTA, 0, null, true)).toEqual([]);
    expect(alvosDaTela(null, 0, CIDADE_DO_ATO_1, true)).toEqual([]);
  });

  it("na cidade: as gemas do ato do passo atual pra frente, as mais próximas primeiro", () => {
    const alvos = alvosDaTela(ROTA, 0, CIDADE_DO_ATO_1, true);
    const doAto = gemasDoAto(ROTA, 0).flatMap((p) => p.gemas);
    expect(doAto.length).toBeGreaterThan(0);
    expect(alvos.length).toBeGreaterThan(0);
    expect(alvos.length).toBeLessThanOrEqual(MAXIMO_DE_ALVOS);
    expect(alvos[0].gem_id).toBe(doAto[0].gem_id);
    expect(alvos[0].tipo).toBe(doAto[0].tipo);
    const chaves = alvos.map((a) => `${a.tipo}:${a.gem_id}`);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("recompensa que já passou sai; compra que já passou fica piscando até ser marcada", () => {
    const comCompra = gemasDoAto(ROTA, 0).find((p) => p.gemas.some((g) => g.tipo === "vendedor"))!;
    const depois = comCompra.passo + 1;
    const restantes = new Set(gemasDoAto(ROTA, depois).flatMap((p) => p.gemas.map(chaveDaMarca)));
    const esquecidas = new Set(comprasQueFicaram(ROTA, depois).map(chaveDaMarca));
    expect(esquecidas.size).toBeGreaterThan(0);
    const alvos = alvosDaTela(ROTA, depois, CIDADE_DO_ATO_1, true).map(chaveDaMarca);
    for (const chave of alvos) expect(restantes.has(chave) || esquecidas.has(chave)).toBe(true);
    for (const chave of [...esquecidas].slice(0, 3)) expect(alvos).toContain(chave);

    // Marcada como comprada (ou pega): não pisca mais.
    const marcadas = [...esquecidas, alvos[0]];
    const semMarcadas = alvosDaTela(ROTA, depois, CIDADE_DO_ATO_1, true, marcadas).map(chaveDaMarca);
    for (const chave of marcadas) expect(semMarcadas).not.toContain(chave);
  });

  it("a chave muda com a lista", () => {
    const a = alvosDaTela(ROTA, 0, CIDADE_DO_ATO_1, true);
    expect(chaveDosAlvos(a)).toBe(chaveDosAlvos([...a]));
    expect(chaveDosAlvos(a)).not.toBe(chaveDosAlvos(a.slice(1)));
    expect(chaveDosAlvos([])).toBe("");
  });

  it("toda gema da rota de exemplo tem o ícone baixado", () => {
    expect(enderecoDoIcone("Metadata/Items/Gems/SkillGemFireball")).toBe("/gemas/SkillGemFireball.webp");
    for (const passo of ROTA.passos) {
      for (const gema of passo.gemas) {
        const arquivo = join(process.cwd(), "public", enderecoDoIcone(gema.gem_id));
        expect(existsSync(arquivo), gema.nome).toBe(true);
      }
    }
  });

  it("a Arcane Link (gema nova da 3.30) também tem ícone, pra piscar na tela", () => {
    expect(existsSync(join(process.cwd(), "public", enderecoDoIcone(ARCANE_LINK)))).toBe(true);
  });
});

describe("gema vista no inventário", () => {
  const todas = ROTA.passos.flatMap((p, passo) => p.gemas.map((gema) => ({ gema, passo, ato: p.ato })));
  // Uma gema que a rota pega como recompensa e compra também (ou a primeira que aparecer duas vezes).
  const repetida = todas.find(
    (a) => todas.filter((b) => b.gema.gem_id === a.gema.gem_id && b.gema.tipo !== a.gema.tipo).length > 0,
  );

  it("as gemas da build: todas as da rota, sem repetir", () => {
    const ids = gemasDaBuild(ROTA);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(todas.map((a) => a.gema.gem_id)));
    expect(gemasDaBuild(null)).toEqual([]);
  });

  it("vira a marca da gema na rota até o fim do ato atual, a do tipo da janela aberta primeiro", () => {
    const { gema, passo } = todas[0];
    const vista = { gem_id: gema.gem_id, tipo: gema.tipo, quantas: 1 };
    expect(marcaDaMochila(ROTA, passo, [], [], vista)).toBe(chaveDaMarca(gema));
    // De um passo do mesmo ato antes dela, também (ela está no ato).
    expect(marcaDaMochila(ROTA, 0, [], [], vista)).toBe(chaveDaMarca(gema));
    // Gema que não está na rota: nada.
    expect(marcaDaMochila(ROTA, passo, [], [], { ...vista, gem_id: "Metadata/Items/Gems/NaoExiste" })).toBeNull();
    expect(marcaDaMochila(null, 0, [], [], vista)).toBeNull();
  });

  it("gema de um ato que ainda não chegou não é marcada", () => {
    const atoDoComeco = ROTA.passos[0].ato;
    const depois = todas.find((a) => a.ato !== atoDoComeco && !todas.some((b) => b.ato === atoDoComeco && b.gema.gem_id === a.gema.gem_id));
    expect(depois).toBeDefined();
    const vista = { gem_id: depois!.gema.gem_id, tipo: null, quantas: 1 };
    expect(marcaDaMochila(ROTA, 0, [], [], vista)).toBeNull();
    expect(marcaDaMochila(ROTA, depois!.passo, [], [], vista)).toBe(chaveDaMarca(depois!.gema));
  });

  it("já marcada tantas vezes quantas cópias, ou desmarcada na mão: nada", () => {
    const { gema, passo } = todas[0];
    const chave = chaveDaMarca(gema);
    const vista = { gem_id: gema.gem_id, tipo: null, quantas: 1 };
    expect(marcaDaMochila(ROTA, passo, [chave], [], vista)).toBeNull();
    expect(marcaDaMochila(ROTA, passo, [], [chave], vista)).toBeNull();
  });

  it("a mesma gema como recompensa e como compra: a segunda cópia marca a outra", () => {
    expect(repetida).toBeDefined();
    const { gema } = repetida!;
    const outra = todas.find((b) => b.gema.gem_id === gema.gem_id && b.gema.tipo !== gema.tipo)!;
    const passo = Math.max(repetida!.passo, outra.passo);
    const vista = { gem_id: gema.gem_id, tipo: gema.tipo, quantas: 1 };
    expect(marcaDaMochila(ROTA, passo, [], [], vista)).toBe(chaveDaMarca(gema));
    // Com a janela da outra aberta, vale a outra.
    expect(marcaDaMochila(ROTA, passo, [], [], { ...vista, tipo: outra.gema.tipo })).toBe(chaveDaMarca(outra.gema));
    // Uma já marcada e uma cópia só: é a mesma gema, nada de novo.
    expect(marcaDaMochila(ROTA, passo, [chaveDaMarca(gema)], [], vista)).toBeNull();
    // A segunda cópia marca a outra.
    expect(marcaDaMochila(ROTA, passo, [chaveDaMarca(gema)], [], { ...vista, quantas: 2 })).toBe(chaveDaMarca(outra.gema));
  });
});
