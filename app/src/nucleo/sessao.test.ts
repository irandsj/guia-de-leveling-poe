import { describe, expect, it } from "vitest";

import type { EventoLog } from "../backend";
import {
  ajustarNivel,
  anotarZona,
  anotarZonaInicial,
  aoFecharOJogo,
  aplicarEvento,
  aplicarTecla,
  alternarMarca,
  guardarProgresso,
  irParaAto,
  marcar,
  novaSessao,
  pausarOuRetomar,
  recomecar,
  retomarProgresso,
  situacaoDaSessao,
  VERSAO_DO_PROGRESSO,
  type QuemJoga,
  type Sessao,
} from "./sessao";
import { lerTimer, novoTimer } from "./timer";
import { ROTA } from "./teste/rota-de-exemplo";

const QUEM: QuemJoga = { classe: "Marauder", ascendencia: "Juggernaut" };
const ULTIMO = ROTA.passos.length - 1;

const zona = (area_id: string): EventoLog => ({ tipo: "zona", area_id, nivel_area: 1, seed: 1 });
const entrou = (nome: string): EventoLog => ({ tipo: "entrou", nome });
const nivel = (personagem: string, classe: string, n: number): EventoLog => ({
  tipo: "nivel",
  personagem,
  classe,
  nivel: n,
});
const morte = (personagem: string): EventoLog => ({ tipo: "morte", personagem });

/** Aplica uma lista de [hora, evento] em ordem. */
function rodar(eventos: [number, EventoLog][], inicial: Sessao = novaSessao(), quem: QuemJoga | null = QUEM): Sessao {
  return eventos.reduce((s, [agora, evento]) => aplicarEvento(ROTA, quem, s, evento, agora), inicial);
}

/** Sessão já no passo "matar o Hailrake" (Tidal Island), com o personagem reconhecido. */
function noHailrake(): Sessao {
  const s = rodar([
    [1_000, zona("1_1_1")],
    [2_000, nivel("Bruto", "Marauder", 2)],
    [3_000, zona("1_1_town")],
    [4_000, zona("1_1_2")],
    [5_000, zona("1_1_3")],
    [6_000, zona("1_1_4_1")],
    [7_000, entrou("The Coast")],
    [8_000, zona("1_1_2a")],
  ]);
  expect(ROTA.passos[s.passo].zona).toBe("1_1_2a");
  expect(s.personagem).toBe("Bruto");
  return s;
}

