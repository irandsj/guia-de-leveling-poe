// Ponte entre a interface e o núcleo em Rust.
//
// Dentro do app usa os comandos e eventos do Tauri. Fora dele (navegador, durante o
// desenvolvimento) usa um substituto em memória, com `window.simular` pra fabricar
// eventos do jogo.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import type { ArvoreParaOSistema, GuiaDaArvore } from "./nucleo/arvore/guia";
import type { Busca } from "./nucleo/busca";
import type { FiltroNoJogo } from "./nucleo/filtro";
import type { Forma } from "./nucleo/preferencias";

export interface Atalhos {
  interacao: string;
  esconder: string;
  voltar: string;
  avancar: string;
  layout: string;
  resync: string;
  /** Troca o tamanho do balão: bolinha, meio (detalhado) e expandido. */
  forma: string;
}

export interface Config {
  atalhos: Atalhos;
  atalhos_so_no_jogo: boolean;
  esconder_fora_do_jogo: boolean;
  /** Segurar Alt deixa clicar no guia (marcar gemas) sem entrar no modo de edição. */
  segurar_alt_pra_clicar: boolean;
  /** O guia fica fora das fotos da tela: a leitura de tela vê o jogo embaixo do balão. */
  guia_fora_das_fotos: boolean;
  /** O balão vira bolinha enquanto um painel da esquerda do jogo (Mundo, Baú…) está aberto por baixo dele. */
  bolinha_com_painel: boolean;
  client_txt: string;
  janela: { x: number; y: number; largura: number; altura: number } | null;
}

export interface EstadoJanela {
  edicao: boolean;
  /** Alt apertado agora: dá pra clicar no guia sem o modo de edição. */
  alt_segurado: boolean;
  visivel: boolean;
  escondido: boolean;
  jogo_aberto: boolean;
  jogo_em_foco: boolean;
  avisos_de_teclas: string[];
}

export type EventoLog =
  | { tipo: "zona"; area_id: string; nivel_area: number; seed: number }
  | { tipo: "entrou"; nome: string }
  | { tipo: "nivel"; personagem: string; classe: string; nivel: number }
  | { tipo: "morte"; personagem: string };

export interface Resumo {
  zona: { area_id: string; nivel_area: number } | null;
  niveis: { personagem: string; classe: string; nivel: number }[];
}

export interface StatusLog {
  situacao: "" | "procurando" | "lendo" | "erro";
  caminho: string | null;
  origem: string | null;
  erro: string | null;
  resumo: Resumo | null;
}

export interface Inicial {
  versao: string;
  config: Config;
  estado: EstadoJanela;
  log: StatusLog;
  pasta_dados: string;
}

/** Ações das teclas globais que chegam à interface. */
/** `arvore_anterior` e `arvore_proxima`: as setas do teclado, só com a árvore aberta no jogo. */
export type AcaoDeTecla = "voltar" | "avancar" | "layout" | "resync" | "forma" | "arvore_anterior" | "arvore_proxima";

export type NomeDeDados = "plano" | "progresso" | "preferencias" | "recordes";

export interface Ouvintes {
  estado?: (estado: EstadoJanela) => void;
  logStatus?: (status: StatusLog) => void;
  logEvento?: (evento: EventoLog) => void;
  tecla?: (acao: AcaoDeTecla) => void;
  arvore?: (situacao: SituacaoDaArvore) => void;
  painel?: (painel: PainelDoJogo) => void;
  /** As buscas da build mudaram (pra janelinha dos botões de busca). */
  buscas?: (buscas: Busca[]) => void;
  /** Uma gema da build está no inventário (a interface decide se vira marca). */
  gemaNaMochila?: (gema: GemaNaMochila) => void;
}

/**
 * Gema da build que a leitura de tela viu no inventário aberto (evento "gema-na-mochila"). Chega
 * quando o inventário passa a ter mais cópias dela do que antes, nesta visita à cidade.
 */
export interface GemaNaMochila {
  gem_id: string;
  /** A janela aberta na hora: loja ("vendedor") ou recompensa ("quest"). `null`: nenhuma. */
  tipo: "quest" | "vendedor" | null;
  /** Quantas cópias dela o inventário tem agora. */
  quantas: number;
}

