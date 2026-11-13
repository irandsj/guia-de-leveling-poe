// O estado de uma corrida: passo da rota, nível, personagem, mortes e cronômetro.
// Recebe os eventos do Client.txt e as teclas, e devolve o estado novo. Função pura:
// a interface só mostra e guarda.

import type { EventoLog } from "../backend";
import {
  aoChegarNaZona,
  aoChegarPeloNome,
  ehCidade,
  ehCidadePeloNome,
  ehNomeDeZona,
  inicioDoAto,
  limitarPasso,
  nivelEstimado,
  ressincronizar,
} from "./avanco";
import { experienciaNaZona, nivelDaZonaGerada, nivelDaZonaPeloNome, type Experiencia } from "./experiencia";
import { nomeDaZona, type Rota } from "./rota";
import {
  aoCarregarTimer,
  lerTimerGuardado,
  mudarAtoDoTimer,
  novoTimer,
  pausarTimer,
  retomarTimer,
  timerDaCorridaNova,
  tocarTimer,
  type EstadoTimer,
} from "./timer";

export const VERSAO_DO_PROGRESSO = 1;

export interface Sessao {
  /** Índice do passo atual na rota. */
  passo: number;
  /** Nível que o jogo informou (ou que o jogador acertou à mão). `null` = ainda não sei. */
  nivel: number | null;
  /** Nome do personagem que estamos seguindo. `null` = o primeiro da classe do plano que subir de nível. */
  personagem: string | null;
  mortes: number;
  /** Conjunto de gemas fixado à mão (id da etapa). `null` = automático. */
  conjunto_manual: string | null;
  /** Última zona que o jogo gerou. */
  zona_id: string | null;
  /** Último nome de zona que o jogo anunciou. */
  zona_nome: string | null;
  /** O jogo gerou a zona e a linha com o nome dela ("You have entered") ainda não veio. */
  aguardando_nome: boolean;
  /** Hora da última morte. Renascer na cidade logo depois não é "passo feito". */
  morreu_em: number | null;
  timer: EstadoTimer;
  /** Gemas que o jogador marcou como compradas/pegas ("vendedor:<gem_id>", "quest:<gem_id>"). */
  marcadas: string[];
  /** Marcas que o jogador tirou na mão: a gema delas não é mais marcada sozinha pelo inventário. */
  desmarcadas: string[];
  /** Hora em que o jogador chegou na zona atual. `null` = não sei (o guia abriu com ele lá). */
  chegou_em: number | null;
  /** Nível dos monstros da zona atual. `null` = cidade, esconderijo ou não sei. */
  nivel_da_zona: number | null;
  /** Mortes em cada ato da rota. A chave é o número do ato. */
  mortes_por_ato: Record<string, number>;
}

export function novaSessao(): Sessao {
  return {
    passo: 0,
    nivel: null,
    personagem: null,
    mortes: 0,
    conjunto_manual: null,
    zona_id: null,
    zona_nome: null,
    aguardando_nome: false,
    morreu_em: null,
    timer: novoTimer(),
    marcadas: [],
    desmarcadas: [],
    chegou_em: null,
    nivel_da_zona: null,
    mortes_por_ato: {},
  };
}

/**
 * Marca ou desmarca uma gema como comprada/pega, na mão. A desmarcada fica lembrada (a leitura do
 * inventário não marca mais ela sozinha); marcar de novo na mão esquece isso.
 */
export function alternarMarca(s: Sessao, chave: string): Sessao {
  if (s.marcadas.includes(chave)) {
    const desmarcadas = s.desmarcadas.includes(chave) ? s.desmarcadas : [...s.desmarcadas, chave];
    return { ...s, marcadas: s.marcadas.filter((m) => m !== chave), desmarcadas };
  }
  return { ...s, marcadas: [...s.marcadas, chave], desmarcadas: s.desmarcadas.filter((m) => m !== chave) };
}