describe("zonas", () => {
  it("a primeira zona liga o cronômetro e guarda onde o jogador está", () => {
    const s = rodar([[1_000, zona("1_1_1")]]);
    expect(s).toMatchObject({ passo: 0, zona_id: "1_1_1", zona_nome: "The Twilight Strand" });
    expect(s.timer).toMatchObject({ desde: 1_000, ato: 1 });
  });

  it("chegar na zona que o passo pede avança a rota", () => {
    const s = rodar([
      [1_000, zona("1_1_1")],
      [60_000, zona("1_1_town")],
    ]);
    expect(s).toMatchObject({ passo: 2, zona_id: "1_1_town", zona_nome: "Lioneye's Watch" });
  });

  it('a linha "You have entered" que vem junto com a zona gerada não conta duas vezes', () => {
    const s = rodar([
      [1_000, zona("1_1_1")],
      [60_000, zona("1_1_town")],
    ]);
    expect(s.aguardando_nome).toBe(true);

    const comNome = aplicarEvento(ROTA, QUEM, s, entrou("Lioneye's Watch"), 60_001);
    expect(comNome).toEqual({ ...s, aguardando_nome: false });
    // Repetida, não muda mais nada.
    expect(aplicarEvento(ROTA, QUEM, comNome, entrou("Lioneye's Watch"), 60_002)).toBe(comNome);
  });

  it("entrada só com o nome (voltou pra uma zona que já existia) também avança", () => {
    const s = rodar([
      [1_000, zona("1_1_1")],
      [2_000, zona("1_1_town")],
      [3_000, entrou("The Coast")],
    ]);
    expect(s).toMatchObject({ passo: 4, zona_id: null, zona_nome: "The Coast", aguardando_nome: false });
  });

  it("nome que não está nos dados (zona renomeada, outro idioma): vale o id da zona gerada", () => {
    const s = rodar([
      [1_000, zona("1_1_1")],
      [1_001, entrou("A Praia do Crepúsculo")],
      [2_000, zona("1_1_town")],
      [2_001, entrou("Vigia de Olho-de-Leão")],
    ]);
    expect(s).toMatchObject({
      passo: 2,
      zona_id: "1_1_town",
      zona_nome: "Vigia de Olho-de-Leão",
      aguardando_nome: false,
    });
    // A tecla de ressincronizar continua achando a zona pelo id.
    expect(aplicarTecla(ROTA, s, "resync", 3_000)).toEqual({ sessao: s, aviso: null });

    // Um segundo nome desconhecido, sem zona gerada antes, já é outro lugar.
    const outroLugar = aplicarEvento(ROTA, QUEM, s, entrou("Outro Lugar"), 4_000);
    expect(outroLugar).toMatchObject({ passo: 2, zona_id: null, zona_nome: "Outro Lugar" });
  });

  it("zona que não é da rota (esconderijo) não mexe no passo", () => {
    const antes = rodar([
      [1_000, zona("1_1_1")],
      [2_000, zona("1_1_town")],
    ]);
    const depois = rodar([[3_000, zona("HideoutBeach")]], antes);
    expect(depois.passo).toBe(antes.passo);
    expect(depois.zona_id).toBe("HideoutBeach");
  });

  it("o ato 1 inteiro pelos eventos, com o tempo de cada ato", () => {
    const fimDoAto1 = ROTA.bordas.indexOf("1_2_1");
    const eventos: [number, EventoLog][] = [];
    for (let borda = 0; borda <= fimDoAto1; borda++) eventos.push([borda * 10_000, zona(ROTA.bordas[borda])]);
    const s = rodar(eventos);

    expect(ROTA.passos[s.passo].ato).toBe(2);
    expect(ROTA.passos[s.passo].zona).toBe("1_2_1");
    const chegada = fimDoAto1 * 10_000;
    expect(lerTimer(s.timer, chegada + 60_000)).toEqual({
      rodando: true,
      total_ms: chegada + 60_000,
      ato_ms: 60_000,
      por_ato: { "1": chegada, "2": 60_000 },
    });
  });
});

