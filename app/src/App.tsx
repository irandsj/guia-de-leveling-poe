// A janela do guia: junta a build, a rota e a corrida, ouve o Client.txt e as teclas, e guarda tudo.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import {
  backend,
  type AcaoDeTecla,
  type Config,
  type EstadoJanela,
  type EventoLog,
  type Inicial,
  type NomeDeDados,
  type PainelDoJogo,
  type SituacaoDaArvore,
  type StatusLog,
} from "./backend";
import { usarGuiaDaArvore, vistaDaArvore } from "./arvore";
import {
  arvoreAlvo,
  arvoreDepoisDe,
  etapaDeGemas,
  etapasDaArvore,
  itensDaFase,
} from "./nucleo/conjuntos";
import {
  PAINEL_FECHADO,
  abrirPainel,
  aoMudarAZona,
  escolherNoPainel,
  proximoNoPainel,
  zonaComLayout,
  type PainelDeLayout,
} from "./nucleo/layouts";
import { atualizarPlano, ehPlano, gemasNecessarias, type Plano } from "./nucleo/plano";
import {
  PREFERENCIAS_PADRAO,
  corDoFundo,
  lerPreferencias,
  opcoesDaRota,
  proximaFormaDaTecla,
  type Blocos,
  type Forma,
  type Preferencias,
} from "./nucleo/preferencias";
import { montarRota, type OpcoesRota, type Rota } from "./nucleo/rota";
import {
  ajustarNivel,
  alternarMarca,
  anotarZona,
  anotarZonaInicial,
  aoFecharOJogo,
  aplicarEvento,
  aplicarTecla,
  guardarProgresso,
  irParaAto,
  novaSessao,
  pausarOuRetomar,
  recomecar,
  retomarProgresso,
  situacaoDaSessao,
  type Sessao,
} from "./nucleo/sessao";
import { anotarAto, atosRecemConcluidos, lerRecordes, novosRecordes, textoDoAto, type Recordes } from "./nucleo/recordes";
import { novoTimer } from "./nucleo/timer";
import { passoEquivalente, posicaoNoAto } from "./nucleo/vista";
import { alvosDaTela, chaveDosAlvos } from "./nucleo/alvos";
import { mandarAlvos } from "./visao";
import { Bolinha, BotoesDaForma, segurarPraArrastar, usarFormaDaJanela } from "./ui/Balao";
import { buscasDaLoja } from "./nucleo/busca";
import { temAscendencia } from "./nucleo/ascendencia";
import { QuadroDaAscendencia, usarAscendencia } from "./ui/Ascendencia";
import { Edicao, type Acoes, type Visto } from "./ui/Edicao";
import { AvisoDoFiltro, usarFiltroErrado } from "./ui/FiltroDaBuild";
import { FaixaDeItens, Jogo } from "./ui/Jogo";

/** Quanto tempo o aviso de uma tecla fica na tela. */
const TEMPO_DO_AVISO_MS = 6_000;
/** Quanto tempo o conjunto novo (de gemas ou de itens) fica em destaque. */
const TEMPO_DO_DESTAQUE_MS = 120_000;
/** Espera depois da última mudança antes de gravar o progresso. */
const ESPERA_PRA_GRAVAR_MS = 1_200;
/** Com o cronômetro contando, grava de tempos em tempos pra não perder o tempo numa queda. */
const GRAVAR_A_CADA_MS = 30_000;

// Montar a rota custa (centenas de passos), então a última fica guardada.
let rotaGuardada: { plano: Plano; liga_nova: boolean; biblioteca: boolean; rota: Rota | null } | null = null;

function rotaDe(plano: Plano, opcoes: OpcoesRota): Rota | null {
  const g = rotaGuardada;
  if (g && g.plano === plano && g.liga_nova === opcoes.liga_nova && g.biblioteca === opcoes.biblioteca) {
    return g.rota;
  }
  let rota: Rota | null = null;
  try {
    rota = montarRota(
      { classe: plano.personagem.classe, bandido: plano.personagem.bandido },
      gemasNecessarias(plano),
      opcoes,
    );
  } catch (erro) {
    console.error("Não consegui montar a rota:", erro);
  }
  rotaGuardada = { plano, liga_nova: opcoes.liga_nova, biblioteca: opcoes.biblioteca, rota };
  return rota;
}

function lerJson(texto: string | null): unknown {
  if (texto === null) return null;
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    return null;
  }
}

function textoDoErro(erro: unknown): string {
  if (typeof erro === "string") return erro;
  if (erro instanceof Error) return erro.message;
  return String(erro);
}

function juntarVistos(doArquivo: Visto[], aoVivo: Visto[]): Visto[] {
  const porNome = new Map<string, Visto>();
  for (const visto of [...doArquivo, ...aoVivo]) porNome.set(visto.personagem, visto);
  return [...porNome.values()];
}

