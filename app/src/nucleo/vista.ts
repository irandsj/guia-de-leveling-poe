// O que a tela mostra, tirado da rota, do plano e da sessão. Funções puras, pra testar sem tela.

import { limitarPasso } from "./avanco";
import {
  chaveDaGema,
  type EtapaDeGemas,
  type GemaDoPlano,
  type GrupoDoPlano,
  type ItemDoPlano,
  type Plano,
} from "./plano";
import type { GemaDoPasso, Passo, Rota } from "./rota";

export interface PosicaoNoAto {
  ato: number;
  /** Número do passo dentro do ato, a contar de 1. */
  numero: number;
  /** Quantos passos o ato tem. */
  total: number;
}

/** "Passo 3 de 41" dentro do ato. */
export function posicaoNoAto(rota: Rota, passo: number): PosicaoNoAto {
  if (rota.passos.length === 0) return { ato: 1, numero: 0, total: 0 };
  const atual = limitarPasso(rota, passo);
  const ato = rota.passos[atual].ato;
  let primeiro = atual;
  while (primeiro > 0 && rota.passos[primeiro - 1].ato === ato) primeiro--;
  let ultimo = atual;
  while (ultimo + 1 < rota.passos.length && rota.passos[ultimo + 1].ato === ato) ultimo++;
  return { ato, numero: atual - primeiro + 1, total: ultimo - primeiro + 1 };
}

/** O passo atual e os `quantos` seguintes. */
export function passosAVista(rota: Rota, passo: number, quantos: number): Passo[] {
  const atual = limitarPasso(rota, passo);
  return rota.passos.slice(atual, atual + 1 + Math.max(0, quantos));
}

export interface GemasDeUmPasso {
  /** Índice do passo na rota. */
  passo: number;
  /** Quantos passos faltam pra chegar nele (0 = é o passo de agora). */
  faltam: number;
  gemas: GemaDoPasso[];
}

/** As gemas a pegar ou comprar do passo atual até o fim do ato, na ordem da rota. */
export function gemasDoAto(rota: Rota, passo: number): GemasDeUmPasso[] {
  const atual = limitarPasso(rota, passo);
  const ato = rota.passos[atual]?.ato;
  const lista: GemasDeUmPasso[] = [];
  for (let q = atual; q < rota.passos.length && rota.passos[q].ato === ato; q++) {
    const gemas = rota.passos[q].gemas;
    if (gemas.length > 0) lista.push({ passo: q, faltam: q - atual, gemas });
  }
  return lista;
}

/**
 * Os passos seguidos que acontecem na mesma zona que `inicio` (a mesma ida à cidade): entregar
 * duas quests e comprar é uma parada só, e o guia pode pular os passos do meio ao sair dali.
 */
function mesmaVisita(rota: Rota, inicio: number): { primeiro: number; ultimo: number } {
  const zona = rota.passos[inicio].zona;
  let primeiro = inicio;
  while (primeiro > 0 && rota.passos[primeiro - 1].zona === zona) primeiro--;
  let ultimo = inicio;
  while (ultimo + 1 < rota.passos.length && rota.passos[ultimo + 1].zona === zona) ultimo++;
  return { primeiro, ultimo };
}

function gemasEntre(rota: Rota, de: number, ate: number): GemaDoPasso[] {
  return rota.passos.slice(de, ate + 1).flatMap((p) => p.gemas);
}

/** Chave da marca de "comprei/peguei" de uma gema da rota. */
export function chaveDaMarca(gema: Pick<GemaDoPasso, "tipo" | "gem_id">): string {
  return `${gema.tipo}:${gema.gem_id}`;
}

function marcada(marcadas: readonly string[], gema: GemaDoPasso): boolean {
  return marcadas.includes(chaveDaMarca(gema));
}

/**
 * A próxima parada de gema: o primeiro passo, do atual pra frente (em qualquer ato), que dá ou
 * vende gema da build, junto com as gemas dos passos seguintes na mesma zona. Parada com tudo
 * marcado como feito fica pra trás. As que faltam vêm primeiro; as marcadas, no fim.
 */
export function proximaParada(rota: Rota, passo: number, marcadas: readonly string[] = []): GemasDeUmPasso | null {
  const atual = limitarPasso(rota, passo);
  for (let q = atual; q < rota.passos.length; q++) {
    if (rota.passos[q].gemas.length === 0) continue;
    const { ultimo } = mesmaVisita(rota, q);
    const gemas = gemasEntre(rota, q, ultimo);
    if (gemas.every((g) => marcada(marcadas, g))) {
      q = ultimo;
      continue;
    }
    const faltam = gemas.filter((g) => !marcada(marcadas, g));
    return { passo: q, faltam: q - atual, gemas: [...faltam, ...gemas.filter((g) => marcada(marcadas, g))] };
  }
  return null;
}