describe("personagem e nível", () => {
  it("só segue o personagem da classe do plano", () => {
    const inicio = novaSessao();
    const deOutro = aplicarEvento(ROTA, QUEM, inicio, nivel("Maguinha", "Witch", 5), 1_000);
    expect(deOutro).toBe(inicio);

    const meu = aplicarEvento(ROTA, QUEM, inicio, nivel("Bruto", "Marauder", 2), 2_000);
    expect(meu).toMatchObject({ personagem: "Bruto", nivel: 2 });

    // Outro Marauder na mesma zona: o primeiro já está travado.
    expect(aplicarEvento(ROTA, QUEM, meu, nivel("OutroBruto", "Marauder", 9), 3_000)).toBe(meu);
  });

  it("personagem novo da classe da build no nível 2 da Twilight Strand zera a corrida", () => {
    const antigo = { ...noHailrake(), mortes: 3, marcadas: ["vendedor:Metadata/Items/Gems/Frostblink"] };
    expect(antigo.passo).toBeGreaterThan(0);
    const novo = rodar(
      [
        [20_000, zona("1_1_1")],
        [30_000, nivel("BrutoNovo", "Marauder", 2)],
      ],
      antigo,
    );
    expect(novo).toMatchObject({ personagem: "BrutoNovo", nivel: 2, passo: 0, mortes: 0, zona_id: "1_1_1", marcadas: [] });
    // O cronômetro conta desde a chegada na praia, não desde o nível 2.
    expect(lerTimer(novo.timer, 50_000)).toMatchObject({ rodando: true, total_ms: 30_000, por_ato: { "1": 30_000 } });
    expect(novo.timer).toMatchObject({ inteiro: true, concluidos: {} });

    // Fora da praia do começo, outro Marauder subindo de nível não mexe na corrida.
    expect(aplicarEvento(ROTA, QUEM, antigo, nivel("OutroBruto", "Marauder", 2), 20_000)).toBe(antigo);
    // Nem personagem de outra classe, nem um que já passou do nível 2.
    const naPraia = rodar([[20_000, zona("1_1_1")]], antigo);
    expect(aplicarEvento(ROTA, QUEM, naPraia, nivel("Maguinha", "Witch", 2), 30_000)).toBe(naPraia);
    expect(aplicarEvento(ROTA, QUEM, naPraia, nivel("OutroBruto", "Marauder", 5), 30_000)).toBe(naPraia);
  });

  it("depois de ascender, a classe muda mas o nome é o mesmo", () => {
    const s = rodar([
      [1_000, nivel("Bruto", "Marauder", 32)],
      [2_000, nivel("Bruto", "Juggernaut", 33)],
    ]);
    expect(s).toMatchObject({ personagem: "Bruto", nivel: 33 });
  });

  it("abriu o guia com o personagem já ascendido: reconhece pela ascendência", () => {
    const s = rodar([[1_000, nivel("Bruto", "Juggernaut", 40)]]);
    expect(s).toMatchObject({ personagem: "Bruto", nivel: 40 });
    const deOutra = rodar([[1_000, nivel("Bruto", "Berserker", 40)]]);
    expect(deOutra.personagem).toBeNull();
  });

  it("sem plano, segue o primeiro personagem que subir de nível", () => {
    const s = rodar([[1_000, nivel("Maguinha", "Witch", 5)]], novaSessao(), null);
    expect(s).toMatchObject({ personagem: "Maguinha", nivel: 5 });
  });

  it("situação: enquanto o jogo não diz o nível, vale o chute pela rota", () => {
    expect(situacaoDaSessao(ROTA, novaSessao())).toEqual({ nivel: 1, nivel_conhecido: false, ato: 1, xp: null });

    const noAto3 = irParaAto(ROTA, novaSessao(), 3, 0);
    const chute = situacaoDaSessao(ROTA, noAto3);
    expect(chute).toMatchObject({ nivel_conhecido: false, ato: 3 });
    expect(chute.nivel).toBeGreaterThanOrEqual(22);
    expect(chute.nivel).toBeLessThanOrEqual(32);

    const comNivel = rodar([[1_000, nivel("Bruto", "Marauder", 27)]], noAto3);
    expect(situacaoDaSessao(ROTA, comNivel)).toEqual({ nivel: 27, nivel_conhecido: true, ato: 3, xp: null });
  });

  it("acertar o nível à mão", () => {
    expect(ajustarNivel(novaSessao(), 12.9).nivel).toBe(12);
    expect(ajustarNivel(novaSessao(), 0).nivel).toBe(1);
    expect(ajustarNivel(novaSessao(), -3).nivel).toBe(1);
    expect(ajustarNivel(novaSessao(), 150).nivel).toBe(100);
  });
});