/** Marca a gema como comprada/pega (a leitura de tela viu ela no inventário). Já marcada: fica igual. */
export function marcar(s: Sessao, chave: string): Sessao {
  return s.marcadas.includes(chave) ? s : { ...s, marcadas: [...s.marcadas, chave] };
}

const MAXIMO_DE_MARCAS = 300;

/** Quanto tempo depois da morte uma chegada na cidade ainda conta como "renasceu na cidade". */
const JANELA_DA_MORTE_MS = 45_000;

function acabouDeMorrer(s: Sessao, agora: number): boolean {
  return s.morreu_em !== null && agora - s.morreu_em >= 0 && agora - s.morreu_em <= JANELA_DA_MORTE_MS;
}

/** Classe e ascendência do plano, pra reconhecer o personagem do jogador. */
export interface QuemJoga {
  classe: string;
  ascendencia: string | null;
}

function atoDoPasso(rota: Rota, passo: number): number {
  return rota.passos[limitarPasso(rota, passo)]?.ato ?? 1;
}

const PRAIA_DO_COMECO = { id: "1_1_1", nome: "The Twilight Strand" };

function naPraiaDoComeco(s: Sessao): boolean {
  return s.zona_id === PRAIA_DO_COMECO.id || (s.zona_id === null && s.zona_nome === PRAIA_DO_COMECO.nome);
}

/** Ninguém fica tanto tempo na praia do começo: chegada mais antiga que isso é de outra vez. */
const TEMPO_MAXIMO_NA_PRAIA_MS = 10 * 60_000;

/** A corrida começou quando o jogador chegou na praia, se ele chegou há pouco; senão, agora. */
function inicioDaCorrida(s: Sessao, agora: number): number {
  const passou = s.chegou_em === null ? null : agora - s.chegou_em;
  return passou !== null && passou >= 0 && passou <= TEMPO_MAXIMO_NA_PRAIA_MS ? (s.chegou_em as number) : agora;
}

/**
 * Corrida do zero, guardando só onde o jogador está. Na praia do começo o cronômetro já sai
 * contando desde a chegada nela: o jogador zerou depois de criar o personagem. Fora dela, liga
 * no próximo sinal do jogo (zerou antes de criar).
 */
export function recomecar(s: Sessao, agora: number): Sessao {
  const zerada: Sessao = {
    ...novaSessao(),
    zona_id: s.zona_id,
    zona_nome: s.zona_nome,
    chegou_em: s.chegou_em,
    nivel_da_zona: s.nivel_da_zona,
  };
  return naPraiaDoComeco(s) ? { ...zerada, timer: timerDaCorridaNova(inicioDaCorrida(s, agora)) } : zerada;
}

/**
 * Outro personagem da classe da build subiu pro nível 2 na Twilight Strand: é uma corrida nova.
 * Só ali, porque outro jogador da mesma classe na mesma zona também aparece no Client.txt, e
 * um personagem antigo nunca está no nível 2 na praia do começo.
 */
function ehRunNova(quem: QuemJoga | null, s: Sessao, evento: { classe: string; nivel: number }): boolean {
  if (evento.nivel > 2) return false;
  if (quem !== null && evento.classe !== quem.classe && evento.classe !== quem.ascendencia) return false;
  return naPraiaDoComeco(s);
}

/**
 * Troca o passo e leva o cronômetro pro ato do passo novo. `conta` = false quando o jogador
 * pulou de ato pelo modo de edição: aí o ato de antes não vale como concluído.
 */
function irPara(rota: Rota, s: Sessao, passo: number, agora: number, conta = true): Sessao {
  const novo = limitarPasso(rota, passo);
  if (novo === s.passo) return s;
  return { ...s, passo: novo, timer: mudarAtoDoTimer(s.timer, agora, atoDoPasso(rota, novo), conta) };
}