/**
 * Gemas de vendedor de paradas que já ficaram pra trás e que o jogador não marcou como
 * compradas (o guia não tem como saber sozinho). Ficam até ele marcar.
 */
export function comprasQueFicaram(rota: Rota, passo: number, marcadas: readonly string[] = []): GemaDoPasso[] {
  const atual = limitarPasso(rota, passo);
  const vistas = new Set<string>();
  const saida: GemaDoPasso[] = [];
  for (const gema of gemasEntre(rota, 0, atual - 1)) {
    const chave = chaveDaMarca(gema);
    if (gema.tipo !== "vendedor" || vistas.has(chave) || marcadas.includes(chave)) continue;
    vistas.add(chave);
    saida.push(gema);
  }
  return saida;
}

export interface MoedaAGuardar {
  /** Nome curto: "Transmutation", "Scroll of Wisdom". */
  nome: string;
  quantidade: number;
}

/** "Orb of Transmutation" → "Transmutation". */
export function nomeCurtoDaMoeda(moeda: string): string {
  return moeda.replace(/^Orb of /, "");
}

/**
 * Quanto de cada moeda guardar pras gemas que a build ainda compra neste ato (do passo atual
 * até o fim do ato). A mais cara primeiro, que é a que costuma faltar.
 */
export function moedasDoAto(rota: Rota, passo: number, marcadas: readonly string[] = []): MoedaAGuardar[] {
  const ORDEM = ["Orb of Alchemy", "Orb of Alteration", "Orb of Transmutation", "Scroll of Wisdom"];
  const soma = new Map<string, number>();
  for (const parada of gemasDoAto(rota, passo)) {
    for (const gema of parada.gemas) {
      if (gema.tipo !== "vendedor" || !gema.custo || marcada(marcadas, gema)) continue;
      soma.set(gema.custo, (soma.get(gema.custo) ?? 0) + Math.max(1, gema.quantidade));
    }
  }
  const posicao = (m: string) => (ORDEM.indexOf(m) === -1 ? ORDEM.length : ORDEM.indexOf(m));
  return [...soma.entries()]
    .sort((a, b) => posicao(a[0]) - posicao(b[0]))
    .map(([moeda, quantidade]) => ({ nome: nomeCurtoDaMoeda(moeda), quantidade }));
}

const TAMANHO_DO_LINK = 30;