describe("mortes", () => {
  it("só conta as mortes do personagem seguido", () => {
    const semPersonagem = novaSessao();
    expect(aplicarEvento(ROTA, QUEM, semPersonagem, morte("Bruto"), 1_000)).toBe(semPersonagem);

    const meu = rodar([[1_000, nivel("Bruto", "Marauder", 2)]]);
    expect(aplicarEvento(ROTA, QUEM, meu, morte("Maguinha"), 2_000)).toBe(meu);

    const morreu = rodar(
      [
        [3_000, morte("Bruto")],
        [9_000, morte("Bruto")],
      ],
      meu,
    );
    expect(morreu).toMatchObject({ mortes: 2, morreu_em: 9_000 });
  });

  it("morreu e renasceu na cidade: não é a volta à cidade que a rota pede", () => {
    const antes = noHailrake();
    const s = rodar(
      [
        [100_000, morte("Bruto")],
        [110_000, zona("1_1_town")],
      ],
      antes,
    );
    expect(s.passo).toBe(antes.passo);
    expect(s).toMatchObject({ mortes: 1, morreu_em: null, zona_id: "1_1_town" });

    // Volta andando pela Coast até a ilha: o guia continua no Hailrake.
    const voltou = rodar(
      [
        [120_000, entrou("The Coast")],
        [150_000, entrou("The Tidal Island")],
      ],
      s,
    );
    expect(voltou.passo).toBe(antes.passo);

    // Agora matou e saiu pro logout: aí sim conclui.
    const concluiu = rodar([[200_000, zona("1_1_town")]], voltou);
    expect(concluiu.passo).toBe(antes.passo + 2);
  });

  it("o mesmo pelo nome da cidade (a cidade já existia)", () => {
    const antes = noHailrake();
    const s = rodar(
      [
        [100_000, morte("Bruto")],
        [105_000, entrou("Lioneye's Watch")],
      ],
      antes,
    );
    expect(s.passo).toBe(antes.passo);
    expect(s.morreu_em).toBeNull();
  });

  it("morte antiga não segura a ida à cidade", () => {
    const antes = noHailrake();
    const s = rodar(
      [
        [100_000, morte("Bruto")],
        [146_000, zona("1_1_town")],
      ],
      antes,
    );
    expect(s.passo).toBe(antes.passo + 2);
  });

  it("morrer e trocar pra uma zona que não é cidade avança normal", () => {
    const naCosta = rodar([
      [1_000, zona("1_1_1")],
      [2_000, nivel("Bruto", "Marauder", 2)],
      [3_000, zona("1_1_town")],
      [4_000, zona("1_1_2")],
    ]);
    const s = rodar(
      [
        [10_000, morte("Bruto")],
        [15_000, zona("1_1_3")],
      ],
      naCosta,
    );
    expect(ROTA.passos[s.passo].zona).toBe("1_1_3");
    expect(s.morreu_em).toBeNull();
  });
});

describe("teclas", () => {
  it("voltar e avançar um passo", () => {
    const inicio = novaSessao();
    expect(aplicarTecla(ROTA, inicio, "voltar", 0)).toEqual({ sessao: inicio, aviso: null });
    expect(aplicarTecla(ROTA, inicio, "voltar", 0).sessao).toBe(inicio);

    const frente = aplicarTecla(ROTA, inicio, "avancar", 0).sessao;
    expect(frente.passo).toBe(1);
    expect(aplicarTecla(ROTA, frente, "voltar", 0).sessao.passo).toBe(0);
  });

  it("não passa do fim da rota", () => {
    const noFim = { ...novaSessao(), passo: ULTIMO };
    expect(aplicarTecla(ROTA, noFim, "avancar", 0).sessao).toBe(noFim);
  });

  it("avançar à mão pra outro ato leva o cronômetro junto", () => {
    const ultimoDoAto1 = ROTA.inicio_do_ato[2] - 1;
    const s = rodar([[0, zona("1_1_1")]], { ...novaSessao(), passo: ultimoDoAto1 });
    const depois = aplicarTecla(ROTA, s, "avancar", 50_000).sessao;
    expect(depois.passo).toBe(ultimoDoAto1 + 1);
    expect(depois.timer).toMatchObject({ ato: 2, desde: 50_000, por_ato: { "1": 50_000 } });
  });

  it("ressincronizar sem saber a zona: avisa", () => {
    const inicio = novaSessao();
    expect(aplicarTecla(ROTA, inicio, "resync", 0)).toEqual({
      sessao: inicio,
      aviso: "Ainda não sei em que zona você está. Troque de zona no jogo.",
    });
  });

  it("ressincronizar numa zona fora da rota: avisa e não mexe", () => {
    const s = rodar([[1_000, zona("HideoutBeach")]]);
    const resultado = aplicarTecla(ROTA, s, "resync", 2_000);
    expect(resultado.sessao).toBe(s);
    expect(resultado.aviso).toBe('"HideoutBeach" não está na rota.');

    const peloNome = rodar([[1_000, entrou("Esconderijo")]]);
    expect(aplicarTecla(ROTA, peloNome, "resync", 2_000).aviso).toBe('"Esconderijo" não está na rota.');
  });

  it("ressincronizar acerta o passo pela zona em que o jogador está", () => {
    // Abriu o guia já no Mud Flats: longe demais pro avanço automático.
    const s = rodar([[1_000, zona("1_1_3")]]);
    expect(s.passo).toBe(0);
    const resultado = aplicarTecla(ROTA, s, "resync", 2_000);
    expect(resultado.aviso).toBeNull();
    expect(ROTA.passos[resultado.sessao.passo].zona).toBe("1_1_3");
    expect(resultado.sessao.passo).toBe(6);
  });

  it("pular pro começo de um ato", () => {
    const s = irParaAto(ROTA, novaSessao(), 3, 0);
    expect(s.passo).toBe(ROTA.inicio_do_ato[3]);
    expect(s.timer.ato).toBe(3);
    expect(s.timer.desde).toBeNull();
    expect(irParaAto(ROTA, s, 3, 0)).toBe(s);
    expect(irParaAto(ROTA, s, 1, 0).passo).toBe(0);
  });
});