/** Aplica um evento do Client.txt. */
export function aplicarEvento(
  rota: Rota,
  quem: QuemJoga | null,
  s: Sessao,
  evento: EventoLog,
  agora: number,
): Sessao {
  switch (evento.tipo) {
    case "zona": {
      const cidade = ehCidade(evento.area_id);
      const depois: Sessao = {
        ...s,
        zona_id: evento.area_id,
        zona_nome: nomeDaZona(evento.area_id),
        aguardando_nome: true,
        morreu_em: null,
        chegou_em: agora,
        nivel_da_zona: nivelDaZonaGerada(evento.area_id, evento.nivel_area),
        timer: tocarTimer(s.timer, agora, atoDoPasso(rota, s.passo)),
      };
      // Renasceu na cidade: não é a ida à cidade que a rota pede.
      if (cidade && acabouDeMorrer(s, agora)) return depois;
      return irPara(rota, depois, aoChegarNaZona(rota, s.passo, evento.area_id, s.zona_id), agora);
    }
    case "entrou": {
      if (s.zona_id !== null) {
        // O nome repete a zona que acabou de ser gerada: já foi tratado pelo id.
        const mesmaZona = nomeDaZona(s.zona_id) === evento.nome;
        // Logo depois da zona gerada veio um nome que não está nos nossos dados (zona
        // renomeada, nome escrito diferente): é o nome dessa zona. O id vale mais.
        const nomeDaGerada = s.aguardando_nome && !ehNomeDeZona(evento.nome);
        if (mesmaZona || nomeDaGerada) {
          if (!s.aguardando_nome && s.zona_nome === evento.nome) return s;
          return { ...s, zona_nome: evento.nome, aguardando_nome: false };
        }
      }
      // Entrada "silenciosa": voltou pra uma zona que já existia. Só temos o nome.
      const depois: Sessao = {
        ...s,
        zona_id: null,
        zona_nome: evento.nome,
        aguardando_nome: false,
        morreu_em: null,
        chegou_em: agora,
        nivel_da_zona: nivelDaZonaPeloNome(evento.nome, atoDoPasso(rota, s.passo)),
        timer: tocarTimer(s.timer, agora, atoDoPasso(rota, s.passo)),
      };
      if (ehCidadePeloNome(evento.nome) && acabouDeMorrer(s, agora)) return depois;
      return irPara(rota, depois, aoChegarPeloNome(rota, s.passo, evento.nome), agora);
    }
    case "nivel": {
      if (s.personagem === null) {
        const daClasse =
          quem === null || evento.classe === quem.classe || evento.classe === quem.ascendencia;
        // Outro jogador na mesma zona também aparece no Client.txt.
        if (!daClasse) return s;
        return { ...s, personagem: evento.personagem, nivel: evento.nivel };
      }
      if (evento.personagem !== s.personagem) {
        if (!ehRunNova(quem, s, evento)) return s;
        // Personagem novo da classe da build começando agora: é outra corrida, do zero. O
        // cronômetro já conta desde a chegada na praia (o nível 2 vem depois de uns monstros).
        return {
          ...recomecar(s, agora),
          personagem: evento.personagem,
          nivel: evento.nivel,
        };
      }
      return { ...s, nivel: evento.nivel };
    }
    case "morte": {
      if (s.personagem === null || evento.personagem !== s.personagem) return s;
      const ato = String(atoDoPasso(rota, s.passo));
      return {
        ...s,
        mortes: s.mortes + 1,
        morreu_em: agora,
        mortes_por_ato: { ...s.mortes_por_ato, [ato]: (s.mortes_por_ato[ato] ?? 0) + 1 },
      };
    }
    default:
      return s;
  }
}

/**
 * Sem build importada não há rota pra andar: só guarda onde o personagem está, pra tecla de
 * procurar o passo funcionar assim que a build chegar.
 */
