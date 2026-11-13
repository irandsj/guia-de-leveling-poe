// Copia as imagens de layout das zonas do Exile-UI (MIT, Lailloken) pro app e gera o índice.
//
// Uso: node scripts/copiar-layouts.mjs <pasta do clone do Exile-UI>
//
// Entra:  <clone>/img/GUI/act-decoder/zones/<areaID> <variante>.jpg  (+ explanation.jpg)
// Sai:    public/layouts/<areaID>/<variante>.jpg, public/layouts/legenda.jpg
//         src/dados/layouts.json  ({ "<areaID>": ["1", "1_1", "2", "x"] })
//
// Só copia o que está na lista do próprio Exile-UI (file-list.json), tem nome no formato
// esperado e é mesmo um JPEG de tamanho normal.

import { copyFileSync, mkdirSync, openSync, readSync, closeSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const clone = process.argv[2];
if (!clone) {
  console.error("Uso: node scripts/copiar-layouts.mjs <pasta do clone do Exile-UI>");
  process.exit(2);
}

const decoder = join(resolve(clone), "img", "GUI", "act-decoder");
const zonas = join(decoder, "zones");
const permitidos = new Set(Object.keys(JSON.parse(readFileSync(join(decoder, "file-list.json"), "utf8"))));

// O id pode terminar em "_" (a Lunaris Temple Level 1 é "2_8_7_1_").
const NOME = /^([A-Za-z0-9_]{1,40}) ((?:[0-9]{1,2}|x)(?:_(?:[0-9]{1,2}|x))*)\.jpg$/;
const TETO = 600 * 1024;

function ehJpeg(caminho) {
  const tamanho = statSync(caminho).size;
  if (tamanho < 1024 || tamanho > TETO) return false;
  const cabeca = Buffer.alloc(3);
  const arquivo = openSync(caminho, "r");
  try {
    readSync(arquivo, cabeca, 0, 3, 0);
  } finally {
    closeSync(arquivo);
  }
  return cabeca[0] === 0xff && cabeca[1] === 0xd8 && cabeca[2] === 0xff;
}

/** "2_10" vem depois de "2_9", e o "x" (aparece sempre) fica por último. */
function ordem(a, b) {
  const pa = a.split("_");
  const pb = b.split("_");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    if (pa[i] === pb[i]) continue;
    if (pa[i] === "x") return 1;
    if (pb[i] === "x") return -1;
    return Number(pa[i]) - Number(pb[i]);
  }
  return 0;
}

const destino = join(raiz, "public", "layouts");
rmSync(destino, { recursive: true, force: true });
mkdirSync(destino, { recursive: true });

const indice = {};
const pulados = [];
let copiados = 0;
let bytes = 0;

for (const arquivo of readdirSync(zonas).sort()) {
  const caminho = join(zonas, arquivo);
  if (arquivo === "explanation.jpg") {
    if (ehJpeg(caminho)) copyFileSync(caminho, join(destino, "legenda.jpg"));
    else pulados.push(arquivo);
    continue;
  }
  const m = NOME.exec(arquivo);
  if (!m || !permitidos.has(arquivo) || !ehJpeg(caminho)) {
    pulados.push(arquivo);
    continue;
  }
  const [, area, variante] = m;
  mkdirSync(join(destino, area), { recursive: true });
  copyFileSync(caminho, join(destino, area, `${variante}.jpg`));
  (indice[area] ??= []).push(variante);
  copiados++;
  bytes += statSync(caminho).size;
}

const ordenado = {};
for (const area of Object.keys(indice).sort()) ordenado[area] = indice[area].sort(ordem);
mkdirSync(join(raiz, "src", "dados"), { recursive: true });
writeFileSync(join(raiz, "src", "dados", "layouts.json"), `${JSON.stringify(ordenado, null, 1)}\n`);

console.log(`${copiados} imagens de ${Object.keys(ordenado).length} zonas (${(bytes / 1048576).toFixed(1)} MB) em public/layouts/`);
if (pulados.length > 0) console.log(`Puladas (${pulados.length}): ${pulados.join(", ")}`);
