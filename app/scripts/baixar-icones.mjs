// Baixa o ícone de cada gema que a campanha dá ou vende, pra leitura de tela reconhecer a gema.
//
//   node scripts/baixar-icones.mjs            baixa só os que faltam
//   node scripts/baixar-icones.mjs --tudo     baixa todos de novo
//
// - Quais gemas: as que aparecem em alguma recompensa ou loja do quests.json (exile-leveling).
// - Qual arte é de cada gema: base_items do RePoE (repoe-fork.github.io), campo visual_identity.dds_file.
// - A imagem: cdn.poedb.tw, que já entrega o ícone montado, 78x78 com fundo transparente.
//   (A arte é da Grinding Gear Games.)
// Saída: public/gemas/<fim do id da gema>.webp
//
// Depois rode `python -I scripts/icones-da-ggg.py`: ele troca a arte das gemas pela montada direto
// do CDN da GGG. A do poedb às vezes vem com o desenho em outro lugar em cima da pedra, e a leitura
// de tela não reconhece a gema (foi o caso da Kinetic Bolt).

import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const dados = join(raiz, "src", "terceiros", "exile-leveling", "data", "json");
const saida = join(raiz, "public", "gemas");
const tudo = process.argv.includes("--tudo");
const AGENTE = "Mozilla/5.0 (guia-leveling; uso pessoal)";
const ESPERA_MS = 120;

const quests = JSON.parse(readFileSync(join(dados, "quests.json"), "utf8"));
const ids = new Set();
for (const quest of Object.values(quests)) {
  for (const oferta of Object.values(quest.reward_offers ?? {})) {
    for (const id of Object.keys(oferta.quest ?? {})) ids.add(id);
    for (const id of Object.keys(oferta.vendor ?? {})) ids.add(id);
  }
}

// Gemas novas da 3.30 que ainda não estão no quests.json (ver src/nucleo/dados-330.ts).
// Em 11/11/2026 o RePoE e o poedb ainda não tinham a Arcane Link. O ícone dela em public/gemas foi
// feito à mão do PNG oficial de 47x47 da GGG (post "New and Changed Gems",
// https://www.pathofexile.com/forum/view-thread/4013898), ampliado pra 78x78 sem deslocar: o PNG
// oficial é o ícone montado da GGG reduzido (conferido com a Flame Link, que tem nos dois; em
// 12/11/2026, trocado do enquadramento do poedb pro da GGG). Enquanto o RePoE não tiver a gema,
// este script e o icones-da-ggg.py só avisam "sem arte no RePoE" e não mexem no arquivo. Quando
// tiver, apagar o arquivo e rodar os dois.
ids.add("Metadata/Items/Gems/SkillGemArcaneLink");

const resposta = await fetch("https://repoe-fork.github.io/base_items.min.json", { headers: { "User-Agent": AGENTE } });
if (!resposta.ok) throw new Error(`RePoE respondeu ${resposta.status}`);
const itens = await resposta.json();

mkdirSync(saida, { recursive: true });
let baixados = 0;
let ja_tinha = 0;
const falhas = [];
for (const id of [...ids].sort()) {
  const arquivo = join(saida, `${id.split("/").pop()}.webp`);
  if (!tudo && existsSync(arquivo)) {
    ja_tinha++;
    continue;
  }
  const dds = itens[id]?.visual_identity?.dds_file;
  if (!dds) {
    falhas.push(`${id}: sem arte no RePoE`);
    continue;
  }
  const endereco = `https://cdn.poedb.tw/image/${dds.replace(/\.dds$/i, "")}.webp`;
  try {
    const r = await fetch(endereco, { headers: { "User-Agent": AGENTE } });
    if (!r.ok) throw new Error(`resposta ${r.status}`);
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.subarray(0, 4).toString("latin1") !== "RIFF") throw new Error("não é WebP");
    writeFileSync(arquivo, bytes);
    baixados++;
  } catch (erro) {
    falhas.push(`${id}: ${erro.message}`);
  }
  await new Promise((ok) => setTimeout(ok, ESPERA_MS));
}

console.log(`${ids.size} gemas · ${baixados} baixadas · ${ja_tinha} já estavam · ${falhas.length} falharam`);
for (const falha of falhas) console.log(`  ${falha}`);
