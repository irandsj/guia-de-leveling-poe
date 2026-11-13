import { deflateRaw, gzip } from "pako";
import { describe, expect, it } from "vitest";

import { decodificarCodigo, lerPob, limparTexto, mapearGemId } from "./pob";
import { codificar, POR_NIVEL, xmlDeExemplo } from "./teste/pob-de-exemplo";

function base64(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

describe("decodificarCodigo", () => {
  const xml = xmlDeExemplo(POR_NIVEL);
  const codigo = codificar(xml);

  it("abre o código do PoB (zlib + base64 com - e _)", () => {
    expect(codigo).toMatch(/^[A-Za-z0-9_=-]+$/);
    expect(decodificarCodigo(codigo)).toBe(xml);
  });

  it("aceita espaços, quebras de linha e base64 comum", () => {
    const quebrado = `  ${codigo.slice(0, 50)}\r\n${codigo.slice(50)}\n`;
    expect(decodificarCodigo(quebrado)).toBe(xml);
    const comum = codigo.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
    expect(decodificarCodigo(comum)).toBe(xml);
  });

  it("aceita o XML puro, deflate sem cabeçalho e gzip", () => {
    expect(decodificarCodigo(`\n${xml}`)).toBe(xml);
    const bytes = new TextEncoder().encode(xml);
    expect(decodificarCodigo(base64(deflateRaw(bytes)))).toBe(xml);
    expect(decodificarCodigo(base64(gzip(bytes)))).toBe(xml);
  });

  it("explica quando o texto não é um PoB", () => {
    expect(() => decodificarCodigo("isso não é um código!")).toThrow(/código/);
    expect(() => decodificarCodigo(btoa("texto qualquer sem compressão nenhuma"))).toThrow(/Path of Building/);
    expect(() => decodificarCodigo("AAAA")).toThrow();
  });
});

describe("lerPob", () => {
  const pob = lerPob(xmlDeExemplo(POR_NIVEL));

  it("personagem", () => {
    expect(pob.classe).toBe("Marauder");
    expect(pob.ascendencia).toBe("Juggernaut");
    expect(pob.bandido).toBe("None");
    expect(pob.nivel).toBe(90);
    expect(pob.panteaoMaior).toBe("Lunaris");
    expect(pob.panteaoMenor).toBeNull();
  });

  it("conjuntos de gemas, com o título sem as cores", () => {
    expect(pob.conjuntosGemas.map((c) => c.titulo)).toEqual([
      "Level 1 - 4",
      "Level 4 - 12",
      "Level 12 - 38",
      "Level 38 - Maps",
      "Early Game {1}",
      "Endgame {2,3}",
    ]);
    expect(pob.conjuntoGemasAtivo).toBe("6");
    const primeiro = pob.conjuntosGemas[0].grupos[0];
    expect(primeiro.gemas.map((g) => g.gemId)).toEqual([
      "Metadata/Items/Gems/SkillGemGroundSlam",
      "Metadata/Items/Gems/SupportGemRuthless",
    ]);
    expect(pob.conjuntosGemas[1].grupos[2].rotulo).toBe("Leap Slam @ lvl 10");
  });

  it("quantidade, gema desligada, grupo desligado e habilidade de item", () => {
    const mapas = pob.conjuntosGemas[3];
    expect(mapas.grupos[1].gemas[1].quantidade).toBe(2);
    const inicio = pob.conjuntosGemas[4];
    expect(inicio.grupos[1].ativo).toBe(false);
    expect(inicio.grupos[2].deItem).toBe(true);
    expect(inicio.grupos[3].gemas[1].ativa).toBe(false);
  });

  it("habilidade da árvore ou de modificador também não é gema", () => {
    const lido = lerPob(
      xmlDeExemplo({
        conjuntos: [
          {
            titulo: "Maps",
            grupos: [
              { gemas: ["Boneshatter"] },
              { origem: "Tree:47197", gemas: [{ nome: "Bone Armour", semId: true }] },
              { origem: "Explode", rotulo: "On Kill Monster Explosion", gemas: [{ nome: "On Kill Monster Explosion", semId: true }] },
            ],
          },
        ],
      }),
    );
    expect(lido.conjuntosGemas[0].grupos.map((g) => g.deItem)).toEqual([false, true, true]);
  });

  it("gema Vaal vira a gema comum", () => {
    const vaal = pob.conjuntosGemas[4].grupos[1].gemas[0];
    expect(vaal.gemId).toBe("Metadata/Items/Gems/SkillGemMoltenShell");
    expect(mapearGemId("Metadata/Items/Gems/SkillGemVaalMoltenShell")).toBe("Metadata/Items/Gems/SkillGemMoltenShell");
    expect(mapearGemId("Metadata/Items/Gems/Smite")).toBe("Metadata/Items/Gems/SkillGemSmite");
    expect(mapearGemId("Metadata/Items/Gems/NaoExiste")).toBe("Metadata/Items/Gems/NaoExiste");
  });

  it("árvores", () => {
    expect(pob.arvores.map((a) => a.nos.length)).toEqual([12, 34, 80, 100, 120]);
    expect(pob.arvores[2].titulo).toBe("Level 67 - Merc Lab & Respec");
    expect(pob.arvores[2].maestrias).toBe("{1010,555},{1020,777}");
    expect(pob.arvores[0].versao).toBe("3_28");
    expect(pob.arvores[0].url).toContain("passive-skill-tree");
    expect(pob.arvoreAtiva).toBe(4);
  });

  it("itens e conjuntos de itens", () => {
    expect(pob.itens["1"]).toEqual({ id: "1", raridade: "UNIQUE", nome: "Tabula Rasa", base: "Simple Robe", nivelReq: 0 });
    expect(pob.itens["2"].base).toBe("Vaal Axe");
    expect(pob.itens["2"].nivelReq).toBe(64);
    expect(pob.itens["4"]).toMatchObject({ raridade: "MAGIC", base: "", nivelReq: 60 });
    expect(pob.conjuntosItens.map((c) => c.titulo)).toEqual(["Leveling", "Endgame {2,3}"]);
    expect(pob.conjuntosItens[0].espacos).toContainEqual({ nome: "Body Armour", itemId: "1" });
  });

  it("notas", () => {
    expect(pob.notas).toContain("LEVELING");
  });

  it("formato antigo: gemas sem SkillSet e sem gemId", () => {
    const antigo = lerPob(
      xmlDeExemplo({
        comSkillSet: false,
        conjuntos: [
          {
            titulo: "",
            grupos: [{ gemas: [{ nome: "Sunder", semId: true }, { nome: "Faster Attacks Support", semId: true }] }],
          },
        ],
      }),
    );
    expect(antigo.conjuntosGemas).toHaveLength(1);
    expect(antigo.conjuntosGemas[0].grupos[0].gemas.map((g) => g.gemId)).toEqual([
      "Metadata/Items/Gems/SkillGemSunder",
      "Metadata/Items/Gems/SupportGemFasterAttack",
    ]);
  });

  it("bandido desconhecido vira None", () => {
    expect(lerPob(xmlDeExemplo({ bandido: "Alira", conjuntos: [] })).bandido).toBe("Alira");
    expect(lerPob(xmlDeExemplo({ bandido: "Qualquer", conjuntos: [] })).bandido).toBe("None");
  });

  it("recusa o que não é PoB de PoE 1", () => {
    expect(() => lerPob(xmlDeExemplo({ raiz: "PathOfBuilding2", conjuntos: [] }))).toThrow(/PoE 2/);
    expect(() => lerPob("<html><body>oi</body></html>")).toThrow(/Path of Building/);
    expect(() => lerPob("<PathOfBuilding><Build")).toThrow();
    expect(() => lerPob("<PathOfBuilding></PathOfBuilding>")).toThrow(/Build/);
  });
});

describe("limparTexto", () => {
  it("tira as cores do PoB", () => {
    expect(limparTexto("^xE05030Endgame ^7{2}")).toBe("Endgame {2}");
    expect(limparTexto("  ^1Level 12 ")).toBe("Level 12");
  });
});
