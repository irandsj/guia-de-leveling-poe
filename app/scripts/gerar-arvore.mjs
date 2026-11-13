// Gera o arquivo enxuto da árvore de passivas (src/dados/arvore/arvore.json) a partir do data.json
// que a Grinding Gear Games publica em github.com/grindinggear/skilltree-export.
//
//   node scripts/gerar-arvore.mjs <tag>                       baixa o data.json da tag (ex.: 3.30.0)
//   node scripts/gerar-arvore.mjs <tag> --arquivo data.json   lê um data.json já baixado (não usa a rede)
//   node scripts/gerar-arvore.mjs <tag> --pob 3_30,3_30_ruthless
//   node scripts/gerar-arvore.mjs <tag> --saida outro.json    grava em outro lugar (pra conferir sem trocar o do app)
//
// Entra:  https://raw.githubusercontent.com/grindinggear/skilltree-export/<tag>/data.json  (ou --arquivo)
// Sai:    src/dados/arvore/arvore.json  (ou --saida), JSON numa linha só, sem espaços, UTF-8, sem quebra no fim
//
// - <tag> vira o campo "versao". Sem --pob, os treeVersion do PoB saem da tag: 3.30.0 -> 3_30 e 3_30_ruthless.
// - O que entra no arquivo: só números e nomes (posição, tipo e nome de cada nó, ligações, classes, texto dos
//   efeitos de maestria, ascendências). Nenhuma arte do jogo. O formato está em src/dados/arvore/ORIGEM.md.
// - As contas de posição e as regras de "quem entra" são as do Path of Building (PassiveTree.lua e
//   PassiveSpec.lua). Mesma entrada, mesma saída, byte a byte.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const USO = "Uso: node scripts/gerar-arvore.mjs <tag> [--pob a,b] [--arquivo data.json] [--saida arvore.json]";
const AGENTE = "Mozilla/5.0 (guia-leveling; uso pessoal)";
/** O data.json da 3.29.1 tem 6,9 MB; muito acima disto não é ele. */
const TETO_BYTES = 40 * 1024 * 1024;
const ESPERA_MS = 60_000;
/** Só tags no formato da GGG (3.29.1), pra tag nenhuma virar outro endereço. */
const TAG = /^[0-9]{1,2}\.[0-9]{1,3}\.[0-9]{1,3}$/;

// ---------- linha de comando ----------

function lerArgumentos(args) {
  const lido = { tag: null, pob: null, arquivo: null, saida: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--pob" || a === "--arquivo" || a === "--saida") {
      const valor = args[++i];
      if (valor === undefined || valor === "") throw new Error(`falta o valor de ${a}`);
      lido[a.slice(2)] = valor;
    } else if (a.startsWith("--")) {
      throw new Error(`opção desconhecida: ${a}`);
    } else if (lido.tag === null) {
      lido.tag = a;
    } else {
      throw new Error(`argumento sobrando: ${a}`);
    }
  }
  if (lido.tag === null) throw new Error("falta a tag");
  if (!TAG.test(lido.tag)) throw new Error(`tag fora do formato 3.30.0: ${lido.tag}`);
  return lido;
}

/** "3.29.1" -> ["3_29", "3_29_ruthless"], os treeVersion que o PoB usa pra essa árvore. */
function pobDaTag(tag) {
  const [maior, menor] = tag.split(".");
  return [`${maior}_${menor}`, `${maior}_${menor}_ruthless`];
}

async function baixar(tag) {
  const endereco = `https://raw.githubusercontent.com/grindinggear/skilltree-export/${tag}/data.json`;
  const resposta = await fetch(endereco, { headers: { "User-Agent": AGENTE }, signal: AbortSignal.timeout(ESPERA_MS) });
  if (!resposta.ok) throw new Error(`${endereco} respondeu ${resposta.status}`);
  const bytes = Buffer.from(await resposta.arrayBuffer());
  if (bytes.length > TETO_BYTES) throw new Error(`data.json grande demais (${bytes.length} bytes)`);
  return bytes.toString("utf8");
}

