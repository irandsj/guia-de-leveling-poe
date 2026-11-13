import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import indice from "../dados/layouts.json";
import { Data } from "../terceiros/exile-leveling/src/data";
import {
  PAINEL_FECHADO,
  abrirPainel,
  aoMudarAZona,
  caminhoDoLayout,
  enderecoDaImagem,
  escolherNoPainel,
  layoutsDaZona,
  proximoNoPainel,
  vistaDoPainel,
  zonaComLayout,
  ENDERECO_DA_LEGENDA,
} from "./layouts";

const PUBLICO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

// Zonas usadas nos testes:
const COSTA = "1_1_2"; // 7 layouts
const ILHA = "1_1_2a"; // 1 layout, com caminho e dica
const TEMPLO = "1_3_14_2"; // 1 layout, com "x" e "x_x"
const CIDADE = "1_1_town"; // sem imagens

describe("índice de layouts", () => {
  it("toda zona do índice existe nos dados e toda imagem está no disco", () => {
    const zonas = Object.entries(indice);
    expect(zonas.length).toBeGreaterThan(100);
    for (const [area, imagens] of zonas) {
      expect(Data.Areas[area], area).toBeDefined();
      expect(imagens.length, area).toBeGreaterThan(0);
      for (const nome of imagens) {
        expect(nome, `${area} ${nome}`).toMatch(/^(?:[0-9]{1,2}|x)(?:_(?:[0-9]{1,2}|x))*$/);
        expect(existsSync(join(PUBLICO, enderecoDaImagem(area, nome))), `${area} ${nome}`).toBe(true);
      }
    }
    expect(existsSync(join(PUBLICO, ENDERECO_DA_LEGENDA))).toBe(true);
  });

  it("não sobra imagem no disco fora do índice", () => {
    const pastas = readdirSync(join(PUBLICO, "layouts"), { withFileTypes: true }).filter((e) => e.isDirectory());
    expect(pastas.map((p) => p.name).sort()).toEqual(Object.keys(indice).sort());
    for (const pasta of pastas) {
      const noDisco = readdirSync(join(PUBLICO, "layouts", pasta.name)).sort();
      const noIndice = (indice as Record<string, string[]>)[pasta.name].map((n) => `${n}.jpg`).sort();
      expect(noDisco, pasta.name).toEqual(noIndice);
    }
  });

  it("toda zona tem pelo menos uma pista e todo caminho tem a pista dele", () => {
    for (const [area, imagens] of Object.entries(indice)) {
      const zona = layoutsDaZona(area);
      expect(zona, area).not.toBeNull();
      const doCaminho = imagens.filter((n) => n.includes("_") && !n.startsWith("x"));
      for (const nome of doCaminho) {
        expect(zona?.pistas, `${area} ${nome}`).toContain(nome.split("_")[0]);
      }
    }
  });
});

describe("layoutsDaZona", () => {
  it("separa as pistas das dicas", () => {
    expect(layoutsDaZona(COSTA)).toEqual({
      area_id: COSTA,
      pistas: ["1", "2", "3", "4", "5", "6", "7"],
      dicas: [],
    });
    expect(layoutsDaZona(ILHA)).toEqual({ area_id: ILHA, pistas: ["1"], dicas: ["x"] });
    expect(layoutsDaZona(TEMPLO)).toEqual({ area_id: TEMPLO, pistas: ["1"], dicas: ["x", "x_x"] });
  });

  it("zona sem imagens, desconhecida ou vazia: null", () => {
    expect(layoutsDaZona(CIDADE)).toBeNull();
    expect(layoutsDaZona("HideoutBeach")).toBeNull();
    expect(layoutsDaZona("")).toBeNull();
    expect(layoutsDaZona(null)).toBeNull();
    expect(layoutsDaZona(undefined)).toBeNull();
    // Nomes de propriedades de objeto não são zonas.
    expect(layoutsDaZona("constructor")).toBeNull();
    expect(layoutsDaZona("__proto__")).toBeNull();
  });

  it("o id que termina em sublinhado (Lunaris Temple Level 1 dos atos 6-10) é achado", () => {
    expect(layoutsDaZona("2_8_7_1_")?.pistas).toEqual(["1"]);
  });
});