/** Uma gema da build, pra conferir no inventário: o ícone vai em pontos (RGBA, `lado` x `lado`). */
export interface GemaDaBuildParaTela {
  id: string;
  lado: number;
  rgba: number[];
}

/** Painel da esquerda do jogo (Mundo, Baú…), visto pela foto do cabeçalho (evento "painel-do-jogo"). */
export interface PainelDoJogo {
  aberto: boolean;
  /** O balão está por cima dele. */
  cobre: boolean;
}

/** Uma gema pra leitura de tela procurar: o ícone vai em pontos (RGBA, `lado` x `lado`). */
export interface AlvoDaTela {
  id: string;
  tipo: "quest" | "vendedor";
  lado: number;
  rgba: number[];
}

/** Gravador de estudo: fotos da tela do jogo guardadas numa pasta do computador. */
export interface SituacaoDoGravador {
  ligado: boolean;
  fotos: number;
  megas: number;
  pasta: string | null;
}

/** Guia da árvore de passivas: o que a foto da tela mostrou (evento "arvore"). */
export interface SituacaoDaArvore {
  /** A árvore do jogo está na tela e foi reconhecida. */
  aberta: boolean;
  /** Já foi lida alguma vez nesta sessão do guia. */
  vista: boolean;
  /** De qual guia é esta situação: o `build` dele ("" = o programa está sem guia). */
  build: string;
  /** O `ate_alvo` do guia de que esta situação fala (0 sem guia). */
  ate_alvo: number;
  /** O tamanho da `ordem` que o programa aceitou desse guia (0 sem guia). */
  passos: number;
  /** Degrau de zoom da árvore do jogo (0 se fechada). */
  zoom: number;
  /** Passos do trecho da etapa alvo já pegos. */
  feitos: number;
  /** Tamanho do trecho da etapa alvo (`ate_alvo` do guia). */
  total: number;
  /** Posições em `guia.ordem` dos próximos nós: o primeiro é o número 1 do desenho. */
  proximos: number[];
  /** Ids dos nós que estão pegos e a build não quer mais. */
  devolver: number[];
  aviso: string | null;
  /** Tempos medidos, só pro modo de edição. */
  diag: string | null;
}

/** Um filtro do jogador que pode servir de base. */
export interface FiltroDoJogo {
  /** Como o guia pede ele de volta: o nome do arquivo, ou `OnlineFilters/<id>` pros online. */
  arquivo: string;
  /** Como aparece no jogo. */
  nome: string;
  /** Filtro online (seguido no site do jogo). */
  online: boolean;
}

/** Os filtros de itens que estão na pasta do jogo. */
export interface FiltrosDoJogo {
  pasta: string;
  /** A pasta do jogo existe (o jogo já foi aberto alguma vez). */
  existe: boolean;
  /** O filtro escolhido nas opções do jogo, se é um arquivo. */
  escolhido: string | null;
  /** O filtro base pra sugerir (`arquivo` de um dos `filtros`). */
  base_sugerida: string | null;
  /** Os filtros do jogador: os online primeiro, depois os arquivos (sem os que o guia criou). */
  filtros: FiltroDoJogo[];
  /** Os arquivos que o guia já criou. */
  do_guia: string[];
}

/** O filtro novo que o guia criou na pasta do jogo. */
export interface FiltroGravado {
  /** "Elementalist Leveling.filter". */
  arquivo: string;
  /** Como aparece na lista do jogo: "Elementalist Leveling". */
  nome: string;
  pasta: string;
  /** O nome do filtro base. */
  base: string | null;
  /** Já havia um filtro do guia com esse nome (foi trocado pelo novo). */
  trocou: boolean;
  /** O jogo já está com esse filtro escolhido (basta recarregar). */
  ja_escolhido: boolean;
}

