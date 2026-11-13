// O planner do Maxroll (maxroll.gg/poe/planner/<id>) lido pro mesmo formato do PoB (`Pob`), pra o plano
// sair pelo mesmo caminho (`montarPlano`). A resposta de planners.maxroll.gg/profiles/load/poe/<id> é um
// JSON cujo `data` é outro JSON, em texto. O `data` vem de dois jeitos:
// - "planner": perfis ("Campaign", "Maps", "Endgame"...), cada um com etapas de gemas, variantes da
//   árvore e conjuntos de itens;
// - "embed": os blocos soltos que as páginas de guia mostram (etapas de gemas, árvores, ascendências),
//   sem itens.
// O formato está descrito em `leveling/conhecimento/fontes-de-build.md` (parte 3).
//
// Os títulos continuam passando pelo `lerRotulo`: o planner usa os mesmos nomes que os PoBs do Maxroll
// ("Level 1 - 12", "Act 2-4", "Early Maps{5}"). A árvore de leveling que vem inteira num título só
// ("Campaign", "Leveling", "Variant 1") é cortada em etapas pela ordem dos cliques, cada uma com o
// título "Level N (P points)" (o nível em que se tem aqueles pontos).

import { Data } from "../terceiros/exile-leveling/src/data";
import "./dados-330";
import { lerRotulo, nivelDosPontos } from "./plano";
import {
  mapearGemId,
  pesoDoId,
  type ArvorePob,
  type Bandido,
  type ConjuntoGemasPob,
  type ConjuntoItensPob,
  type GemaPob,
  type GrupoPob,
  type ItemPob,
  type Pob,
} from "./pob";

/** O efeito escolhido numa maestria: o planner guarda a posição na lista do nó; o PoB, o id do efeito. */
export type EfeitoDeMaestria = (no: number, posicao: number) => number | null;

/** O planner lido, com o que o jogador precisa saber e que o PoB não diria. */
export interface PlannerLido {
  pob: Pob;
  avisos: string[];
}

/** Respostas maiores que isso não são um planner (o Rust já corta em 3 MB). */
const MAX_RESPOSTA = 3 * 1024 * 1024;

/** Pontos mínimos de uma etapa da árvore cortada: menos que isso junta com a seguinte. */
const PONTOS_POR_ETAPA = 8;

const CLASSE_DO_CODIGO: Record<string, string> = {
  Str: "Marauder",
  Dex: "Ranger",
  Int: "Witch",
  StrDex: "Duelist",
  StrInt: "Templar",
  DexInt: "Shadow",
  StrDexInt: "Scion",
};

/** Pro `class` que vem com o nome da ascendência ("Juggernaut"). */
const CLASSE_DA_ASCENDENCIA: Record<string, string> = {
  Juggernaut: "Marauder",
  Berserker: "Marauder",
  Chieftain: "Marauder",
  Raider: "Ranger",
  Warden: "Ranger",
  Deadeye: "Ranger",
  Pathfinder: "Ranger",
  Occultist: "Witch",
  Elementalist: "Witch",
  Necromancer: "Witch",
  Slayer: "Duelist",
  Gladiator: "Duelist",
  Champion: "Duelist",
  Inquisitor: "Templar",
  Hierophant: "Templar",
  Guardian: "Templar",
  Assassin: "Shadow",
  Trickster: "Shadow",
  Saboteur: "Shadow",
  Ascendant: "Scion",
  Reliquarian: "Scion",
  Luminary: "Scion",
};

const BANDIDO: Record<string, Bandido> = { alira: "Alira", oak: "Oak", kraityn: "Kraityn" };

const PANTEAO_MAIOR = new Set(["Lunaris", "Solaris", "Arakaali", "TheBrineKing"]);

/** Nome do espaço no planner → nome no PoB. */
const ESPACO: Record<string, string> = {
  Weapon: "Weapon 1",
  Offhand: "Weapon 2",
  Weapon2: "Weapon 1 Swap",
  Offhand2: "Weapon 2 Swap",
  Helm: "Helmet",
  BodyArmour: "Body Armour",
  Gloves: "Gloves",
  Boots: "Boots",
  Amulet: "Amulet",
  Ring: "Ring 1",
  Ring2: "Ring 2",
  Belt: "Belt",
  Flask1: "Flask 1",
  Flask2: "Flask 2",
  Flask3: "Flask 3",
  Flask4: "Flask 4",
  Flask5: "Flask 5",
};

