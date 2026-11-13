// Gera a tabela que diz qual foto é de cada item (src/dados/artes-itens.json).
//
//   node scripts/gerar-artes-itens.mjs                       baixa as listas do RePoE
//   node scripts/gerar-artes-itens.mjs --pasta <pasta>       lê base_items.json e uniques.json já baixados
//
// - Entra: base_items e uniques do RePoE (repoe-fork.github.io), campo visual_identity.dds_file.
// - Sai: { "bases": { nome: arte }, "unicos": { nome: arte } }, com a arte sem o "Art/2DItems/" do começo
//   e sem o ".dds" do fim ("Armours/Helmets/HelmetDex1").
// - Só os itens que vão no personagem: armas, armaduras, joias, frascos, aljavas e jewels.
// - A foto mesmo o guia baixa na hora de mostrar (fotos.rs), de cdn.poedb.tw/image/Art/2DItems/<arte>.webp,
//   e guarda na pasta de dados. A arte é da Grinding Gear Games.

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const saida = join(raiz, "src", "dados", "artes-itens.json");
const AGENTE = "Mozilla/5.0 (guia-leveling; uso pessoal)";
const PREFIXO = "Art/2DItems/";

/** Classes de item do RePoE que vão no personagem. */
const CLASSES = new Set([
  "Claw",
  "Dagger",
  "Rune Dagger",
  "Wand",
  "One Hand Sword",
  "Thrusting One Hand Sword",
  "One Hand Axe",
  "One Hand Mace",
  "Sceptre",
  "Bow",
  "Staff",
  "Warstaff",
  "Two Hand Sword",
  "Two Hand Axe",
  "Two Hand Mace",
  "Quiver",
  "Shield",
  "Helmet",
  "Body Armour",
  "Boots",
  "Gloves",
  "Ring",
  "Amulet",
  "Belt",
  "LifeFlask",
  "ManaFlask",
  "HybridFlask",
  "UtilityFlask",
  "Tincture",
  "AnimalCharm",
  "Jewel",
  "AbyssJewel",
]);

async function ler(nome, pasta) {
  if (pasta) return JSON.parse(readFileSync(join(pasta, `${nome}.json`), "utf8"));
  const resposta = await fetch(`https://repoe-fork.github.io/${nome}.min.json`, { headers: { "User-Agent": AGENTE } });
  if (!resposta.ok) throw new Error(`RePoE respondeu ${resposta.status} pro ${nome}`);
  return resposta.json();
}

function arte(item) {
  const dds = item?.visual_identity?.dds_file;
  if (typeof dds !== "string" || !dds.startsWith(PREFIXO) || !/\.dds$/i.test(dds)) return null;
  const caminho = dds.slice(PREFIXO.length).replace(/\.dds$/i, "");
  // O mesmo filtro do fotos.rs: o que não passar aqui o guia recusaria de qualquer jeito.
  return /^[A-Za-z0-9_\-]+(\/[A-Za-z0-9_\-]+)*$/.test(caminho) && caminho.length <= 160 ? caminho : null;
}

const i = process.argv.indexOf("--pasta");
const pasta = i >= 0 ? process.argv[i + 1] : null;
const bases = await ler("base_items", pasta);
const unicos = await ler("uniques", pasta);

const tabela = { bases: {}, unicos: {} };
// Base solta primeiro; base que só existe em único ("unique_only") só se o nome ainda não veio.
for (const estado of ["released", "unique_only"]) {
  for (const item of Object.values(bases)) {
    if (item.release_state !== estado || !CLASSES.has(item.item_class) || !item.name) continue;
    if (tabela.bases[item.name]) continue;
    const caminho = arte(item);
    if (caminho) tabela.bases[item.name] = caminho;
  }
}
for (const alternativa of [false, true]) {
  for (const item of Object.values(unicos)) {
    if (Boolean(item.is_alternate_art) !== alternativa || !CLASSES.has(item.item_class) || !item.name) continue;
    if (tabela.unicos[item.name]) continue;
    const caminho = arte(item);
    if (caminho) tabela.unicos[item.name] = caminho;
  }
}

const ordenar = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const texto = JSON.stringify({ bases: ordenar(tabela.bases), unicos: ordenar(tabela.unicos) });
writeFileSync(`${saida}.tmp`, texto, "utf8");
renameSync(`${saida}.tmp`, saida);
console.log(
  `${Object.keys(tabela.bases).length} bases · ${Object.keys(tabela.unicos).length} únicos · ${(texto.length / 1024).toFixed(0)} KB em ${saida}`,
);