describe("cronômetro da sessão", () => {
  it("pausa à mão: trocar de zona não religa; o jogador religa", () => {
    let s = rodar([[0, zona("1_1_1")]]);
    s = pausarOuRetomar(ROTA, s, 10_000);
    expect(s.timer).toMatchObject({ desde: null, pausado_a_mao: true, total_ms: 10_000 });

    s = rodar([[20_000, zona("1_1_town")]], s);
    expect(s.passo).toBe(2);
    expect(lerTimer(s.timer, 30_000)).toMatchObject({ rodando: false, total_ms: 10_000 });

    s = pausarOuRetomar(ROTA, s, 40_000);
    expect(lerTimer(s.timer, 45_000)).toMatchObject({ rodando: true, total_ms: 15_000 });
  });

  it("o jogo fechou: para sozinho e volta na próxima zona", () => {
    let s = rodar([[0, zona("1_1_1")]]);
    s = aoFecharOJogo(s, 10_000);
    expect(s.timer).toMatchObject({ desde: null, pausado_a_mao: false, total_ms: 10_000 });
    expect(aoFecharOJogo(s, 11_000)).toBe(s);

    s = rodar([[100_000, zona("1_1_1")]], s);
    expect(lerTimer(s.timer, 105_000)).toMatchObject({ rodando: true, total_ms: 15_000 });
  });

  it("subir de nível e morrer não ligam o cronômetro", () => {
    const s = rodar([
      [1_000, nivel("Bruto", "Marauder", 2)],
      [2_000, morte("Bruto")],
    ]);
    expect(s.timer).toEqual(novoTimer());
  });
});