function nomeDoGrupo(grupo: GrupoDoPlano, gemId: string): string {
  // Rótulo do PoB, sem enfeite ("==== Main Skills ====", "*1x ...") e cortado se for longo.
  const rotulo = grupo.rotulo.replace(/[=*#~_]+/g, " ").replace(/\s{2,}/g, " ").trim();
  if (rotulo) return rotulo.length > TAMANHO_DO_LINK ? `${rotulo.slice(0, TAMANHO_DO_LINK - 1).trimEnd()}…` : rotulo;
  // Sem rótulo: o suporte diz de quem é; a própria habilidade não precisa ("link do Frostblink").
  const habilidade = grupo.gemas.find((g) => !g.suporte);
  return habilidade && habilidade.gem_id !== gemId ? `link do ${habilidade.nome}` : "";
}

/**
 * Pra qual link da build a gema serve ("3L Mobility", "6L Spectres..."), tirado do conjunto de
 * onde a rota tirou a gema. Se a gema está em mais de um link, vale o principal, senão o primeiro.
 */
export function linkDaGema(plano: Plano, gema: { gem_id: string; nota: string }): string | null {
  const etapas = plano.gemas.etapas;
  const daNota = etapas.filter((e) => e.titulo === gema.nota);
  for (const etapa of daNota.length > 0 ? daNota : etapas) {
    const grupos = etapa.grupos.filter((g) => g.gemas.some((x) => x.gem_id === gema.gem_id));
    const grupo = grupos.find((g) => g.principal) ?? grupos[0];
    if (grupo) return nomeDoGrupo(grupo, gema.gem_id) || null;
  }
  return null;
}

/** Onde e como se consegue a gema: "recompensa" de quest ou "comprar" de um vendedor. */
export function comoPegar(gema: GemaDoPasso): string {
  if (gema.tipo === "quest") return `recompensa · ${gema.npc}`;
  return gema.custo ? `comprar · ${gema.npc} · ${gema.custo}` : `comprar · ${gema.npc}`;
}

export interface GemaDoConjunto extends GemaDoPlano {
  /** Entrou neste conjunto (não estava no anterior). */
  nova: boolean;
}

export interface GrupoDoConjunto {
  rotulo: string;
  principal: boolean;
  gemas: GemaDoConjunto[];
}

/** Os grupos de um conjunto de gemas, com as gemas novas marcadas. */
export function gruposDoConjunto(etapa: EtapaDeGemas): GrupoDoConjunto[] {
  const novas = new Set(etapa.mudancas.novas);
  return etapa.grupos
    .filter((grupo) => grupo.gemas.length > 0 || grupo.rotulo.trim() !== "")
    .map((grupo) => ({
      rotulo: grupo.rotulo,
      principal: grupo.principal,
      gemas: grupo.gemas.map((gema) => ({ ...gema, nova: novas.has(chaveDaGema(gema)) })),
    }));
}

/** Nome das gemas que saíram do conjunto anterior, pra avisar o que tirar. */
export function gemasQueSairam(plano: Plano, etapa: EtapaDeGemas): string[] {
  if (etapa.mudancas.sairam.length === 0) return [];
  const nomes = new Map<string, string>();
  for (const outra of plano.gemas.etapas) {
    for (const grupo of outra.grupos) {
      for (const gema of grupo.gemas) nomes.set(chaveDaGema(gema), gema.nome);
    }
  }
  return etapa.mudancas.sairam.map((chave) => nomes.get(chave) ?? chave.replace(/^nome:/, ""));
}

/** Uma linha da lista de itens: um espaço (os anéis vão juntos, e os frascos também) e o que vai nele. */
export interface LinhaDeItem {
  espaco: string;
  itens: { nome: string; base: string | null; raridade: string; quantidade: number }[];
}

/** Os espaços do PoB na ordem do painel, com o nome curto do jogo. Os outros ficam no fim, como vieram. */
const ESPACOS: { re: RegExp; nome: string }[] = [
  { re: /^Weapon 1$/, nome: "Main hand" },
  { re: /^Weapon 2$/, nome: "Off hand" },
  { re: /^Helmet$/, nome: "Helmet" },
  { re: /^Body Armour$/, nome: "Body" },
  { re: /^Gloves$/, nome: "Gloves" },
  { re: /^Boots$/, nome: "Boots" },
  { re: /^Amulet$/, nome: "Amulet" },
  { re: /^Ring \d$/, nome: "Rings" },
  { re: /^Belt$/, nome: "Belt" },
  { re: /^Flask \d$/, nome: "Flasks" },
];

/** O nome que o PoB dá a todo item raro feito na mão: não diz nada. */
const NOME_GENERICO = /^new item$/i;

/** O nome do item pra mostrar: o do PoB, ou a base ("Quartz Wand") quando o raro se chama "New Item". */
function nomeDoItem(item: { nome: string; base: string }): string {
  if (item.base && (!item.nome || NOME_GENERICO.test(item.nome.trim()))) return item.base;
  return item.nome || item.base;
}

/** Os itens de um conjunto, um espaço por linha, na ordem do personagem (arma, armadura, joias, frascos). */
export function linhasDeItens(itens: readonly ItemDoPlano[]): LinhaDeItem[] {
  const posicao = (espaco: string) => {
    const i = ESPACOS.findIndex((e) => e.re.test(espaco));
    return i >= 0 ? i : ESPACOS.length;
  };
  const ordenados = itens
    .filter((item) => (item.nome || item.base) !== "")
    .map((item, indice) => ({ item, indice, posicao: posicao(item.espaco) }))
    .sort((a, b) => a.posicao - b.posicao || a.item.espaco.localeCompare(b.item.espaco) || a.indice - b.indice);
  const linhas: LinhaDeItem[] = [];
  for (const { item, posicao: p } of ordenados) {
    const espaco = p < ESPACOS.length ? ESPACOS[p].nome : item.espaco;
    let linha = linhas.find((l) => l.espaco === espaco);
    if (!linha) {
      linha = { espaco, itens: [] };
      linhas.push(linha);
    }
    const nome = nomeDoItem(item);
    const igual = linha.itens.find((x) => x.nome === nome);
    if (igual) igual.quantidade += 1;
    else {
      linha.itens.push({
        nome,
        base: item.base && item.base !== nome ? item.base : null,
        raridade: item.raridade,
        quantidade: 1,
      });
    }
  }
  return linhas;
}

/** O que muda do conjunto de itens atual pro próximo: as linhas do próximo que não estão iguais no atual. */
export function itensQueMudam(atual: readonly ItemDoPlano[], proximo: readonly ItemDoPlano[]): LinhaDeItem[] {
  const chave = (linha: LinhaDeItem) => JSON.stringify(linha.itens.map((i) => [i.nome, i.quantidade]));
  const antes = new Map(linhasDeItens(atual).map((l) => [l.espaco, chave(l)]));
  return linhasDeItens(proximo).filter((l) => antes.get(l.espaco) !== chave(l));
}

/** Um item na faixa de baixo do balão: só o nome curto, a cor da raridade e quantos (a base é pra foto). */
export interface ItemCurto {
  nome: string;
  base: string | null;
  raridade: string;
  quantidade: number;
}

// Frasco mágico tem prefixo e sufixo no nome ("Concentrated Divine Life Flask of Warding"): na faixa basta a base.
const RE_BASE_DE_FRASCO =
  /\b((?:Small|Medium|Large|Greater|Grand|Giant|Colossal|Sacred|Hallowed|Sanctified|Divine|Eternal) (?:Life|Mana|Hybrid) Flask|(?:Quicksilver|Bismuth|Stibnite|Amethyst|Ruby|Sapphire|Topaz|Silver|Aquamarine|Granite|Jade|Quartz|Sulphur|Basalt|Diamond|Gold) Flask)\b/;

/** O nome curto do item: o frasco mágico vira a base dele; o resto fica como o PoB escreveu. */
export function nomeCurtoDoItem(item: { nome: string; raridade: string }): string {
  if (item.raridade === "MAGIC") {
    const m = RE_BASE_DE_FRASCO.exec(item.nome);
    if (m) return m[1];
  }
  return item.nome;
}

/** As linhas de itens numa linha só, na mesma ordem, com os repetidos juntos ("Iron Ring ×2"). */
export function itensEmLinha(linhas: readonly LinhaDeItem[]): ItemCurto[] {
  const saida: ItemCurto[] = [];
  for (const linha of linhas) {
    for (const item of linha.itens) {
      const nome = nomeCurtoDoItem(item);
      const igual = saida.find((x) => x.nome === nome && x.raridade === item.raridade);
      if (igual) igual.quantidade += item.quantidade;
      else saida.push({ nome, base: item.base, raridade: item.raridade, quantidade: item.quantidade });
    }
  }
  return saida;
}

function textoDe(passo: Passo): string {
  return passo.pedacos.map((p) => p.v).join("");
}

/**
 * A rota mudou (o jogador trocou uma opção): acha na rota nova o passo que corresponde ao
 * passo em que ele estava. Procura no mesmo ato o mesmo texto na mesma zona; sem isso, o
 * primeiro passo na mesma zona; sem isso, o começo do ato.
 */
export function passoEquivalente(antiga: Rota, nova: Rota, passo: number): number {
  const velho = antiga.passos[limitarPasso(antiga, passo)];
  if (!velho || nova.passos.length === 0) return 0;
  const doAto = nova.passos.filter((p) => p.ato === velho.ato);
  if (doAto.length === 0) return limitarPasso(nova, passo);

  const texto = textoDe(velho);
  const igual = doAto.find((p) => p.zona === velho.zona && textoDe(p) === texto);
  if (igual) return igual.indice;

  // O passo sumiu com a opção: fica no primeiro passo dali pra frente que está na mesma zona.
  const antes = antiga.passos.filter((p) => p.ato === velho.ato && p.indice < velho.indice).length;
  const fracao = antes / Math.max(1, antiga.passos.filter((p) => p.ato === velho.ato).length);
  const perto = doAto[Math.min(doAto.length - 1, Math.round(fracao * doAto.length))];
  const naZona = doAto.filter((p) => p.zona === velho.zona);
  if (naZona.length === 0) return perto.indice;
  // Entre os passos na mesma zona, o mais perto da posição antiga dentro do ato.
  let melhor = naZona[0];
  for (const candidato of naZona) {
    if (Math.abs(candidato.indice - perto.indice) < Math.abs(melhor.indice - perto.indice)) melhor = candidato;
  }
  return melhor.indice;
}

/** Uma linha que resume o plano importado. */
export function resumoDoPlano(plano: Plano): string {
  const p = plano.personagem;
  const quem = p.ascendencia ? `${p.classe} → ${p.ascendencia}` : p.classe;
  const partes = [quem];
  const gemas = plano.gemas.etapas.length;
  partes.push(gemas === 1 ? "1 conjunto de gemas" : `${gemas} conjuntos de gemas`);
  const arvores = plano.arvore.etapas.length;
  partes.push(arvores === 1 ? "1 árvore" : `${arvores} árvores`);
  if (p.bandido !== "None") partes.push(`bandido: ${p.bandido}`);
  return partes.join(" · ");
}