export function anotarZona(s: Sessao, evento: EventoLog): Sessao {
  if (evento.tipo === "zona") {
    return {
      ...s,
      zona_id: evento.area_id,
      zona_nome: nomeDaZona(evento.area_id),
      aguardando_nome: true,
    };
  }
  if (evento.tipo === "entrou") {
    if (s.zona_id !== null) {
      const mesmaZona = nomeDaZona(s.zona_id) === evento.nome;
      const nomeDaGerada = s.aguardando_nome && !ehNomeDeZona(evento.nome);
      if (mesmaZona || nomeDaGerada) {
        if (!s.aguardando_nome && s.zona_nome === evento.nome) return s;
        return { ...s, zona_nome: evento.nome, aguardando_nome: false };
      }
    }
    return { ...s, zona_id: null, zona_nome: evento.nome, aguardando_nome: false };
  }
  return s;
}

/**
 * A zona que o Client.txt mostrava quando o guia abriu. Não mexe no passo nem no cronômetro:
 * o guia pode ter ficado fechado enquanto o jogador andava.
 */
export function anotarZonaInicial(s: Sessao, areaId: string, nivelArea: number): Sessao {
  const nivelDaZona = nivelDaZonaGerada(areaId, nivelArea);
  if (s.zona_id === areaId && s.nivel_da_zona === nivelDaZona) return s;
  return {
    ...s,
    zona_id: areaId,
    zona_nome: s.zona_id === areaId ? s.zona_nome : nomeDaZona(areaId),
    aguardando_nome: s.zona_id === areaId ? s.aguardando_nome : false,
    nivel_da_zona: nivelDaZona,
  };
}

export interface ResultadoDaTecla {
  sessao: Sessao;
  /** Mensagem curta pra mostrar quando a tecla não pôde fazer nada. */
  aviso: string | null;
}

/** Uma tecla = uma ação no guia. Nada vai pro jogo. */
export function aplicarTecla(
  rota: Rota,
  s: Sessao,
  acao: "voltar" | "avancar" | "resync",
  agora: number,
): ResultadoDaTecla {
  if (acao === "voltar") return { sessao: irPara(rota, s, s.passo - 1, agora), aviso: null };
  if (acao === "avancar") return { sessao: irPara(rota, s, s.passo + 1, agora), aviso: null };

  if (s.zona_id === null && s.zona_nome === null) {
    return { sessao: s, aviso: "Ainda não sei em que zona você está. Troque de zona no jogo." };
  }
  const achado = ressincronizar(rota, s.passo, { id: s.zona_id, nome: s.zona_nome });
  if (achado === null) {
    return { sessao: s, aviso: `"${s.zona_nome ?? s.zona_id}" não está na rota.` };
  }
  return { sessao: irPara(rota, s, achado, agora), aviso: null };
}

/** Pula pro começo de um ato (botão do modo de edição). Não vale como ato concluído. */
export function irParaAto(rota: Rota, s: Sessao, ato: number, agora: number): Sessao {
  return irPara(rota, s, inicioDoAto(rota, ato), agora, false);
}

/** Acerta o nível à mão. */
export function ajustarNivel(s: Sessao, nivel: number): Sessao {
  return { ...s, nivel: Math.min(100, Math.max(1, Math.trunc(nivel))) };
}

export function pausarOuRetomar(rota: Rota, s: Sessao, agora: number): Sessao {
  const rodando = s.timer.desde !== null;
  return {
    ...s,
    timer: rodando
      ? pausarTimer(s.timer, agora, true)
      : retomarTimer(s.timer, agora, atoDoPasso(rota, s.passo)),
  };
}

/** O jogo fechou: o cronômetro para sozinho e volta no próximo evento. */
export function aoFecharOJogo(s: Sessao, agora: number): Sessao {
  if (s.timer.desde === null) return s;
  return { ...s, timer: pausarTimer(s.timer, agora, false) };
}

export interface SituacaoDaSessao {
  nivel: number;
  /** `false` = o nível é um chute pelo passo da rota. */
  nivel_conhecido: boolean;
  ato: number;
  /** Ganho de experiência na zona atual. `null` = nível chutado, cidade ou zona sem nível. */
  xp: Experiencia | null;
}