describe("zonaComLayout", () => {
  it("fica com a primeira zona que tem imagens", () => {
    expect(zonaComLayout(COSTA, ILHA)).toBe(COSTA);
    expect(zonaComLayout(CIDADE, null, ILHA, COSTA)).toBe(ILHA);
    expect(zonaComLayout(null, CIDADE, undefined)).toBeNull();
    expect(zonaComLayout()).toBeNull();
  });
});

describe("caminhoDoLayout", () => {
  it("devolve as imagens de dentro de um layout, na ordem", () => {
    expect(caminhoDoLayout(COSTA, "6")).toEqual(["6_1", "6_2"]);
    expect(caminhoDoLayout("1_1_4_1", "1")).toEqual(["1_1", "1_1_1", "1_2", "1_2_1", "1_2_2"]);
    expect(caminhoDoLayout(COSTA, "9")).toEqual([]);
    expect(caminhoDoLayout(CIDADE, "1")).toEqual([]);
  });

  it("o layout 1 não leva junto as imagens do 10 em diante", () => {
    for (const [area, imagens] of Object.entries(indice)) {
      for (const nome of caminhoDoLayout(area, "1")) {
        expect(nome.split("_")[0], `${area} ${nome}`).toBe("1");
        expect(imagens).toContain(nome);
      }
    }
  });
});

describe("endereço das imagens", () => {
  it("não tem espaço e aponta pra pasta da zona", () => {
    expect(enderecoDaImagem(COSTA, "1_1")).toBe("/layouts/1_1_2/1_1.jpg");
    expect(enderecoDaImagem("2_8_7_1_", "1")).toBe("/layouts/2_8_7_1_/1.jpg");
  });
});

describe("painel de layout", () => {
  it("a tecla abre na grade, passa por cada layout e fecha depois do último", () => {
    let p = proximoNoPainel(PAINEL_FECHADO, COSTA);
    expect(p).toEqual({ aberto: true, area_id: COSTA, escolhido: null });
    for (let k = 0; k < 7; k++) {
      p = proximoNoPainel(p, COSTA);
      expect(p).toEqual({ aberto: true, area_id: COSTA, escolhido: k });
    }
    expect(proximoNoPainel(p, COSTA)).toEqual(PAINEL_FECHADO);
  });

  it("zona com um layout só: abre direto nele e a tecla seguinte fecha", () => {
    const p = proximoNoPainel(PAINEL_FECHADO, ILHA);
    expect(p).toEqual({ aberto: true, area_id: ILHA, escolhido: 0 });
    expect(proximoNoPainel(p, ILHA)).toEqual(PAINEL_FECHADO);
  });

  it("zona sem imagens: abre vazio (pra valer na próxima zona) e a tecla seguinte fecha", () => {
    const p = proximoNoPainel(PAINEL_FECHADO, CIDADE);
    expect(p).toEqual({ aberto: true, area_id: null, escolhido: null });
    expect(vistaDoPainel(p)).toBeNull();
    expect(proximoNoPainel(p, CIDADE)).toEqual(PAINEL_FECHADO);
    expect(abrirPainel(null)).toEqual({ aberto: true, area_id: null, escolhido: null });
  });

  it("com o painel aberto, a zona passada pra tecla não muda nada (só vale ao abrir)", () => {
    const p = proximoNoPainel(abrirPainel(COSTA), ILHA);
    expect(p).toEqual({ aberto: true, area_id: COSTA, escolhido: 0 });
  });

  it("mudar de zona: continua aberto e recomeça na zona nova", () => {
    const naCosta = proximoNoPainel(abrirPainel(COSTA), COSTA);
    expect(naCosta.escolhido).toBe(0);
    expect(aoMudarAZona(naCosta, COSTA)).toBe(naCosta);
    expect(aoMudarAZona(naCosta, "1_1_3")).toEqual({ aberto: true, area_id: "1_1_3", escolhido: null });
    expect(aoMudarAZona(naCosta, ILHA)).toEqual({ aberto: true, area_id: ILHA, escolhido: 0 });
    // Cidade no meio do caminho: fica aberto, sem imagens, e volta sozinho na zona seguinte.
    const naCidade = aoMudarAZona(naCosta, CIDADE);
    expect(naCidade).toEqual({ aberto: true, area_id: null, escolhido: null });
    expect(aoMudarAZona(naCidade, null)).toBe(naCidade);
    expect(aoMudarAZona(naCidade, "HideoutBeach")).toBe(naCidade);
    expect(aoMudarAZona(naCidade, COSTA)).toEqual({ aberto: true, area_id: COSTA, escolhido: null });
  });

  it("fechado continua fechado quando a zona muda", () => {
    expect(aoMudarAZona(PAINEL_FECHADO, COSTA)).toBe(PAINEL_FECHADO);
  });

  it("clique: escolhe um layout ou volta pra grade", () => {
    const grade = abrirPainel(COSTA);
    const quarto = escolherNoPainel(grade, 3);
    expect(quarto).toEqual({ aberto: true, area_id: COSTA, escolhido: 3 });
    expect(escolherNoPainel(quarto, null)).toEqual(grade);
    // Fora da faixa ou quebrado: não muda.
    expect(escolherNoPainel(grade, 7)).toBe(grade);
    expect(escolherNoPainel(grade, -1)).toBe(grade);
    expect(escolherNoPainel(grade, 1.5)).toBe(grade);
    expect(escolherNoPainel(PAINEL_FECHADO, 0)).toBe(PAINEL_FECHADO);
    // Zona de um layout só não tem grade pra voltar.
    const ilha = abrirPainel(ILHA);
    expect(escolherNoPainel(ilha, null)).toBe(ilha);
  });
});