export interface Backend {
  /** `true` dentro do app, `false` no navegador. */
  real: boolean;
  iniciar(): Promise<Inicial>;
  lerDados(nome: NomeDeDados): Promise<string | null>;
  gravarDados(nome: NomeDeDados, conteudo: string): Promise<void>;
  baixarTexto(url: string): Promise<string>;
  /** Foto de um item ("Armours/Helmets/HelmetDex1"), pronta pra `<img src>`. `null` se o site não tem. */
  fotoDoItem(arte: string): Promise<string | null>;
  definirEdicao(ligado: boolean): Promise<void>;
  /**
   * Põe o texto na caixa de busca do baú/vendedor do jogo: espera o Alt ser solto, traz o jogo
   * pra frente e manda Ctrl+F, Ctrl+V e Enter (a área de transferência volta como estava).
   */
  aplicarBusca(texto: string): Promise<void>;
  /** As buscas da build, pros botões que aparecem embaixo do campo de busca do Baú e do vendedor. */
  definirBuscas(buscas: readonly Busca[]): Promise<void>;
  /** A janelinha dos botões de busca pergunta as buscas quando abre. */
  lerBuscas(): Promise<Busca[]>;
  /** A janelinha dos botões de busca fica do tamanho deles (pixels lógicos). */
  medirBusca(largura: number, altura: number): Promise<void>;
  /** Os filtros de itens da pasta do jogo e qual está escolhido. */
  filtrosDoJogo(): Promise<FiltrosDoJogo>;
  /** O filtro que o jogo está usando e os que o guia criou (pra avisar quando o jogo ficou noutro). */
  filtroNoJogo(): Promise<FiltroNoJogo>;
  /**
   * Cria na pasta do jogo o filtro `nome` (vira "<nome>.filter"): os destaques da build em cima do
   * filtro `base` (`null` = só os destaques). Nunca grava por cima de um filtro do jogador.
   */
  aplicarFiltro(nome: string, destaques: string, base: string | null): Promise<FiltroGravado>;
  /** Boas-vindas (sem build): abre a edição no centro da tela, na frente. */
  abrirNoCentro(): Promise<void>;
  /** Tamanho da janela pra forma do balão; no resumido e no expandido vai junto a altura medida do conteúdo. */
  definirForma(forma: Forma, altura?: number): Promise<void>;
  /** Começa a arrastar a janela (com o botão do mouse apertado). */
  arrastar(): Promise<void>;
  alternarEscondido(): Promise<void>;
  salvarConfig(config: Config): Promise<Config>;
  fechar(): Promise<void>;
  /** Gemas pra procurar na tela do jogo. Lista vazia desliga a leitura de tela. */
  definirAlvos(alvos: AlvoDaTela[]): Promise<number>;
  /** Todas as gemas da rota, pra conferir no inventário. Devolve quantas valeram. */
  definirGemasDaBuild(gemas: GemaDaBuildParaTela[]): Promise<number>;
  /** Liga ou desliga o gravador de estudo; sem argumento, só conta como está. */
  gravador(ligado?: boolean): Promise<SituacaoDoGravador>;
  /** Posições dos nós da árvore de passivas, uma vez por versão. Devolve quantos nós foram aceitos. */
  definirArvore(arvore: ArvoreParaOSistema): Promise<number>;
  /** A ordem dos nós da build pra desenhar por cima da árvore do jogo. `null` desliga o desenho. */
  definirGuiaDaArvore(guia: GuiaDaArvore | null): Promise<number>;
  /** Começa a ouvir os eventos. Devolve a função que para de ouvir. */
  ouvir(ouvintes: Ouvintes): Promise<() => void>;
}