export function situacaoDaSessao(rota: Rota, s: Sessao): SituacaoDaSessao {
  return {
    nivel: s.nivel ?? nivelEstimado(rota, s.passo),
    nivel_conhecido: s.nivel !== null,
    ato: atoDoPasso(rota, s.passo),
    xp: s.nivel !== null && s.nivel_da_zona !== null ? experienciaNaZona(s.nivel, s.nivel_da_zona) : null,
  };
}

/** O que vai pro disco. */
export interface Progresso {
  versao: number;
  /** De qual plano é este progresso. Outro plano = começar do zero. */
  hash_plano: string;
  salvo_em: number;
  sessao: Sessao;
}

export function guardarProgresso(s: Sessao, hashDoPlano: string, agora: number): Progresso {
  return { versao: VERSAO_DO_PROGRESSO, hash_plano: hashDoPlano, salvo_em: agora, sessao: s };
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.length > 0 && valor.length < 200 ? valor : null;
}

/** Lê o progresso do disco. Qualquer coisa fora do formato vira uma sessão nova. */
export function retomarProgresso(valor: unknown, hashDoPlano: string, rota: Rota): Sessao {
  if (typeof valor !== "object" || valor === null) return novaSessao();
  const p = valor as Partial<Progresso>;
  if (p.versao !== VERSAO_DO_PROGRESSO || p.hash_plano !== hashDoPlano) return novaSessao();
  const bruta = p.sessao as Partial<Sessao> | undefined;
  if (typeof bruta !== "object" || bruta === null) return novaSessao();

  const salvoEm = typeof p.salvo_em === "number" ? p.salvo_em : 0;
  const nivel = typeof bruta.nivel === "number" ? bruta.nivel : null;
  const mortes = typeof bruta.mortes === "number" ? bruta.mortes : 0;
  const timer = lerTimerGuardado(bruta.timer);
  const nivelDaZona = bruta.nivel_da_zona;
  return {
    passo: limitarPasso(rota, typeof bruta.passo === "number" ? bruta.passo : 0),
    nivel: nivel !== null && nivel >= 1 && nivel <= 100 ? Math.trunc(nivel) : null,
    personagem: texto(bruta.personagem),
    mortes: mortes >= 0 && Number.isFinite(mortes) ? Math.trunc(mortes) : 0,
    conjunto_manual: texto(bruta.conjunto_manual),
    zona_id: texto(bruta.zona_id),
    zona_nome: texto(bruta.zona_nome),
    aguardando_nome: false,
    morreu_em: null,
    timer: timer !== null ? aoCarregarTimer(timer, salvoEm) : novoTimer(),
    marcadas: listaDeMarcas(bruta.marcadas),
    desmarcadas: listaDeMarcas(bruta.desmarcadas),
    // A hora da chegada não vale depois de o guia ficar fechado.
    chegou_em: null,
    nivel_da_zona:
      typeof nivelDaZona === "number" && Number.isInteger(nivelDaZona) && nivelDaZona >= 1 && nivelDaZona <= 100
        ? nivelDaZona
        : null,
    mortes_por_ato: contagemPorAto(bruta.mortes_por_ato),
  };
}

/** Lista de marcas que veio do disco: só textos, sem repetir. */
function listaDeMarcas(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return [...new Set(valor.map(texto).filter((m): m is string => m !== null))].slice(0, MAXIMO_DE_MARCAS);
}

/** Contagem por ato que veio do disco: só chaves de ato e inteiros que fazem sentido. */
function contagemPorAto(valor: unknown): Record<string, number> {
  if (typeof valor !== "object" || valor === null) return {};
  const contagem: Record<string, number> = {};
  for (const [chave, n] of Object.entries(valor)) {
    if (/^\d{1,2}$/.test(chave) && typeof n === "number" && Number.isInteger(n) && n >= 0) contagem[chave] = n;
  }
  return contagem;
}