describe("vistaDoPainel", () => {
  it("fechado: nada", () => {
    expect(vistaDoPainel(PAINEL_FECHADO)).toBeNull();
  });

  it("grade: uma imagem por layout, cada uma sabendo qual layout escolhe", () => {
    const vista = vistaDoPainel(abrirPainel(COSTA));
    expect(vista?.area_id).toBe(COSTA);
    expect(vista?.total).toBe(7);
    expect(vista?.atual).toBeNull();
    expect(vista?.imagens.map((i) => i.nome)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(vista?.imagens.map((i) => i.escolhe)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(vista?.imagens[0].endereco).toBe("/layouts/1_1_2/1.jpg");
  });

  it("layout escolhido: a pista, o caminho dele e as dicas", () => {
    const vista = vistaDoPainel(escolherNoPainel(abrirPainel(COSTA), 5));
    expect(vista?.atual).toBe(6);
    expect(vista?.total).toBe(7);
    expect(vista?.imagens.map((i) => i.nome)).toEqual(["6", "6_1", "6_2"]);
    expect(vista?.imagens.every((i) => i.escolhe === null)).toBe(true);
  });

  it("a dica geral aparece na grade; a da segunda parte só com o layout escolhido", () => {
    // Zona com mais de um layout e "x": The Crematorium (ato 3).
    const grade = vistaDoPainel(abrirPainel("1_3_3_1"));
    expect(grade?.atual).toBeNull();
    expect(grade?.imagens.map((i) => i.nome)).toEqual(["1", "2", "3", "4", "5", "6", "7", "x"]);
    expect(grade?.imagens.at(-1)?.escolhe).toBeNull();

    // Zona com "x_x" e sem "x": The Grain Gate (ato 8).
    const semX = vistaDoPainel(abrirPainel("2_8_9"));
    expect(semX?.imagens.map((i) => i.nome)).toEqual(["1", "2", "3"]);
    const comX = vistaDoPainel(escolherNoPainel(abrirPainel("2_8_9"), 1));
    expect(comX?.imagens.map((i) => i.nome)).toEqual(["2", "2_1", "x_x"]);

    const templo = vistaDoPainel(abrirPainel(TEMPLO));
    expect(templo?.atual).toBe(1);
    expect(templo?.imagens.map((i) => i.nome)).toEqual(["1", "1_1", "1_2", "x", "x_x"]);
  });

  it("posição que não existe mais (índice mudou): cai na grade em vez de quebrar", () => {
    const vista = vistaDoPainel({ aberto: true, area_id: COSTA, escolhido: 40 });
    expect(vista?.atual).toBeNull();
    expect(vista?.imagens).toHaveLength(7);
  });
});