const backendTauri: Backend = {
  real: true,
  iniciar: () => invoke<Inicial>("iniciar"),
  lerDados: (nome) => invoke<string | null>("ler_dados", { nome }),
  gravarDados: (nome, conteudo) => invoke<void>("gravar_dados", { nome, conteudo }),
  baixarTexto: (url) => invoke<string>("baixar_texto", { url }),
  fotoDoItem: (arte) => invoke<string | null>("foto_do_item", { arte }),
  definirEdicao: (ligado) => invoke<void>("definir_edicao", { ligado }),
  aplicarBusca: (texto) => invoke<void>("aplicar_busca", { texto }),
  definirBuscas: (buscas) => invoke<void>("definir_buscas", { buscas }),
  lerBuscas: () => invoke<Busca[]>("ler_buscas"),
  medirBusca: (largura, altura) => invoke<void>("medir_busca", { largura, altura }),
  filtrosDoJogo: () => invoke<FiltrosDoJogo>("filtros_do_jogo"),
  filtroNoJogo: () => invoke<FiltroNoJogo>("filtro_no_jogo"),
  aplicarFiltro: (nome, destaques, base) => invoke<FiltroGravado>("aplicar_filtro", { nome, destaques, base }),
  abrirNoCentro: () => invoke<void>("abrir_no_centro"),
  definirForma: (forma, altura) => invoke<void>("definir_forma", { forma, altura: altura ?? null }),
  arrastar: () => getCurrentWindow().startDragging(),
  alternarEscondido: () => invoke<void>("alternar_escondido"),
  salvarConfig: (config) => invoke<Config>("salvar_config", { config }),
  fechar: () => invoke<void>("fechar"),
  definirAlvos: (alvos) => invoke<number>("definir_alvos", { alvos }),
  definirGemasDaBuild: (gemas) => invoke<number>("definir_gemas_da_build", { gemas }),
  gravador: (ligado) => invoke<SituacaoDoGravador>("gravador", { ligado: ligado ?? null }),
  definirArvore: (arvore) => invoke<number>("definir_arvore", { arvore }),
  definirGuiaDaArvore: (guia) => invoke<number>("definir_guia_da_arvore", { guia }),
  async ouvir(ouvintes) {
    const parar = await Promise.all([
      listen<EstadoJanela>("estado", (e) => ouvintes.estado?.(e.payload)),
      listen<StatusLog>("log-status", (e) => ouvintes.logStatus?.(e.payload)),
      listen<EventoLog>("log-evento", (e) => ouvintes.logEvento?.(e.payload)),
      listen<AcaoDeTecla>("atalho", (e) => ouvintes.tecla?.(e.payload)),
      listen<SituacaoDaArvore>("arvore", (e) => ouvintes.arvore?.(e.payload)),
      listen<PainelDoJogo>("painel-do-jogo", (e) => ouvintes.painel?.(e.payload)),
      listen<Busca[]>("buscas", (e) => ouvintes.buscas?.(e.payload)),
      listen<GemaNaMochila>("gema-na-mochila", (e) => ouvintes.gemaNaMochila?.(e.payload)),
    ]);
    return () => parar.forEach((p) => p());
  },
};

// ---------------------------------------------------------------------------
// Substituto pro navegador
// ---------------------------------------------------------------------------

export const CONFIG_PADRAO: Config = {
  atalhos: {
    interacao: "Ctrl+F2",
    esconder: "F2",
    voltar: "F3",
    avancar: "F4",
    layout: "F6",
    resync: "F7",
    forma: "Ctrl+F3",
  },
  atalhos_so_no_jogo: true,
  esconder_fora_do_jogo: true,
  segurar_alt_pra_clicar: true,
  guia_fora_das_fotos: true,
  bolinha_com_painel: true,
  client_txt: "",
  janela: null,
};

/** Ferramentas de simulação expostas em `window.simular` no navegador. */
export interface Simulador {
  zona(areaId: string, nivelArea?: number): void;
  nivel(personagem: string, classe: string, nivel: number): void;
  morte(personagem: string): void;
  tecla(acao: AcaoDeTecla): void;
  edicao(ligado: boolean): void;
  estado(parcial: Partial<EstadoJanela>): void;
  /**
   * Faz de conta que a foto da tela viu a árvore de passivas; o que faltar vale "fechada, nunca vista",
   * do último guia recebido (pra simular a foto de outro guia, passar `build`, `ate_alvo` ou `passos`).
   */
  arvore(situacao: Partial<SituacaoDaArvore>): void;
  /** Faz de conta que um painel da esquerda do jogo abriu ou fechou (`cobre`: por baixo do balão). */
  painel(aberto: boolean, cobre?: boolean): void;
  /** Faz de conta que a leitura de tela viu a gema no inventário (`quantas` cópias, com a `tipo` aberta). */
  gemaNaMochila(gem_id: string, tipo?: "quest" | "vendedor" | null, quantas?: number): void;
}