describe("progresso salvo", () => {
  const HASH = "sha256:abc";

  it("ida e volta pelo disco", () => {
    const s = {
      ...noHailrake(),
      conjunto_manual: "g2",
      mortes: 3,
      morreu_em: 7_500,
      mortes_por_ato: { "1": 2, "2": 1 },
    };
    const salvo = JSON.parse(JSON.stringify(guardarProgresso(s, HASH, 20_000))) as unknown;
    const voltou = retomarProgresso(salvo, HASH, ROTA);

    expect(voltou).toMatchObject({
      passo: s.passo,
      nivel: 2,
      personagem: "Bruto",
      mortes: 3,
      conjunto_manual: "g2",
      zona_id: "1_1_2a",
      zona_nome: "The Tidal Island",
      morreu_em: null,
      nivel_da_zona: 1,
      mortes_por_ato: { "1": 2, "2": 1 },
      // A hora da chegada é de antes de o guia fechar: não vale mais.
      chegou_em: null,
    });
    // O cronômetro fecha na hora em que foi salvo: o tempo com o app fechado não conta.
    expect(voltou.timer.desde).toBeNull();
    expect(lerTimer(voltou.timer, 9_999_999)).toMatchObject({ rodando: false, total_ms: 19_000 });
  });

  it("as gemas marcadas como compradas voltam do disco; lixo no arquivo é ignorado", () => {
    let s = alternarMarca(noHailrake(), "vendedor:Metadata/Items/Gems/Frostblink");
    s = alternarMarca(s, "quest:Metadata/Items/Gems/SkillGemSnipersMark");
    s = alternarMarca(s, "quest:Metadata/Items/Gems/SkillGemSnipersMark");
    expect(s.marcadas).toEqual(["vendedor:Metadata/Items/Gems/Frostblink"]);
    const salvo = JSON.parse(JSON.stringify(guardarProgresso(s, HASH, 20_000))) as { sessao: { marcadas: unknown } };
    expect(retomarProgresso(salvo, HASH, ROTA).marcadas).toEqual(["vendedor:Metadata/Items/Gems/Frostblink"]);
    salvo.sessao.marcadas = ["a", 3, null, "a"];
    expect(retomarProgresso(salvo, HASH, ROTA).marcadas).toEqual(["a"]);
    delete (salvo.sessao as { marcadas?: unknown }).marcadas;
    expect(retomarProgresso(salvo, HASH, ROTA).marcadas).toEqual([]);
  });

  it("a marca da mochila só marca: a gema já marcada continua marcada", () => {
    const frostblink = "vendedor:Metadata/Items/Gems/Frostblink";
    const antes = noHailrake();
    const marcada = marcar(antes, frostblink);
    expect(marcada.marcadas).toEqual([frostblink]);
    expect(antes.marcadas).toEqual([]);
    expect(marcar(marcada, frostblink)).toBe(marcada);
    // Depois, o jogador ainda pode desmarcar na mão.
    expect(alternarMarca(marcada, frostblink).marcadas).toEqual([]);
  });

  it("a gema desmarcada na mão fica lembrada até ser marcada de novo na mão, e volta do disco", () => {
    const frostblink = "vendedor:Metadata/Items/Gems/Frostblink";
    const marcada = marcar(noHailrake(), frostblink);
    const desmarcada = alternarMarca(marcada, frostblink);
    expect(desmarcada.marcadas).toEqual([]);
    expect(desmarcada.desmarcadas).toEqual([frostblink]);
    const salvo = JSON.parse(JSON.stringify(guardarProgresso(desmarcada, HASH, 20_000))) as {
      sessao: { desmarcadas: unknown };
    };
    expect(retomarProgresso(salvo, HASH, ROTA).desmarcadas).toEqual([frostblink]);
    salvo.sessao.desmarcadas = "lixo";
    expect(retomarProgresso(salvo, HASH, ROTA).desmarcadas).toEqual([]);
    const de_novo = alternarMarca(desmarcada, frostblink);
    expect(de_novo.marcadas).toEqual([frostblink]);
    expect(de_novo.desmarcadas).toEqual([]);
    // Marcar sozinho não mexe nas desmarcadas (quem decide se marca é marcaDaMochila).
    expect(marcar(desmarcada, frostblink).desmarcadas).toEqual([frostblink]);
  });

  it("progresso de outro plano ou de outra versão: começa do zero", () => {
    const salvo = guardarProgresso(noHailrake(), HASH, 20_000);
    expect(retomarProgresso(salvo, "sha256:outro", ROTA)).toEqual(novaSessao());
    expect(retomarProgresso({ ...salvo, versao: VERSAO_DO_PROGRESSO + 1 }, HASH, ROTA)).toEqual(novaSessao());
  });

  it("arquivo estragado não derruba o guia", () => {
    for (const lixo of [null, undefined, "texto", 42, [], {}, { versao: VERSAO_DO_PROGRESSO, hash_plano: HASH }]) {
      expect(retomarProgresso(lixo, HASH, ROTA), JSON.stringify(lixo)).toEqual(novaSessao());
    }
    const torto = {
      versao: VERSAO_DO_PROGRESSO,
      hash_plano: HASH,
      salvo_em: "ontem",
      sessao: {
        passo: 99_999,
        nivel: 500,
        personagem: "",
        mortes: -3,
        conjunto_manual: 7,
        zona_id: "x".repeat(300),
        zona_nome: null,
        morreu_em: 123,
        timer: { total_ms: "muito" },
        nivel_da_zona: 400,
        chegou_em: 5,
        mortes_por_ato: { "1": -1, x: 2, "3": 1.5 },
      },
    };
    expect(retomarProgresso(torto, HASH, ROTA)).toEqual({ ...novaSessao(), passo: ULTIMO });

    const pelaMetade = { versao: VERSAO_DO_PROGRESSO, hash_plano: HASH, sessao: { passo: 5.8, nivel: 12.4 } };
    expect(retomarProgresso(pelaMetade, HASH, ROTA)).toEqual({ ...novaSessao(), passo: 5, nivel: 12 });
  });
});