/**
 * O conjunto da vez mudou sozinho (mesma build, guia já carregado): `true` por um tempo, pro painel
 * destacar o conjunto novo.
 */
function usarDestaque(carregado: boolean, plano: Plano | null, id: string | null): boolean {
  const [destaque, setDestaque] = useState<string | null>(null);
  const antesRef = useRef<{ plano: Plano | null; id: string | null }>({ plano: null, id: null });
  useEffect(() => {
    const antes = antesRef.current;
    antesRef.current = { plano, id };
    const mudou = carregado && antes.plano === plano && antes.id !== null && id !== null && antes.id !== id;
    setDestaque(mudou ? id : null);
  }, [carregado, plano, id]);
  useEffect(() => {
    if (destaque === null) return;
    const relogio = window.setTimeout(() => setDestaque(null), TEMPO_DO_DESTAQUE_MS);
    return () => window.clearTimeout(relogio);
  }, [destaque]);
  return destaque !== null && destaque === id;
}

export function App() {
  const [inicial, setInicial] = useState<Inicial | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoJanela | null>(null);
  const [log, setLog] = useState<StatusLog | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [prefs, setPrefs] = useState<Preferencias>(PREFERENCIAS_PADRAO);
  const [plano, setPlano] = useState<Plano | null>(null);
  const [sessao, setSessao] = useState<Sessao>(novaSessao);
  const [recordes, setRecordes] = useState<Recordes>(novosRecordes);
  const [carregado, setCarregado] = useState(false);
  const [painel, setPainel] = useState<PainelDeLayout>(PAINEL_FECHADO);
  const [vistosAoVivo, setVistosAoVivo] = useState<Visto[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  /** O que a foto da tela mostrou da árvore de passivas. Vem do programa e nunca entra na sessão. */
  const [situacaoDaArvore, setSituacaoDaArvore] = useState<SituacaoDaArvore | null>(null);
  /**
   * Etapa da árvore completada antes do nível dela: o guia segue pra próxima. Vale pra esta build e
   * enquanto o nível não baixar (personagem novo volta pro começo).
   */
  const [arvoreAdiante, setArvoreAdiante] = useState({ build: "", nivel: 0, minimo: 0 });
  /**
   * Etapa da árvore que o jogador pôs na mão (setas do balão, lista ou setas do teclado), pra voltar
   * e ver o que ficou pra trás (uma maestria, por exemplo) ou espiar a próxima. Vale enquanto a etapa
   * automática for a mesma de quando escolheu: quando o nível leva pra etapa seguinte, volta pro automático.
   */
  const [arvoreEscolhida, setArvoreEscolhida] = useState<{ build: string; automatica: string; indice: number } | null>(
    null,
  );
  /**
   * Um painel da esquerda do jogo (Mundo, Baú…) abriu por baixo do balão: ele vira bolinha até o
   * painel fechar, sem mexer na forma guardada. Abrir a bolinha nesse meio tempo vale até o painel fechar.
   */
  const [bolinhaPeloPainel, setBolinhaPeloPainel] = useState(false);
  const bolinhaPeloPainelRef = useRef(false);
  const painelDispensadoRef = useRef(false);

  const rota = plano ? rotaDe(plano, opcoesDaRota(prefs)) : null;
  const situacao = rota ? situacaoDaSessao(rota, sessao) : null;
  const minimoDaArvore =
    plano && situacao && arvoreAdiante.build === plano.fonte.hash_codigo && situacao.nivel >= arvoreAdiante.nivel
      ? arvoreAdiante.minimo
      : 0;
  const etapaAutomatica = plano && situacao ? arvoreAlvo(plano, situacao, minimoDaArvore) : null;
  const etapasComGatilho = plano ? etapasDaArvore(plano) : [];
  const escolhidaDaArvore =
    plano &&
    etapaAutomatica &&
    arvoreEscolhida &&
    arvoreEscolhida.build === plano.fonte.hash_codigo &&
    arvoreEscolhida.automatica === etapaAutomatica.id &&
    arvoreEscolhida.indice < etapasComGatilho.length
      ? arvoreEscolhida.indice
      : null;
  const etapaDaArvore =
    plano && situacao ? arvoreAlvo(plano, situacao, minimoDaArvore, escolhidaDaArvore) : null;
  // A árvore manda na fase: gemas e itens viram de conjunto junto com ela (a automática: olhar
  // outra etapa da árvore não troca as gemas).
  const escolha = plano && situacao ? etapaDeGemas(plano, situacao, sessao.conjunto_manual, minimoDaArvore) : null;
  const etapaId = escolha?.etapa?.id ?? null;
  const escolhaDeItens = plano && situacao ? itensDaFase(plano, situacao, minimoDaArvore) : null;
  const passoAtual = rota?.passos[sessao.passo];
  const zonaDoLayout = zonaComLayout(sessao.zona_id, passoAtual?.zona, passoAtual?.zona_depois);
  const vistos = juntarVistos(log?.resumo?.niveis ?? [], vistosAoVivo);

  // O valor mais novo de cada coisa, pra quem responde a eventos de fora (Client.txt, teclas, relógios).
  const planoRef = useRef(plano);
  const rotaRef = useRef(rota);
  const sessaoRef = useRef(sessao);
  const prefsRef = useRef(prefs);
  const configRef = useRef(config);
  const logRef = useRef(log);
  const vistosRef = useRef(vistos);
  const zonaDoLayoutRef = useRef(zonaDoLayout);
  const recordesRef = useRef(recordes);
  const etapaAutomaticaRef = useRef(etapaAutomatica);
  const etapaDaArvoreRef = useRef(etapaDaArvore);
  const carregadoRef = useRef(false);
  /** Já chegou zona pelo Client.txt com o guia aberto: a do resumo inicial não vale mais. */
  const zonaAoVivoRef = useRef(false);
  /** Eventos que chegaram antes de os dados do disco serem lidos. */
  const pendentesRef = useRef<EventoLog[]>([]);
  const gravadosRef = useRef<Partial<Record<NomeDeDados, string>>>({});
  const relogioDoAvisoRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    planoRef.current = plano;
    rotaRef.current = rota;
    sessaoRef.current = sessao;
    prefsRef.current = prefs;
    configRef.current = config;
    vistosRef.current = vistos;
    zonaDoLayoutRef.current = zonaDoLayout;
    etapaAutomaticaRef.current = etapaAutomatica;
    etapaDaArvoreRef.current = etapaDaArvore;
  });

  function avisar(texto: string | null) {
    window.clearTimeout(relogioDoAvisoRef.current);
    setAviso(texto);
    if (texto !== null) {
      relogioDoAvisoRef.current = window.setTimeout(() => setAviso(null), TEMPO_DO_AVISO_MS);
    }
  }

  function gravar(nome: NomeDeDados, texto: string): Promise<void> {
    if (gravadosRef.current[nome] === texto) return Promise.resolve();
    gravadosRef.current[nome] = texto;
    return backend.gravarDados(nome, texto).catch((erro: unknown) => {
      delete gravadosRef.current[nome];
      avisar(`Não consegui gravar: ${textoDoErro(erro)}`);
    });
  }

  function gravarProgresso(): Promise<void> {
    const p = planoRef.current;
    if (!carregadoRef.current || !p) return Promise.resolve();
    const progresso = guardarProgresso(sessaoRef.current, p.fonte.hash_codigo, Date.now());
    return gravar("progresso", JSON.stringify(progresso));
  }

  function aoEvento(evento: EventoLog) {
    if (!carregadoRef.current) {
      pendentesRef.current.push(evento);
      return;
    }
    if (evento.tipo === "zona" || evento.tipo === "entrou") zonaAoVivoRef.current = true;
    if (evento.tipo === "nivel") {
      const visto: Visto = { personagem: evento.personagem, classe: evento.classe, nivel: evento.nivel };
      setVistosAoVivo((lista) => [...lista.filter((v) => v.personagem !== visto.personagem), visto]);
    }
    const r = rotaRef.current;
    const p = planoRef.current;
    if (!r || !p) {
      setSessao((s) => anotarZona(s, evento));
      return;
    }
    const quem = { classe: p.personagem.classe, ascendencia: p.personagem.ascendencia };
    const agora = Date.now();
    setSessao((s) => aplicarEvento(r, quem, s, evento, agora));
  }

  function aoStatus(status: StatusLog) {
    logRef.current = status;
    setLog(status);
    const zona = status.resumo?.zona;
    if (zona && carregadoRef.current && !zonaAoVivoRef.current) {
      setSessao((s) => anotarZonaInicial(s, zona.area_id, zona.nivel_area));
    }
  }

  function mudarBolinhaPeloPainel(valor: boolean) {
    bolinhaPeloPainelRef.current = valor;
    setBolinhaPeloPainel(valor);
  }

  function aoPainel(painelDoJogo: PainelDoJogo) {
    if (!painelDoJogo.aberto) {
      painelDispensadoRef.current = false;
      mudarBolinhaPeloPainel(false);
    } else if (painelDoJogo.cobre && !painelDispensadoRef.current && prefsRef.current.forma !== "bolinha") {
      mudarBolinhaPeloPainel(true);
    }
  }

  /** O jogador abriu a bolinha com o painel do jogo ainda aberto: fica aberta até o painel fechar. */
  function dispensarBolinhaDoPainel() {
    painelDispensadoRef.current = true;
    mudarBolinhaPeloPainel(false);
  }

  /** Põe na mão a etapa `indice` da árvore (`null`, ou a própria automática, volta pro automático). */
  function escolherEtapaDaArvore(indice: number | null) {
    const p = planoRef.current;
    const automatica = etapaAutomaticaRef.current;
    const etapas = p ? etapasDaArvore(p) : [];
    if (!p || !automatica || indice === null || indice < 0 || indice >= etapas.length || etapas[indice] === automatica) {
      etapaDaArvoreRef.current = automatica;
      setArvoreEscolhida(null);
      return;
    }
    etapaDaArvoreRef.current = etapas[indice];
    setArvoreEscolhida({ build: p.fonte.hash_codigo, automatica: automatica.id, indice });
  }

  /** Anda `passos` etapas na árvore (setas do balão e do teclado), sem passar da primeira nem da última. */
  function andarNaArvore(passos: number) {
    const p = planoRef.current;
    const atual = etapaDaArvoreRef.current;
    if (!p || !atual) return;
    const etapas = etapasDaArvore(p);
    const i = etapas.indexOf(atual);
    if (i < 0) return;
    const novo = Math.min(Math.max(i + passos, 0), etapas.length - 1);
    if (novo !== i) escolherEtapaDaArvore(novo);
  }

  function aoTecla(acao: AcaoDeTecla) {
    if (!carregadoRef.current) return;
    if (acao === "forma" && bolinhaPeloPainelRef.current) {
      dispensarBolinhaDoPainel();
      return;
    }
    if (acao === "forma") {
      // Bolinha → meio (detalhado) → expandido → bolinha. Funciona mesmo sem build.
      const atual = prefsRef.current.forma;
      const nova = proximaFormaDaTecla(atual);
      if (nova === "bolinha") formaAntesDaBolinha.current = atual;
      prefsRef.current = { ...prefsRef.current, forma: nova };
      setPrefs((p) => ({ ...p, forma: nova }));
      return;
    }
    if (acao === "arvore_anterior" || acao === "arvore_proxima") {
      andarNaArvore(acao === "arvore_anterior" ? -1 : 1);
      return;
    }
    const r = rotaRef.current;
    if (!r) {
      const tecla = configRef.current?.atalhos.interacao;
      avisar(`Sem build. ${tecla ? `Aperte ${tecla} e cole` : "Cole"} o link ou o código do Path of Building.`);
      return;
    }
    if (acao === "layout") {
      setPainel((p) => proximoNoPainel(p, zonaDoLayoutRef.current));
      return;
    }
    const agora = Date.now();
    avisar(aplicarTecla(r, sessaoRef.current, acao, agora).aviso);
    setSessao((s) => aplicarTecla(r, s, acao, agora).sessao);
  }

  // Liga os ouvintes uma vez e lê o que estava no disco.
  useEffect(() => {
    let vivo = true;
    let parar: (() => void) | undefined;
    void (async () => {
      try {
        const pararDeOuvir = await backend.ouvir({
          estado: setEstado,
          logStatus: aoStatus,
          logEvento: aoEvento,
          tecla: aoTecla,
          arvore: setSituacaoDaArvore,
          painel: aoPainel,
        });
        if (!vivo) {
          pararDeOuvir();
          return;
        }
        parar = pararDeOuvir;

        const dados = await backend.iniciar();
        const ler = (nome: NomeDeDados) => backend.lerDados(nome).catch(() => null);
        const [textoDasPrefs, textoDoPlano, textoDoProgresso, textoDosRecordes] = await Promise.all([
          ler("preferencias"),
          ler("plano"),
          ler("progresso"),
          ler("recordes"),
        ]);
        if (!vivo) return;

        const prefsLidas = lerPreferencias(lerJson(textoDasPrefs));
        const planoBruto = lerJson(textoDoPlano);
        const planoLido = ehPlano(planoBruto) ? atualizarPlano(planoBruto) : null;
        const rotaLida = planoLido ? rotaDe(planoLido, opcoesDaRota(prefsLidas)) : null;
        let sessaoLida =
          planoLido && rotaLida
            ? retomarProgresso(lerJson(textoDoProgresso), planoLido.fonte.hash_codigo, rotaLida)
            : novaSessao();
        const logAtual = logRef.current ?? dados.log;
        const zona = logAtual.resumo?.zona;
        if (zona) sessaoLida = anotarZonaInicial(sessaoLida, zona.area_id, zona.nivel_area);
        const recordesLidos = lerRecordes(lerJson(textoDosRecordes));

        // O que acabou de ser lido não precisa ser gravado de volta.
        gravadosRef.current.preferencias = JSON.stringify(prefsLidas);
        if (textoDoPlano !== null && planoLido) gravadosRef.current.plano = textoDoPlano;
        gravadosRef.current.recordes = JSON.stringify(recordesLidos);

        logRef.current = logAtual;
        planoRef.current = planoLido;
        rotaRef.current = rotaLida;
        sessaoRef.current = sessaoLida;
        prefsRef.current = prefsLidas;
        configRef.current = dados.config;
        recordesRef.current = recordesLidos;
        carregadoRef.current = true;

        setInicial(dados);
        setConfig(dados.config);
        setEstado((atual) => atual ?? dados.estado);
        setLog(logAtual);
        setPrefs(prefsLidas);
        setPlano(planoLido);
        setSessao(sessaoLida);
        setRecordes(recordesLidos);
        if (prefsLidas.layout_aberto) {
          const passo = rotaLida?.passos[sessaoLida.passo];
          setPainel(abrirPainel(zonaComLayout(sessaoLida.zona_id, passo?.zona, passo?.zona_depois)));
        }
        setCarregado(true);

        for (const evento of pendentesRef.current.splice(0)) aoEvento(evento);
      } catch (erro) {
        if (vivo) setFalha(`Não consegui iniciar o guia: ${textoDoErro(erro)}`);
      }
    })();
    return () => {
      vivo = false;
      parar?.();
      window.clearTimeout(relogioDoAvisoRef.current);
    };
    // Só uma vez: os ouvintes usam refs e funções de estado, que não mudam entre os desenhos.
  }, []);

  // O painel de layout acompanha a zona.
  useEffect(() => {
    setPainel((p) => aoMudarAZona(p, zonaDoLayout));
  }, [zonaDoLayout]);

  // Leitura de tela: na cidade, o programa procura na tela as gemas que a build ainda vai pegar neste ato.
  const alvos = carregado ? alvosDaTela(rota, sessao.passo, sessao.zona_id, prefs.marcar_gemas, sessao.marcadas) : [];
  const chaveAlvos = chaveDosAlvos(alvos);
  const alvosRef = useRef(alvos);
  useEffect(() => {
    alvosRef.current = alvos;
  });
  useEffect(() => {
    void mandarAlvos(alvosRef.current).catch((erro: unknown) => console.error("Leitura de tela:", erro));
  }, [chaveAlvos]);

  // Guia da árvore: o programa recebe a ordem dos nós da build e desenha por cima da árvore do jogo.
  // (Vale também com o painel escondido: só a preferência desliga.)
  const guiaDaArvore = usarGuiaDaArvore(
    carregado ? plano : null,
    situacao,
    prefs.guia_da_arvore,
    backend,
    minimoDaArvore,
    escolhidaDaArvore,
  );
  // A árvore da etapa ficou pronta antes do nível da próxima: o guia já segue pra próxima etapa do
  // PoB, pra sempre ter os próximos pontos (a ordem começa do início, então nada que faltou fica pra trás).
  // Com a etapa escolhida na mão, não: o jogador está olhando outra etapa de propósito.
  const arvorePronta =
    escolhidaDaArvore === null &&
    guiaDaArvore !== null &&
    situacao !== null &&
    vistaDaArvore(guiaDaArvore, situacaoDaArvore, situacao, false).completa;
  const nivelAgora = situacao?.nivel ?? 0;
  useEffect(() => {
    if (!arvorePronta || !plano || !etapaDaArvore) return;
    const minimo = arvoreDepoisDe(plano, etapaDaArvore);
    if (minimo === null) return;
    setArvoreAdiante({ build: plano.fonte.hash_codigo, nivel: nivelAgora, minimo });
  }, [arvorePronta, plano, etapaDaArvore, nivelAgora]);

  // O jogo fechou: o cronômetro para.
  const jogoAberto = estado?.jogo_aberto ?? false;
  const jogoAbertoAntesRef = useRef(false);
  useEffect(() => {
    if (jogoAbertoAntesRef.current && !jogoAberto) {
      const agora = Date.now();
      setSessao((s) => aoFecharOJogo(s, agora));
    }
    jogoAbertoAntesRef.current = jogoAberto;
  }, [jogoAberto]);

  // Sem build: o guia abre na frente, no meio da tela, já pedindo a build (e depois o filtro).
  // Na hora em que carrega e de novo quando o jogo abre. Ao sair da edição ele volta pro lugar dele.
  const semBuild = carregado && plano === null;
  const jogoNaBoasVindasRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!semBuild) {
      jogoNaBoasVindasRef.current = null;
      return;
    }
    const antes = jogoNaBoasVindasRef.current;
    jogoNaBoasVindasRef.current = jogoAberto;
    if (antes === null || (!antes && jogoAberto)) void backend.abrirNoCentro().catch(() => undefined);
  }, [semBuild, jogoAberto]);

  // Ato concluído inteiro: anota nos recordes e avisa o tempo. Os que já estavam concluídos quando
  // o guia abriu entram calados (anotar o mesmo tempo de novo não muda nada).
  const concluidos = sessao.timer.concluidos;
  const concluidosAntesRef = useRef<Record<string, number> | null>(null);
  useEffect(() => {
    if (!carregado) return;
    const antes = concluidosAntesRef.current;
    concluidosAntesRef.current = concluidos;
    const novos = atosRecemConcluidos(antes ?? {}, concluidos);
    if (novos.length === 0) return;
    let r = recordesRef.current;
    const frases: string[] = [];
    const agora = Date.now();
    for (const ato of novos) {
      const ms = concluidos[ato];
      const anotado = anotarAto(r, ato, ms, sessaoRef.current.mortes_por_ato[ato] ?? 0, agora);
      r = anotado.recordes;
      frases.push(textoDoAto(ato, ms, anotado));
    }
    if (r !== recordesRef.current) {
      recordesRef.current = r;
      setRecordes(r);
      void gravar("recordes", JSON.stringify(r));
    }
    if (antes !== null) avisar(frases.join(" "));
  }, [carregado, concluidos]);

  // O conjunto de gemas ou de itens trocou (a árvore virou de etapa): destaque por um tempo.
  const trocou = usarDestaque(carregado, plano, etapaId);
  const trocouItens = usarDestaque(carregado, plano, escolhaDeItens?.etapa?.id ?? null);

  // Gravação: preferências na hora, progresso um pouco depois da última mudança.
  useEffect(() => {
    if (!carregado) return;
    setPrefs((p) => (p.layout_aberto === painel.aberto ? p : { ...p, layout_aberto: painel.aberto }));
  }, [carregado, painel.aberto]);
  useEffect(() => {
    if (carregado) void gravar("preferencias", JSON.stringify(prefs));
  }, [carregado, prefs]);
  // (`gravarProgresso` lê a sessão e a build pelas refs, na hora em que o relógio dispara.)
  useEffect(() => {
    if (!carregado || !plano) return;
    const id = window.setTimeout(() => void gravarProgresso(), ESPERA_PRA_GRAVAR_MS);
    return () => window.clearTimeout(id);
  }, [carregado, plano, sessao]);
  const cronometroContando = sessao.timer.desde !== null;
  useEffect(() => {
    if (!carregado || !plano || !cronometroContando) return;
    const id = window.setInterval(() => void gravarProgresso(), GRAVAR_A_CADA_MS);
    return () => window.clearInterval(id);
  }, [carregado, plano, cronometroContando]);

  // A janela fica do tamanho do balão (expandido, detalhado, resumido ou bolinha).
  const painelRef = useRef<HTMLDivElement>(null);
  // A bolinha reabre na forma em que o balão estava antes de virar bolinha.
  const formaAntesDaBolinha = useRef<Forma>("detalhado");
  const formaDoBalao: Forma = bolinhaPeloPainel ? "bolinha" : prefs.forma;
  // As buscas da loja: as das notas da build (as da etapa da vez e as da build toda) e a das gemas
  // do conjunto de agora. Avançam junto com a árvore. Os botões ficam numa janelinha à parte, que o
  // programa põe embaixo do campo de busca do Baú ou do vendedor.
  const etapaDasGemas = escolha?.etapa ?? null;
  const nivelDaFase = situacao?.nivel ?? null;
  const atoDaFase = situacao?.ato ?? null;
  const buscas = useMemo(
    () =>
      plano
        ? buscasDaLoja(
            plano,
            etapaDasGemas,
            nivelDaFase !== null && atoDaFase !== null
              ? { situacao: { nivel: nivelDaFase, ato: atoDaFase }, minimo: minimoDaArvore }
              : null,
          )
        : [],
    [plano, etapaDasGemas, nivelDaFase, atoDaFase, minimoDaArvore],
  );
  useEffect(() => {
    void backend.definirBuscas(buscas).catch(() => undefined);
  }, [buscas]);
  // A ascendência e o panteão da build: no balão, em roxo, com a árvore de passivas aberta.
  const ascendencia = usarAscendencia(carregado ? plano : null);
  const comAscendencia =
    ascendencia !== null && temAscendencia(ascendencia) && (Boolean(situacaoDaArvore?.aberta) || (estado?.edicao ?? false));
  // O jogo ficou noutro filtro (não no que o jogador criou pra esta build): o balão avisa.
  const filtroErrado = usarFiltroErrado(carregado ? plano : null, prefs.avisar_filtro, estado?.edicao ?? false);
  usarFormaDaJanela(
    formaDoBalao,
    estado?.edicao ?? false,
    carregado && Boolean(estado?.visivel),
    painelRef,
    backend.definirForma,
  );

  if (falha) {
    return (
      <div className="painel">
        <div className="erro">{falha}</div>
      </div>
    );
  }
  if (!inicial || !estado || !config || !estado.visivel) return null;

  const edicao = estado.edicao;
  const teclas = config.atalhos;

  async function sair() {
    await gravarProgresso();
    await backend.fechar();
  }

  const acoes: Acoes = {
    adotarPlano(novo) {
      const rotaNova = rotaDe(novo, opcoesDaRota(prefsRef.current));
      if (!rotaNova) return { ok: false, mensagem: "Não consegui montar a rota desta build." };
      const atual = planoRef.current;
      const rotaAntiga = rotaRef.current;
      const mesmoPersonagem =
        atual !== null &&
        rotaAntiga !== null &&
        atual.personagem.classe === novo.personagem.classe &&
        atual.personagem.bandido === novo.personagem.bandido;
      setPlano(novo);
      avisar(null);
      setSessao((s) =>
        mesmoPersonagem && rotaAntiga
          ? { ...s, passo: passoEquivalente(rotaAntiga, rotaNova, s.passo), conjunto_manual: null }
          : recomecar(s, Date.now()),
      );
      void gravar("plano", JSON.stringify(novo));
      return {
        ok: true,
        mensagem: mesmoPersonagem ? "Build trocada. O passo, o nível e o tempo continuam." : "Build importada.",
      };
    },
    removerPlano() {
      // "null" é lido como "sem build" na próxima vez que o guia abrir. A tela volta pro começo
      // (a boas-vindas no meio da tela, pedindo a build).
      setPlano(null);
      avisar(null);
      setSessao((s) => recomecar(s, Date.now()));
      void gravar("plano", "null");
    },
    tecla: aoTecla,
    irParaAto(ato) {
      const r = rotaRef.current;
      if (!r) return;
      const agora = Date.now();
      setSessao((s) => irParaAto(r, s, ato, agora));
    },
    nivel(valor) {
      setSessao((s) => (valor === null ? { ...s, nivel: null } : ajustarNivel(s, valor)));
    },
    personagem(nome) {
      const visto = nome === null ? undefined : vistosRef.current.find((v) => v.personagem === nome);
      setSessao((s) => ({ ...s, personagem: nome, nivel: visto?.nivel ?? s.nivel }));
    },
    pausar() {
      const r = rotaRef.current;
      if (!r) return;
      const agora = Date.now();
      setSessao((s) => pausarOuRetomar(r, s, agora));
    },
    zerarTempo() {
      setSessao((s) => ({ ...s, timer: novoTimer() }));
    },
    novoPersonagem() {
      const agora = Date.now();
      setSessao((s) => recomecar(s, agora));
    },
    marcarGema(chave) {
      setSessao((s) => alternarMarca(s, chave));
    },
    fixarConjunto(id) {
      setSessao((s) => ({ ...s, conjunto_manual: id }));
    },
    prefs: setPrefs,
    opcaoDaRota(chave, valor) {
      const novas = { ...prefsRef.current, [chave]: valor };
      const p = planoRef.current;
      const antiga = rotaRef.current;
      if (p && antiga) {
        const nova = rotaDe(p, opcoesDaRota(novas));
        if (!nova) {
          avisar("Não consegui montar a rota com essa opção.");
          return;
        }
        setSessao((s) => ({ ...s, passo: passoEquivalente(antiga, nova, s.passo) }));
      }
      setPrefs(novas);
    },
    async config(parcial) {
      const atual = configRef.current;
      if (!atual) return null;
      try {
        setConfig(await backend.salvarConfig({ ...atual, ...parcial }));
        return null;
      } catch (erro) {
        return textoDoErro(erro);
      }
    },
  };

  // Fora da edição: o balão tem quatro formas e se arrasta segurando Alt.
  const forma: Forma = edicao ? "detalhado" : formaDoBalao;
  const mudarForma = (nova: Forma) => {
    if (bolinhaPeloPainel) {
      // A bolinha foi o painel do jogo que fez: abrir volta a forma guardada.
      dispensarBolinhaDoPainel();
      return;
    }
    if (nova === "bolinha" && forma !== "bolinha") formaAntesDaBolinha.current = forma;
    setPrefs((p) => ({ ...p, forma: nova }));
  };
  const mudarBlocos = (mudar: (blocos: Blocos) => Blocos) => setPrefs((p) => ({ ...p, blocos: mudar(p.blocos) }));
  const arrastar = () => void backend.arrastar().catch(() => undefined);
  const configurar = () => void backend.definirEdicao(true).catch(() => undefined);
  const botoes = edicao ? undefined : (
    <BotoesDaForma forma={forma} aoMudar={mudarForma} aoConfigurar={configurar} />
  );
  const aoSegurarBarra = edicao ? undefined : segurarPraArrastar(arrastar);

  if (forma === "bolinha") {
    const pos = rota ? posicaoNoAto(rota, sessao.passo) : null;
    return (
      <Bolinha
        ato={pos?.ato ?? null}
        numero={pos ? `${pos.numero}/${pos.total}` : null}
        aoAbrir={() => mudarForma(formaAntesDaBolinha.current)}
        arrastar={arrastar}
      />
    );
  }

  const classes = ["painel"];
  if (edicao) classes.push("editando");
  if (forma === "resumido") classes.push("resumido");
  if (forma === "expandido") classes.push("expandido");
  if (!edicao && estado.alt_segurado) classes.push("alt");

  return (
    <div
      ref={painelRef}
      className={classes.join(" ")}
      style={{ "--escala": prefs.escala, "--fundo": corDoFundo(prefs.opacidade) } as CSSProperties}
    >
      {edicao && (
        <header className="cabecalho" data-tauri-drag-region>
          <span data-tauri-drag-region>Guia de Leveling {inicial.versao}</span>
          <span className="acoes">
            <button className="principal" onClick={() => void backend.definirEdicao(false)}>
              Pronto
            </button>
            <button onClick={() => void sair()}>Sair</button>
          </span>
        </header>
      )}
      <div className="rolo">
        {edicao && (
          <p className="fraco">
            Modo de edição: arraste pelo título, redimensione pelas bordas. "Pronto" volta pro jogo
            {teclas.interacao ? ` (${teclas.interacao} também).` : "."}
          </p>
        )}
        {log && log.situacao !== "lendo" && (
          <p className="aviso">
            {log.situacao === "erro"
              ? `Client.txt: ${log.erro ?? "não consegui ler."}`
              : "Procurando o Client.txt do jogo… Abra o jogo, ou informe o caminho em Opções."}
          </p>
        )}
        {estado.avisos_de_teclas.map((texto, i) => (
          <p key={i} className="aviso">
            {texto}
          </p>
        ))}
        {plano && !rota && <p className="erro">Não consegui montar a rota desta build. Importe a build de novo.</p>}
        {aviso && <p className="aviso">{aviso}</p>}
        {filtroErrado && (
          <AvisoDoFiltro
            errado={filtroErrado}
            clicavel={edicao || estado.alt_segurado}
            comoClicar={
              config.segurar_alt_pra_clicar
                ? "segure Alt e clique"
                : teclas.interacao
                  ? `aperte ${teclas.interacao} e clique`
                  : "no modo de edição"
            }
            aoDesligar={() => setPrefs((p) => ({ ...p, avisar_filtro: false }))}
          />
        )}
        {edicao && (
          <Edicao
            inicial={inicial}
            config={config}
            log={log}
            plano={plano}
            rota={rota}
            sessao={sessao}
            situacao={situacao}
            escolha={escolha}
            vistos={vistos}
            prefs={prefs}
            painelAberto={painel.aberto}
            recordes={recordes}
            acoes={acoes}
          />
        )}
        {plano && rota && situacao && escolha ? (
          <Jogo
            plano={plano}
            rota={rota}
            sessao={sessao}
            situacao={situacao}
            recordes={recordes}
            escolha={escolha}
            arvore={etapaDaArvore}
            guiaDaArvore={guiaDaArvore}
            situacaoDaArvore={situacaoDaArvore}
            navegarArvore={
              etapaDaArvore && etapasComGatilho.length > 1 && etapasComGatilho.includes(etapaDaArvore)
                ? {
                    etapas: etapasComGatilho,
                    atual: etapasComGatilho.indexOf(etapaDaArvore),
                    automatica: etapaAutomatica ? etapasComGatilho.indexOf(etapaAutomatica) : -1,
                    escolher: escolherEtapaDaArvore,
                    andar: andarNaArvore,
                  }
                : null
            }
            itens={escolhaDeItens}
            mostrar={prefs.mostrar}
            blocos={prefs.blocos}
            aoMudarBlocos={mudarBlocos}
            painel={painel}
            edicao={edicao}
            trocou={trocou}
            teclaDoLayout={teclas.layout}
            clicavel={edicao || estado.alt_segurado}
            comoMarcar={
              config.segurar_alt_pra_clicar
                ? "segure Alt e clique no quadrado"
                : teclas.interacao
                  ? `marque com ${teclas.interacao}`
                  : "marque no modo de edição"
            }
            aoMarcarGema={acoes.marcarGema}
            aoEscolherLayout={(posicao) => setPainel((p) => escolherNoPainel(p, posicao))}
            resumido={forma === "resumido"}
            expandido={forma === "expandido"}
            trocouItens={trocouItens}
            botoes={botoes}
            aoSegurarBarra={aoSegurarBarra}
            ascendencia={
              comAscendencia && ascendencia ? (
                <QuadroDaAscendencia ascendencia={ascendencia} nivel={situacao.nivel} />
              ) : undefined
            }
          />
        ) : (
          !plano &&
          !edicao && (
            <>
              <div className="situacao barra" onMouseDown={aoSegurarBarra}>
                <span className="ato">Guia de Leveling</span>
                {botoes}
              </div>
              <p className="vazio">
                Sem build.{" "}
                {config.segurar_alt_pra_clicar
                  ? "Segure Alt e clique na engrenagem ⚙ aqui em cima, e cole"
                  : teclas.interacao
                    ? `Aperte ${teclas.interacao} e cole`
                    : "Cole"}{" "}
                o link ou o código do Path of Building.
              </p>
            </>
          )
        )}
      </div>
      {/* Os itens da fase vão no pé, fora da parte que o balão corta quando não cabe. */}
      {!edicao && forma === "detalhado" && prefs.mostrar.itens && escolhaDeItens && rota && (
        <FaixaDeItens escolha={escolhaDeItens} trocou={trocouItens} />
      )}
    </div>
  );
}