/** O que o programa diz da árvore antes de ver qualquer coisa. */
const ARVORE_NUNCA_VISTA: SituacaoDaArvore = {
  aberta: false,
  vista: false,
  build: "",
  ate_alvo: 0,
  passos: 0,
  zoom: 0,
  feitos: 0,
  total: 0,
  proximos: [],
  devolver: [],
  aviso: null,
  diag: null,
};

const CHAVE_DAS_BUSCAS = "guia-de-leveling:buscas";

function criarBackendFalso(): Backend {
  const ouvintes = new Set<Ouvintes>();
  let config: Config = structuredClone(CONFIG_PADRAO);
  let estado: EstadoJanela = {
    edicao: true,
    alt_segurado: false,
    visivel: true,
    escondido: false,
    jogo_aberto: false,
    jogo_em_foco: false,
    avisos_de_teclas: [],
  };
  const log: StatusLog = {
    situacao: "lendo",
    caminho: "C:\\simulado\\logs\\Client.txt",
    origem: "manual",
    erro: null,
    resumo: { zona: null, niveis: [] },
  };
  /** O último guia da árvore recebido: a situação simulada diz que é dele, como faz o programa. */
  let guiaDaArvore: GuiaDaArvore | null = null;
  const chave = (nome: string) => `guia-leveling:${nome}`;
  const guardar = (nome: string, valor: string) => {
    try {
      localStorage.setItem(chave(nome), valor);
    } catch {
      /* navegador sem armazenamento: segue só em memória */
    }
  };
  const recuperar = (nome: string): string | null => {
    try {
      return localStorage.getItem(chave(nome));
    } catch {
      return null;
    }
  };
  const mudarEstado = (parcial: Partial<EstadoJanela>) => {
    estado = { ...estado, ...parcial };
    ouvintes.forEach((o) => o.estado?.(estado));
  };

  const simulador: Simulador = {
    zona: (area_id, nivel_area = 1) =>
      ouvintes.forEach((o) => o.logEvento?.({ tipo: "zona", area_id, nivel_area, seed: 1 })),
    nivel: (personagem, classe, nivel) =>
      ouvintes.forEach((o) => o.logEvento?.({ tipo: "nivel", personagem, classe, nivel })),
    morte: (personagem) => ouvintes.forEach((o) => o.logEvento?.({ tipo: "morte", personagem })),
    tecla: (acao) => ouvintes.forEach((o) => o.tecla?.(acao)),
    edicao: (ligado) => mudarEstado({ edicao: ligado }),
    estado: mudarEstado,
    arvore: (parcial) => {
      const situacao: SituacaoDaArvore = {
        ...ARVORE_NUNCA_VISTA,
        build: guiaDaArvore?.build ?? "",
        ate_alvo: guiaDaArvore?.ate_alvo ?? 0,
        passos: guiaDaArvore?.ordem.length ?? 0,
        ...parcial,
      };
      ouvintes.forEach((o) => o.arvore?.(situacao));
    },
    painel: (aberto, cobre = true) => {
      // Como o programa: com a opção desligada, o painel nunca aparece aberto.
      const painel = { aberto: aberto && config.bolinha_com_painel, cobre: aberto && cobre && config.bolinha_com_painel };
      ouvintes.forEach((o) => o.painel?.(painel));
    },
    gemaNaMochila: (gem_id, tipo = "vendedor", quantas = 1) =>
      ouvintes.forEach((o) => o.gemaNaMochila?.({ gem_id, tipo, quantas })),
  };
  (window as unknown as { simular: Simulador }).simular = simulador;

  // No navegador de teste a janelinha dos botões de busca é outra aba (`?janela=busca`): as buscas
  // vão de uma pra outra pelo localStorage.
  const lerBuscasGuardadas = (): Busca[] => {
    try {
      return JSON.parse(localStorage.getItem(CHAVE_DAS_BUSCAS) ?? "[]") as Busca[];
    } catch {
      return [];
    }
  };
  window.addEventListener("storage", (e) => {
    if (e.key === CHAVE_DAS_BUSCAS) ouvintes.forEach((o) => o.buscas?.(lerBuscasGuardadas()));
  });

  return {
    real: false,
    iniciar: async () => ({
      versao: "navegador",
      config,
      estado,
      log,
      pasta_dados: "(navegador)",
    }),
    lerDados: async (nome) => recuperar(nome),
    gravarDados: async (nome, conteudo) => guardar(nome, conteudo),
    baixarTexto: async () => {
      throw "No navegador não dá pra baixar o link. Cole o código do PoB.";
    },
    // No navegador de teste a foto vem direto do site (dentro do app quem baixa é o Rust).
    fotoDoItem: async (arte) => `https://cdn.poedb.tw/image/Art/2DItems/${arte}.webp`,
    definirEdicao: async (ligado) => mudarEstado({ edicao: ligado }),
    // No navegador de teste a busca só vai pra área de transferência.
    aplicarBusca: async (texto) => {
      await navigator.clipboard?.writeText(texto);
    },
    definirBuscas: async (buscas) => {
      try {
        localStorage.setItem(CHAVE_DAS_BUSCAS, JSON.stringify(buscas));
      } catch {
        // Sem localStorage a outra aba só não fica sabendo.
      }
      ouvintes.forEach((o) => o.buscas?.([...buscas]));
    },
    lerBuscas: async () => lerBuscasGuardadas(),
    medirBusca: async () => undefined,
    // No navegador de teste não há pasta do jogo: finge uma com um filtro online e o NeverSink.
    filtrosDoJogo: async () => ({
      pasta: "(navegador)",
      existe: true,
      escolhido: null,
      base_sugerida: "OnlineFilters/BOo62qFx",
      filtros: [
        { arquivo: "OnlineFilters/BOo62qFx", nome: "Leveling 3.29 Filter (online)", online: true },
        { arquivo: "NeverSink's filter - 1-REGULAR.filter", nome: "NeverSink's filter - 1-REGULAR", online: false },
        { arquivo: "NeverSink's filter - 3-STRICT.filter", nome: "NeverSink's filter - 3-STRICT", online: false },
      ],
      do_guia: [],
    }),
    filtroNoJogo: async () => ({ escolhido: null, do_guia: [] }),
    aplicarFiltro: async (nome, destaques, base) => {
      console.info(destaques);
      const limpo = nome.trim().replace(/\.filter$/i, "");
      if (limpo === "" || /[\\/:*?"<>|]/.test(limpo)) throw "O nome do filtro não pode ter esses sinais.";
      return {
        arquivo: `${limpo}.filter`,
        nome: limpo,
        pasta: "(navegador)",
        base: base?.startsWith("OnlineFilters/") ? "Leveling 3.29 Filter" : (base?.replace(/\.filter$/i, "") ?? null),
        trocou: false,
        ja_escolhido: false,
      };
    },
    abrirNoCentro: async () => mudarEstado({ edicao: true }),
    definirForma: async () => undefined,
    arrastar: async () => undefined,
    alternarEscondido: async () =>
      mudarEstado({ escondido: !estado.escondido, visivel: estado.escondido }),
    salvarConfig: async (nova) => {
      config = { ...nova, janela: config.janela };
      return config;
    },
    fechar: async () => {},
    definirAlvos: async (alvos) => alvos.length,
    definirGemasDaBuild: async (gemas) => gemas.length,
    gravador: async (ligado) => ({ ligado: ligado ?? false, fotos: 0, megas: 0, pasta: null }),
    definirArvore: async (arvore) => arvore.ids.length,
    definirGuiaDaArvore: async (guia) => {
      guiaDaArvore = guia;
      return guia?.ordem.length ?? 0;
    },
    ouvir: async (o) => {
      ouvintes.add(o);
      return () => ouvintes.delete(o);
    },
  };
}

const dentroDoApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Esta é a janelinha dos botões de busca (no navegador de teste, a página aberta com `?janela=busca`). */
export function ehJanelaDaBusca(): boolean {
  if (dentroDoApp) return getCurrentWindow().label === "busca";
  return new URLSearchParams(window.location.search).get("janela") === "busca";
}

export const backend: Backend = dentroDoApp ? backendTauri : criarBackendFalso();