describe("sem build importada", () => {
  it("guarda a zona sem mexer no passo nem no cronômetro", () => {
    let s = anotarZona(novaSessao(), zona("1_1_2"));
    expect(s).toEqual({ ...novaSessao(), zona_id: "1_1_2", zona_nome: "The Coast", aguardando_nome: true });
    // A linha com o nome da mesma zona só confirma.
    s = anotarZona(s, entrou("The Coast"));
    expect(s).toEqual({ ...novaSessao(), zona_id: "1_1_2", zona_nome: "The Coast" });
    expect(anotarZona(s, entrou("The Coast"))).toBe(s);
    // Voltou pra uma zona que já existia: só vem o nome.
    s = anotarZona(s, entrou("Lioneye's Watch"));
    expect(s).toEqual({ ...novaSessao(), zona_id: null, zona_nome: "Lioneye's Watch" });
  });

  it("nome que não está nos dados logo depois da zona gerada: fica o id", () => {
    const s = anotarZona(anotarZona(novaSessao(), zona("1_1_2")), entrou("A Costa"));
    expect(s).toMatchObject({ zona_id: "1_1_2", zona_nome: "A Costa", aguardando_nome: false });
  });

  it("nível e morte não mudam nada", () => {
    const s = anotarZona(novaSessao(), zona("1_1_2"));
    expect(anotarZona(s, nivel("Bruto", "Marauder", 2))).toBe(s);
    expect(anotarZona(s, morte("Bruto"))).toBe(s);
  });

  it("a zona guardada serve pra achar o passo quando a build chega", () => {
    const s = anotarZona(anotarZona(novaSessao(), zona("1_1_3")), entrou("The Mud Flats"));
    const achado = aplicarTecla(ROTA, s, "resync", 5_000);
    expect(achado.aviso).toBeNull();
    expect(ROTA.passos[achado.sessao.passo].zona).toBe("1_1_3");
  });
});

describe("zona que o Client.txt mostrava quando o guia abriu", () => {
  it("troca a zona guardada e deixa o resto como estava", () => {
    const antes = noHailrake();
    const depois = anotarZonaInicial(antes, "1_2_1", 13);
    expect(depois).toEqual({
      ...antes,
      zona_id: "1_2_1",
      zona_nome: "The Southern Forest",
      aguardando_nome: false,
      nivel_da_zona: 13,
    });
    expect(depois.passo).toBe(antes.passo);
    expect(depois.timer).toBe(antes.timer);
  });

  it("a mesma zona não muda nada", () => {
    const antes = noHailrake();
    expect(anotarZonaInicial(antes, "1_1_2a", 1)).toBe(antes);
  });

  it("a mesma zona com outro nível só acerta o nível", () => {
    const antes = noHailrake();
    expect(anotarZonaInicial(antes, "1_1_2a", 5)).toEqual({ ...antes, nivel_da_zona: 5 });
  });

  it("cidade não tem nível de monstro", () => {
    expect(anotarZonaInicial(novaSessao(), "1_1_town", 1).nivel_da_zona).toBeNull();
  });
});