type Obj = Record<string, unknown>;

function ehObjeto(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function lista(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function inteiro(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

/** "RaiseSpiders" → "Raise Spiders"; "SupportBrand" → "Brand Support". */
function nomeLegivel(id: string): string {
  const separado = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2");
  return id.startsWith("Support") && id.length > 7 ? `${separado(id.slice(7))} Support` : separado(id);
}

function colado(nome: string): string {
  return nome.toLowerCase().replace(/[^a-z0-9]/g, "");
}

let porNomeColado: Map<string, string> | null = null;

/** Nome sem espaços nem pontuação → id da gema ("rollingmagma" → a Rolling Magma). */
function gemaPeloNome(chave: string): string | undefined {
  if (porNomeColado === null) {
    porNomeColado = new Map();
    for (const gema of Object.values(Data.Gems)) {
      const c = colado(gema.name);
      const atual = porNomeColado.get(c);
      if (atual === undefined || pesoDoId(gema.id) > pesoDoId(atual)) porNomeColado.set(c, gema.id);
    }
  }
  return porNomeColado.get(chave);
}

/**
 * O id do planner é o `skillId` do PoB ("RollingMagma", "SupportElementalProliferation"). Quase sempre
 * o id da gema é "SkillGem"/"SupportGem" + o resto; quando não é, vale o nome. A gema transfigurada
 * ("…AltX") vira a gema de base, como no PoB.
 */
function gemaDoPlanner(bruto: unknown): GemaPob | null {
  if (!ehObjeto(bruto)) return null;
  const skillId = texto(bruto.id);
  if (!/^[A-Za-z0-9_]{1,80}$/.test(skillId)) return null;
  const achar = (id: string): string | null => {
    const suporte = id.startsWith("Support") ? id.slice(7) : null;
    const candidatos = [`Metadata/Items/Gems/SkillGem${id}`];
    if (suporte) candidatos.unshift(`Metadata/Items/Gems/SupportGem${suporte}`);
    for (const c of candidatos) {
      const mapeado = mapearGemId(c);
      if (Data.Gems[mapeado]) return mapeado;
    }
    const chave = colado(suporte ?? id);
    return (suporte ? gemaPeloNome(`${chave}support`) : undefined) ?? gemaPeloNome(chave) ?? null;
  };
  const gemId = achar(skillId) ?? achar(skillId.replace(/Alt[XYZ]$/, ""));
  return {
    gemId,
    skillId,
    nome: (gemId ? Data.Gems[gemId]?.name : undefined) ?? nomeLegivel(skillId.replace(/Alt[XYZ]$/, "")),
    ativa: true,
    quantidade: 1,
  };
}

function gruposDaEtapa(etapa: Obj): GrupoPob[] {
  const grupos: GrupoPob[] = [];
  for (const skill of lista(etapa.skills)) {
    if (!ehObjeto(skill)) continue;
    const gemas = lista(skill.gems).map(gemaDoPlanner).filter((g): g is GemaPob => g !== null);
    if (gemas.length === 0) continue;
    const slot = texto(skill.slot);
    grupos.push({ rotulo: "", ativo: true, slot: slot ? (ESPACO[slot] ?? slot) : null, deItem: false, gemas });
  }
  return grupos;
}

/** Versão da árvore no jeito do PoB: 325 → "3_25"; 3290 → "3_29". */
function versaoDaArvore(v: unknown): string {
  const n = inteiro(v);
  if (n === null || n <= 0) return "";
  if (n >= 1000) return `${Math.floor(n / 1000)}_${Math.floor((n % 1000) / 10)}`;
  if (n >= 100) return `${Math.floor(n / 100)}_${n % 100}`;
  return "";
}

/** Cada clique do histórico: um nó só, ou um grupo `{add, remove}` (o "remove" é respec). */
function passosDoHistorico(historico: unknown): { add: number[]; remove: number[] }[] {
  const passos: { add: number[]; remove: number[] }[] = [];
  for (const h of lista(historico)) {
    const no = inteiro(h);
    if (no !== null) {
      passos.push({ add: [no], remove: [] });
    } else if (ehObjeto(h)) {
      const nos = (v: unknown) => lista(v).map(inteiro).filter((n): n is number => n !== null);
      passos.push({ add: nos(h.add), remove: nos(h.remove) });
    }
  }
  return passos;
}

function nosFinais(historico: unknown): number[] {
  const nos = new Set<number>();
  for (const passo of passosDoHistorico(historico)) {
    for (const n of passo.add) nos.add(n);
    for (const n of passo.remove) nos.delete(n);
  }
  return [...nos];
}

/** As maestrias da variante (nó → posição do efeito) que caem nos nós dados, no texto do PoB. */
function maestriasEmTexto(bruto: unknown, nos: number[], efeito: EfeitoDeMaestria): string {
  if (!ehObjeto(bruto)) return "";
  const temNo = new Set(nos);
  const pares: string[] = [];
  for (const [chave, valor] of Object.entries(bruto)) {
    const no = Number.parseInt(chave, 10);
    const posicao = inteiro(valor);
    if (!Number.isFinite(no) || posicao === null || !temNo.has(no)) continue;
    const id = efeito(no, posicao);
    if (id !== null) pares.push(`{${no},${id}}`);
  }
  return pares.join(",");
}

/**
 * A árvore de leveling em etapas, pela ordem dos cliques: a etapa fecha quando junta pelo menos
 * `PONTOS_POR_ETAPA` pontos novos (a última fecha onde a árvore acaba).
 */
function cortarArvore(variante: Obj, efeito: EfeitoDeMaestria, url: string): ArvorePob[] {
  const versao = versaoDaArvore(variante.version);
  const etapas: ArvorePob[] = [];
  const nos = new Set<number>();
  let ultimo = 0;
  // Mudou algo desde a última etapa (um respec no fim pode até diminuir os pontos).
  let mudou = false;
  const fechar = () => {
    const atuais = [...nos];
    etapas.push({
      titulo: `Level ${nivelDosPontos(atuais.length)} (${atuais.length} points)`,
      versao,
      nos: atuais,
      maestrias: maestriasEmTexto(variante.masteries, atuais, efeito),
      url,
    });
    ultimo = atuais.length;
    mudou = false;
  };
  const passos = passosDoHistorico(variante.history);
  passos.forEach((passo, i) => {
    for (const n of passo.add) {
      if (!nos.has(n)) {
        nos.add(n);
        mudou = true;
      }
    }
    for (const n of passo.remove) {
      if (nos.delete(n)) mudou = true;
    }
    const ehUltimo = i === passos.length - 1;
    if (nos.size - ultimo >= PONTOS_POR_ETAPA || (ehUltimo && mudou && nos.size > 0)) fechar();
  });
  // A sobra no fim, pequena, entra na última etapa em vez de virar uma etapa de 1 ou 2 pontos.
  if (etapas.length >= 2) {
    const [penultima, ultima] = etapas.slice(-2);
    if (ultima.nos.length - penultima.nos.length < PONTOS_POR_ETAPA / 2) etapas.splice(-2, 1);
  }
  return etapas;
}

function arvoreInteira(titulo: string, variante: Obj, efeito: EfeitoDeMaestria, url: string): ArvorePob {
  const nos = nosFinais(variante.history);
  return {
    titulo,
    versao: versaoDaArvore(variante.version),
    nos,
    maestrias: maestriasEmTexto(variante.masteries, nos, efeito),
    url,
  };
}

/** Título que o guia já sabe pôr na campanha: ato, faixa ou nível. */
function temEtapaDeCampanha(titulo: string): boolean {
  const r = lerRotulo(titulo);
  return r.ato_min !== null || r.nivel_max !== null || r.ponto;
}

/**
 * A árvore que dá pra cortar em etapas: título genérico ("Campaign", "Leveling", "Variant 1"), sem
 * nível, ato, lab, mapas nem fim de jogo.
 */
function arvoreDeCortar(titulo: string): boolean {
  const r = lerRotulo(titulo);
  if (r.fim_de_jogo || r.lab !== null || r.ato_min !== null || r.nivel_max !== null || r.ponto) return false;
  return r.nivel_min === null || r.nivel_min === 1;
}

interface Montagem {
  gemas: ConjuntoGemasPob[];
  arvores: ArvorePob[];
  itensConjuntos: ConjuntoItensPob[];
  /** Variantes de árvore ainda por converter, na ordem (o corte é decidido no fim). */
  variantes: { titulo: string; variante: Obj }[];
}

function novaMontagem(): Montagem {
  return { gemas: [], arvores: [], itensConjuntos: [], variantes: [] };
}

/** Junta as etapas de gemas, sem repetir título (o mesmo "Endgame" em dois perfis vale o primeiro). */
function juntarGemas(m: Montagem, etapas: unknown): void {
  for (const etapa of lista(etapas)) {
    if (!ehObjeto(etapa)) continue;
    const titulo = texto(etapa.name);
    if (m.gemas.some((c) => c.titulo === titulo)) continue;
    const grupos = gruposDaEtapa(etapa);
    if (grupos.length === 0) continue;
    m.gemas.push({ id: String(m.gemas.length + 1), titulo, grupos });
  }
}

function juntarVariantes(m: Montagem, variantes: unknown, tituloPadrao: string): void {
  for (const variante of lista(variantes)) {
    if (!ehObjeto(variante) || passosDoHistorico(variante.history).length === 0) continue;
    const titulo = texto(variante.name) || tituloPadrao;
    if (m.variantes.some((v) => v.titulo === titulo)) continue;
    m.variantes.push({ titulo, variante });
  }
}

/**
 * As variantes viram árvores. A primeira, se tem título genérico e a build não tem outra árvore de
 * campanha, é cortada em etapas pela ordem dos cliques. As etapas cortadas param antes do nível da
 * próxima árvore ("Early Maps" = 68): depois dela, o guia não volta pra árvore de leveling.
 */
function montarArvores(m: Montagem, efeito: EfeitoDeMaestria, url: string): boolean {
  const primeira = m.variantes[0];
  const cortar =
    primeira !== undefined &&
    arvoreDeCortar(primeira.titulo) &&
    !m.variantes.some((v) => temEtapaDeCampanha(v.titulo));
  const niveisSeguintes = m.variantes
    .slice(1)
    .map((v) => lerRotulo(v.titulo))
    .filter((r) => !r.fim_de_jogo && r.nivel_min !== null && r.nivel_min > 1)
    .map((r) => r.nivel_min as number);
  const limite = Math.min(Infinity, ...niveisSeguintes);
  m.variantes.forEach(({ titulo, variante }, i) => {
    if (i === 0 && cortar) {
      const etapas = cortarArvore(variante, efeito, url);
      const antes = etapas.filter((e) => nivelDosPontos(e.nos.length) < limite);
      m.arvores.push(...(antes.length > 0 ? antes : etapas));
    } else {
      m.arvores.push(arvoreInteira(titulo, variante, efeito, url));
    }
  });
  return cortar;
}

function classeDe(...candidatos: unknown[]): string {
  for (const c of candidatos) {
    const t = texto(c);
    if (CLASSE_DO_CODIGO[t]) return CLASSE_DO_CODIGO[t];
    if (CLASSE_DA_ASCENDENCIA[t]) return CLASSE_DA_ASCENDENCIA[t];
    if (Object.values(CLASSE_DO_CODIGO).includes(t)) return t;
  }
  return "";
}

function panteao(bruto: unknown): { maior: string | null; menor: string | null } {
  if (!ehObjeto(bruto)) return { maior: null, menor: null };
  const deuses = Object.keys(bruto);
  return {
    maior: deuses.find((d) => PANTEAO_MAIOR.has(d)) ?? null,
    menor: deuses.find((d) => !PANTEAO_MAIOR.has(d)) ?? null,
  };
}

/** Perfil que junta tudo com chaves de loadout ("Early Act 1{1}", "Act 5{3}"): vale sozinho. */
function perfilComLoadouts(perfil: Obj): boolean {
  const etapas = lista(ehObjeto(perfil.skills) ? perfil.skills.steps : []);
  return etapas.filter((e) => ehObjeto(e) && /\{[\w,\s]+\}/.test(texto(e.name))).length >= 2;
}

function lerItens(bruto: unknown): Record<string, ItemPob> {
  const itens: Record<string, ItemPob> = {};
  if (!ehObjeto(bruto)) return itens;
  for (const [id, item] of Object.entries(bruto)) {
    if (!ehObjeto(item)) continue;
    // A base vem como caminho interno do jogo ("Metadata/Items/Rings/Ring2") e o único sem nome só tem
    // um id interno: sem nome, o item não entra no plano (como no PoB).
    itens[id] = {
      id,
      raridade: texto(item.rarity).toUpperCase(),
      nome: texto(item.name),
      base: "",
      nivelReq: null,
    };
  }
  return itens;
}

function juntarItens(m: Montagem, equipamento: unknown, prefixoDoId: string): void {
  if (!ehObjeto(equipamento)) return;
  for (const variante of lista(equipamento.variants)) {
    if (!ehObjeto(variante) || !ehObjeto(variante.items)) continue;
    const titulo = texto(variante.name);
    if (m.itensConjuntos.some((c) => c.titulo === titulo)) continue;
    const espacos = Object.entries(variante.items)
      .filter(([, itemId]) => inteiro(itemId) !== null || typeof itemId === "string")
      .map(([espaco, itemId]) => ({ nome: ESPACO[espaco] ?? espaco, itemId: String(itemId) }));
    if (espacos.length === 0) continue;
    m.itensConjuntos.push({ id: `${prefixoDoId}${m.itensConjuntos.length + 1}`, titulo, espacos });
  }
}

function pobVazio(): Pob {
  return {
    classe: "",
    ascendencia: null,
    nivel: null,
    bandido: "None",
    panteaoMaior: null,
    panteaoMenor: null,
    conjuntosGemas: [],
    conjuntoGemasAtivo: null,
    arvores: [],
    arvoreAtiva: 0,
    itens: {},
    conjuntosItens: [],
    conjuntoItensAtivo: null,
    notas: "",
  };
}

function fechar(pob: Pob, m: Montagem): Pob {
  pob.conjuntosGemas = m.gemas;
  pob.conjuntoGemasAtivo = m.gemas[m.gemas.length - 1]?.id ?? null;
  pob.arvores = m.arvores;
  pob.arvoreAtiva = Math.max(0, m.arvores.length - 1);
  pob.conjuntosItens = m.itensConjuntos;
  pob.conjuntoItensAtivo = m.itensConjuntos[m.itensConjuntos.length - 1]?.id ?? null;
  return pob;
}

/** Formato "planner": perfis com gemas, árvore e itens. */
function doPlanner(resposta: Obj, dados: Obj, efeito: EfeitoDeMaestria, url: string): PlannerLido {
  const avisos: string[] = [];
  const perfis = lista(dados.profiles).filter(ehObjeto);
  if (perfis.length === 0) throw new Error("O planner do Maxroll veio sem perfis de build.");
  const comLoadouts = perfis.find(perfilComLoadouts);
  const usados = comLoadouts ? [comLoadouts] : perfis;
  const base = usados[0];

  const m = novaMontagem();
  for (const perfil of usados) {
    juntarGemas(m, ehObjeto(perfil.skills) ? perfil.skills.steps : []);
    juntarVariantes(m, ehObjeto(perfil.passives) ? perfil.passives.variants : [], texto(perfil.name));
    juntarItens(m, perfil.equipment, `${texto(perfil.id) || "p"}-`);
  }
  montarArvores(m, efeito, url);

  const pob = pobVazio();
  pob.classe = classeDe(base.class, resposta.class);
  pob.ascendencia = texto(base.ascendancy) || null;
  pob.nivel = inteiro(base.level);
  pob.bandido = BANDIDO[texto(base.bandits).toLowerCase()] ?? "None";
  const deuses = panteao(base.pantheon);
  pob.panteaoMaior = deuses.maior;
  pob.panteaoMenor = deuses.menor;
  pob.itens = lerItens(dados.items);

  const outras = new Set(usados.map((p) => texto(p.ascendancy)).filter((a) => a && a !== pob.ascendencia));
  if (outras.size > 0) {
    avisos.push(
      `O planner troca de ascendência entre os perfis (${[pob.ascendencia, ...outras].join(", ")}): o guia segue a do perfil "${texto(base.name)}".`,
    );
  }
  return { pob: fechar(pob, m), avisos };
}

/** Formato "embed": os blocos de um guia (gemas, árvores, ascendências), sem itens. */
function doEmbed(resposta: Obj, dados: Obj, efeito: EfeitoDeMaestria, url: string): PlannerLido {
  const avisos: string[] = [];
  const blocos = lista(dados.embeds).filter(ehObjeto);
  const m = novaMontagem();
  for (const bloco of blocos.filter((b) => b.type === "skills")) juntarGemas(m, bloco.steps);

  const arvores = blocos.filter((b) => b.type === "passives");
  const primeira = arvores[0];
  if (primeira) {
    const variantes = lista(primeira.variants).filter(ehObjeto);
    const ativa = inteiro(primeira.active) ?? 0;
    const escolhida = variantes[ativa] ?? variantes[0];
    // Uma árvore só: as outras do guia são caminhos alternativos até a mesma árvore.
    if (escolhida) juntarVariantes(m, [escolhida], texto(primeira.name));
    const outras = arvores.slice(1).map((b) => texto(b.name)).filter((n) => n.length > 0);
    if (outras.length > 0) {
      avisos.push(
        `O guia tem ${outras.length + 1} árvores (${[texto(primeira.name), ...outras].join("; ")}): o guia segue a primeira.`,
      );
    }
  }
  montarArvores(m, efeito, url);

  const pob = pobVazio();
  pob.classe = classeDe(resposta.class, primeira?.charClass);
  const ascendencias = [
    ...new Set(blocos.filter((b) => b.type === "ascendancy").map((b) => texto(b.ascendancy)).filter((a) => a)),
  ];
  if (ascendencias.length === 1) pob.ascendencia = ascendencias[0];
  else if (ascendencias.length > 1) {
    avisos.push(`O guia mostra mais de uma ascendência (${ascendencias.join(", ")}): escolha a sua no laboratório.`);
  }
  return { pob: fechar(pob, m), avisos };
}

/**
 * Lê a resposta do planner. `efeito` traduz as maestrias (ver `efeitosDeMaestria`); `url` é a página do
 * planner, guardada em cada árvore como o link do PoB.
 */
export function lerPlannerMaxroll(resposta: string, efeito: EfeitoDeMaestria, url = ""): PlannerLido {
  if (resposta.length > MAX_RESPOSTA) throw new Error("A resposta do planner do Maxroll é grande demais.");
  let bruto: unknown;
  try {
    bruto = JSON.parse(resposta);
  } catch {
    throw new Error("O planner do Maxroll não respondeu com os dados da build (link apagado ou errado?).");
  }
  if (!ehObjeto(bruto)) throw new Error("O planner do Maxroll respondeu num formato que o guia não conhece.");
  if (bruto.game !== undefined && bruto.game !== "poe") {
    throw new Error("Esse planner é do Path of Exile 2. O guia é do Path of Exile 1.");
  }
  let dados: unknown = bruto.data;
  if (typeof dados === "string") {
    try {
      dados = JSON.parse(dados);
    } catch {
      dados = null;
    }
  }
  if (!ehObjeto(dados)) throw new Error("O planner do Maxroll veio sem os dados da build.");

  const lido =
    lista(dados.profiles).length > 0
      ? doPlanner(bruto, dados, efeito, url)
      : lista(dados.embeds).length > 0
        ? doEmbed(bruto, dados, efeito, url)
        : null;
  if (lido === null) throw new Error("O planner do Maxroll veio vazio: sem gemas, árvore nem itens.");
  if (!lido.pob.classe) throw new Error("O planner do Maxroll não diz a classe da build.");
  if (lido.pob.conjuntosGemas.length === 0 && lido.pob.arvores.length === 0) {
    throw new Error("O planner do Maxroll não tem gemas nem árvore pra seguir.");
  }
  return lido;
}

/**
 * As maestrias a partir do arquivo da árvore (`src/dados/arvore/arvore.json`): a posição que o planner
 * guarda é a da lista de efeitos do nó, na mesma ordem do arquivo (conferido contra o PoB do mesmo guia).
 */
export function efeitosDeMaestria(arvore: unknown): EfeitoDeMaestria {
  const nomeDoNo = new Map<number, string>();
  const efeitos = new Map<string, number[]>();
  if (ehObjeto(arvore)) {
    for (const linha of lista(arvore.nos)) {
      if (Array.isArray(linha) && typeof linha[0] === "number" && typeof linha[6] === "string") {
        nomeDoNo.set(linha[0], linha[6]);
      }
    }
    if (ehObjeto(arvore.maestrias)) {
      for (const [nome, pares] of Object.entries(arvore.maestrias)) {
        efeitos.set(
          nome,
          lista(pares).map((par) => (Array.isArray(par) && typeof par[0] === "number" ? par[0] : -1)),
        );
      }
    }
  }
  return (no, posicao) => {
    const nome = nomeDoNo.get(no);
    const id = nome === undefined ? undefined : efeitos.get(nome)?.[posicao];
    return id === undefined || id < 0 ? null : id;
  };
}

/** Sem o arquivo da árvore: as maestrias ficam de fora. */
export const SEM_MAESTRIAS: EfeitoDeMaestria = () => null;