// ---------- contas (as mesmas do PoB: PassiveTree.lua L897-903 e L1041-1062) ----------

const ANG16 = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330];
const ANG40 = [0, 10, 20, 30, 40, 45, 50, 60, 70, 80, 90, 100, 110, 120, 130, 135, 140, 150, 160, 170, 180, 190, 200, 210, 220, 225, 230, 240, 250, 260, 270, 280, 290, 300, 310, 315, 320, 330, 340, 350];

function anguloEmGraus(quantos, i) {
  if (quantos === 16) return ANG16[i];
  if (quantos === 40) return ANG40[i];
  return (360 * i) / quantos;
}

/** Vazio conta como "não tem": lista ou objeto sem nada vale o mesmo que o campo faltar. */
function tem(v) {
  if (v === undefined || v === null || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

/** Lê o data.json e põe em cada nó: id, x, y (unidades da árvore), sai, entra. */
function carregar(texto) {
  const d = JSON.parse(texto);
  const raios = d.constants.orbitRadii;
  const porOrbita = d.constants.skillsPerOrbit;
  const nos = new Map();
  for (const [chave, n] of Object.entries(d.nodes)) {
    if (chave === "root") continue;
    const m = { ...n, id: Number(chave) };
    if (!Number.isInteger(m.id)) throw new Error(`id de nó que não é número: ${chave}`);
    if (Object.hasOwn(n, "group")) {
      const g = d.groups[String(n.group)];
      if (g === undefined) throw new Error(`nó ${chave}: grupo ${n.group} não existe`);
      const a = anguloEmGraus(porOrbita[n.orbit], n.orbitIndex) * (Math.PI / 180);
      const r = raios[n.orbit];
      if (!Number.isFinite(a) || !Number.isFinite(r)) throw new Error(`nó ${chave}: órbita ${n.orbit}/${n.orbitIndex} fora da tabela`);
      m.x = g.x + r * Math.sin(a);
      m.y = g.y - r * Math.cos(a);
      m.grupoProxy = tem(g.isProxy);
    }
    m.sai = (n.out ?? []).map(Number);
    m.entra = (n.in ?? []).map(Number);
    nos.set(m.id, m);
  }
  return { d, nos };
}

/** Mesma ordem de teste do PoB (PassiveTree.lua L547-L597). */
function tipo(n) {
  if (Object.hasOwn(n, "classStartIndex")) return "ClassStart";
  if (tem(n.isAscendancyStart)) return "AscendClassStart";
  if (tem(n.isMastery)) return "Mastery";
  if (tem(n.isJewelSocket)) return "Socket";
  if (tem(n.isKeystone)) return "Keystone";
  if (tem(n.isNotable)) return "Notable";
  return "Normal";
}

/** PassiveSpec.lua L52-61: nó que o PoB põe na árvore "viva". */
function naSpec(n) {
  if (!Object.hasOwn(n, "group")) return false;
  if (tem(n.isProxy) || n.grupoProxy) return false;
  if (tem(n.expansionJewel) && tem(n.expansionJewel.parent)) return false;
  return true;
}

/** Árvore principal de verdade: está na spec, sem ascendência nem linhagem. */
function principal(n) {
  return naSpec(n) && !tem(n.ascendancyName);
}

const CODIGO = { Normal: 0, Notable: 1, Keystone: 2, Socket: 3, Mastery: 4, ClassStart: 5, AscendClassStart: 7 };

function codigoDoTipo(n) {
  const t = tipo(n);
  // encaixe grande de cluster (moldura maior, raio 100)
  if (t === "Socket" && tem(n.expansionJewel)) return 6;
  return CODIGO[t];
}

/**
 * Arredonda a uma casa. No meio exato (x,25 e x,75, os únicos que um número de máquina acerta em cheio)
 * vai pro dígito par, como o gerador original; o toFixed sozinho iria pra cima.
 */
function r1(v) {
  if (!Number.isFinite(v)) throw new Error(`coordenada que não é número: ${v}`);
  const a = Math.abs(v);
  const quartos = a * 4;
  let r;
  if (Number.isInteger(quartos) && quartos % 2 === 1) {
    const baixo = Math.floor(a * 10);
    r = (baixo % 2 === 0 ? baixo : baixo + 1) / 10;
  } else {
    r = Number(a.toFixed(1));
  }
  if (r === 0) return 0;
  return v < 0 ? -r : r;
}

const porId = (a, b) => a.id - b.id;

/**
 * Desde a 3.30 o texto dos efeitos vem com as marcas de link do jogo: "[Blind|Blinded]" aparece como
 * "Blinded" e "[Onslaught]" como "Onslaught". Fica só o que o jogo mostra.
 */
function semMarcas(texto) {
  return texto.replace(/\[([^[\]|]*)\|([^[\]]*)\]/g, "$2").replace(/\[([^[\]|]*)\]/g, "$1");
}

function montar(d, nos, versao, pob) {
  const todos = [...nos.values()];
  const visiveis = todos.filter((n) => principal(n) && !tem(n.isBlighted)).sort(porId);
  const indice = new Map(visiveis.map((n, i) => [n.id, i]));

  const numerosDeGrupo = [...new Set(visiveis.map((n) => n.group))].sort((a, b) => a - b);
  const indiceDoGrupo = new Map(numerosDeGrupo.map((g, i) => [g, i]));
  const grupos = numerosDeGrupo.map((g) => [d.groups[String(g)].x, d.groups[String(g)].y]);

  const linhas = visiveis.map((n) => [n.id, r1(n.x), r1(n.y), codigoDoTipo(n), indiceDoGrupo.get(n.group), n.orbit, n.name]);

  const ligacoes = [];
  for (const n of visiveis) {
    for (const o of n.sai) {
      if (indice.has(o)) ligacoes.push(indice.get(n.id), indice.get(o));
    }
  }

  const maestrias = {};
  for (const n of visiveis) {
    if (!tem(n.masteryEffects)) continue;
    const lista = n.masteryEffects.map((e) => [e.effect, e.stats.map(semMarcas).join("\n")]);
    if (Object.hasOwn(maestrias, n.name) && JSON.stringify(maestrias[n.name]) !== JSON.stringify(lista)) {
      throw new Error(`maestria "${n.name}" com listas de efeitos diferentes`);
    }
    maestrias[n.name] = lista;
  }

  const inicioDaClasse = new Map();
  for (const n of visiveis) {
    if (Object.hasOwn(n, "classStartIndex")) inicioDaClasse.set(n.classStartIndex, n.id);
  }
  const classes = d.classes.map((c, i) => {
    if (!inicioDaClasse.has(i)) throw new Error(`classe ${c.name}: sem nó de início`);
    return { nome: c.name, inicio: inicioDaClasse.get(i), ascendencias: (c.ascendancies ?? []).map((a) => a.id) };
  });

  const secundarias = (d.alternate_ascendancies ?? []).map((a) => a.id);
  const nomes = new Map();
  for (const c of d.classes) for (const a of c.ascendancies ?? []) nomes.set(a.id, a.name);
  for (const a of d.alternate_ascendancies ?? []) nomes.set(a.id, a.name);

  const chaves = [...new Set(todos.filter((n) => tem(n.ascendancyName)).map((n) => n.ascendancyName))].sort();
  const ascendencias = {};
  for (const chave of chaves) {
    const dela = todos.filter((n) => n.ascendancyName === chave && naSpec(n)).sort(porId);
    const inicio = dela.find((n) => tem(n.isAscendancyStart));
    if (inicio === undefined) throw new Error(`ascendência ${chave}: sem nó de início`);
    const indiceNela = new Map(dela.map((n, i) => [n.id, i]));
    const linhasDela = dela.map((n) => {
      const custo = tem(n.isAscendancyStart) || tem(n.isMultipleChoiceOption) ? 0 : 1;
      return [n.id, r1(n.x - inicio.x), r1(n.y - inicio.y), codigoDoTipo(n), custo, n.grantedPassivePoints ?? 0, n.name];
    });
    const ligacoesDela = [];
    for (const n of dela) {
      for (const o of n.sai) {
        if (indiceNela.has(o)) ligacoesDela.push(indiceNela.get(n.id), indiceNela.get(o));
      }
    }
    const uma = { nome: nomes.get(chave) ?? chave, inicio: inicio.id, secundaria: tem(inicio.isBloodline), nos: linhasDela, ligacoes: ligacoesDela };
    // pontes: ligações de um nó da ascendência com um nó comum da árvore principal (só a Ascendant tem: "Path of the X")
    const pontes = [];
    for (const n of dela) {
      for (const o of new Set([...n.sai, ...n.entra])) {
        if (indice.has(o) && !Object.hasOwn(nos.get(o), "classStartIndex")) pontes.push([n.id, o]);
      }
    }
    pontes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (pontes.length > 0) uma.pontes = pontes;
    ascendencias[chave] = uma;
  }

  // A ordem das chaves faz parte do formato (o arquivo tem de sair igual byte a byte).
  return { formato: 1, versao, pob, raios: d.constants.orbitRadii, grupos, nos: linhas, ligacoes, classes, secundarias, maestrias, ascendencias };
}

/** Recusa gravar uma árvore que claramente não é a do jogo (arquivo errado, formato da GGG mudou). */
function conferir(arvore) {
  const erros = [];
  if (arvore.nos.length < 1000) erros.push(`só ${arvore.nos.length} nós`);
  if (arvore.classes.length !== 7) erros.push(`${arvore.classes.length} classes em vez de 7`);
  if (arvore.ligacoes.length < 2000) erros.push(`só ${arvore.ligacoes.length / 2} ligações`);
  if (arvore.nos.some((n) => typeof n[6] !== "string" || !Number.isInteger(n[5]) || n[3] === undefined)) erros.push("nó com campo faltando");
  if (erros.length > 0) throw new Error(`isto não parece a árvore do jogo: ${erros.join("; ")}`);
}

// ---------- programa ----------

let pedido;
try {
  pedido = lerArgumentos(process.argv.slice(2));
} catch (erro) {
  console.error(`${erro.message}\n${USO}`);
  process.exit(2);
}

try {
  const texto = pedido.arquivo !== null ? readFileSync(resolve(pedido.arquivo), "utf8") : await baixar(pedido.tag);
  const { d, nos } = carregar(texto);
  const pob = pedido.pob !== null ? pedido.pob.split(",") : pobDaTag(pedido.tag);
  const arvore = montar(d, nos, pedido.tag, pob);
  conferir(arvore);

  const destino = pedido.saida !== null ? resolve(pedido.saida) : join(raiz, "src", "dados", "arvore", "arvore.json");
  const bytes = Buffer.from(JSON.stringify(arvore), "utf8");
  mkdirSync(dirname(destino), { recursive: true });
  // Grava ao lado e troca de uma vez, pra nunca ficar um arquivo pela metade.
  writeFileSync(`${destino}.novo`, bytes);
  renameSync(`${destino}.novo`, destino);

  const nosDeAscendencia = Object.values(arvore.ascendencias).reduce((soma, a) => soma + a.nos.length, 0);
  console.log(
    `árvore ${arvore.versao} (PoB ${pob.join(", ")}): ${arvore.nos.length} nós, ${arvore.ligacoes.length / 2} ligações, ` +
      `${arvore.grupos.length} grupos, ${Object.keys(arvore.maestrias).length} maestrias, ` +
      `${Object.keys(arvore.ascendencias).length} ascendências (${nosDeAscendencia} nós)`,
  );
  console.log(`${bytes.length} bytes em ${destino}`);
} catch (erro) {
  console.error(`Não deu pra gerar a árvore: ${erro.message}`);
  process.exit(1);
}