describe("recomeçar", () => {
  const MIN = 60_000;

  it("na praia do começo, o cronômetro já sai contando desde a chegada nela", () => {
    const naPraia = rodar([[1_000, zona("1_1_1")]], { ...noHailrake(), mortes: 4 });
    const s = recomecar(naPraia, 61_000);
    expect(s).toMatchObject({ passo: 0, personagem: null, mortes: 0, zona_id: "1_1_1", marcadas: [] });
    expect(lerTimer(s.timer, 61_000)).toMatchObject({ rodando: true, total_ms: 60_000 });
    expect(s.timer.inteiro).toBe(true);

    // O nível 2 do personagem novo só trava o nome; o cronômetro segue.
    const depois = aplicarEvento(ROTA, QUEM, s, nivel("BrutoNovo", "Marauder", 2), 70_000);
    expect(depois).toMatchObject({ personagem: "BrutoNovo", timer: s.timer });
  });

  it("fora da praia, o cronômetro espera o próximo sinal do jogo", () => {
    const s = recomecar(noHailrake(), 50_000);
    expect(s).toEqual({ ...novaSessao(), zona_id: "1_1_2a", zona_nome: "The Tidal Island", chegou_em: 8_000, nivel_da_zona: 1 });
    const naPraia = rodar([[60_000, zona("1_1_1")]], s);
    expect(naPraia.timer).toMatchObject({ desde: 60_000, ato: 1, inteiro: true });
  });

  it("chegada na praia de muito tempo atrás não vira tempo de corrida", () => {
    const naPraia = rodar([[0, zona("1_1_1")]]);
    const s = recomecar(naPraia, 30 * MIN);
    expect(s.timer.desde).toBe(30 * MIN);
  });

  it("guia aberto com o jogador já na praia (sem hora de chegada): conta de agora", () => {
    const s = recomecar(anotarZonaInicial(novaSessao(), "1_1_1", 1), 9_000);
    expect(s.timer.desde).toBe(9_000);
  });
});

describe("nível da zona e experiência", () => {
  it("a zona gerada traz o nível dos monstros; cidade e esconderijo não têm", () => {
    let s = rodar([[1_000, { tipo: "zona", area_id: "1_1_2", nivel_area: 2, seed: 1 }]]);
    expect(s.nivel_da_zona).toBe(2);
    s = rodar([[2_000, { tipo: "zona", area_id: "1_1_town", nivel_area: 1, seed: 1 }]], s);
    expect(s.nivel_da_zona).toBeNull();
    s = rodar([[3_000, { tipo: "zona", area_id: "HideoutFelled", nivel_area: 1, seed: 1 }]], s);
    expect(s.nivel_da_zona).toBeNull();
  });

  it("voltar pra uma zona que já existia: o nível vem dos dados, pelo nome", () => {
    const s = rodar([
      [1_000, zona("1_1_1")],
      [2_000, entrou("The Coast")],
    ]);
    expect(s.nivel_da_zona).toBe(2);
  });

  it("situação: perda de experiência pela diferença de nível", () => {
    const base = { ...novaSessao(), nivel: 20, nivel_da_zona: 20 };
    expect(situacaoDaSessao(ROTA, base).xp).toMatchObject({ multiplicador: 1, perda: 0, diferenca: 0 });
    const acima = situacaoDaSessao(ROTA, { ...base, nivel_da_zona: 10 }).xp;
    expect(acima?.diferenca).toBe(10);
    expect(acima?.perda).toBeGreaterThan(30);
    // Nível chutado ou cidade: sem aviso.
    expect(situacaoDaSessao(ROTA, { ...base, nivel: null }).xp).toBeNull();
    expect(situacaoDaSessao(ROTA, { ...base, nivel_da_zona: null }).xp).toBeNull();
  });
});

describe("mortes e atos concluídos", () => {
  const MIN = 60_000;

  it("cada morte conta no ato em que a rota está", () => {
    let s = rodar([
      [1_000, zona("1_1_1")],
      [2_000, nivel("Bruto", "Marauder", 2)],
      [3_000, morte("Bruto")],
      [4_000, morte("Bruto")],
    ]);
    s = irParaAto(ROTA, s, 2, 5_000);
    s = rodar([[6_000, morte("Bruto")]], s);
    expect(s.mortes).toBe(3);
    expect(s.mortes_por_ato).toEqual({ "1": 2, "2": 1 });
  });

  it("avançar até o ato seguinte conclui o ato; pular pelo modo de edição, não", () => {
    let s = rodar([[0, zona("1_1_1")]]);
    while (situacaoDaSessao(ROTA, s).ato === 1) s = aplicarTecla(ROTA, s, "avancar", 5 * MIN).sessao;
    expect(s.timer.concluidos).toEqual({ "1": 5 * MIN });

    let pulando = rodar([[0, zona("1_1_1")]]);
    pulando = irParaAto(ROTA, pulando, 2, 5 * MIN);
    expect(pulando.timer.concluidos).toEqual({});
    expect(pulando.timer.inteiro).toBe(false);
  });
});
