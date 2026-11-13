// Copia o guia pro clone do repositório público (github.com/irandsj/guia-de-leveling-poe).
//
//   node scripts/publicar.mjs            clone em ../../../guia-de-leveling-poe (do lado da pasta POE)
//   node scripts/publicar.mjs <pasta>    clone em outro lugar
//
// O público é um espelho da pasta `leveling` só com o que é do programa (a lista PUBLICO). Os
// estudos (conhecimento), os prompts e as notas do patch ficam só no repositório privado.
// Só copia o que está no git, e para se essas pastas tiverem mudança sem commit. Apaga do clone o
// que saiu daqui. Antes de copiar, procura os dados pessoais deste PC, como o pacote.mjs. O commit e
// o push são feitos no clone, à mão.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { procurarDadosPessoais } from "./dados-pessoais.mjs";

const PUBLICO = [".gitattributes", "README.md", "LICENSE", "docs", "app", "terceiros"];

const leveling = path.resolve(import.meta.dirname, "..", "..");
const destino = path.resolve(process.argv[2] ?? path.join(leveling, "..", "..", "guia-de-leveling-poe"));

function parar(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
/** Os arquivos que o git guarda, com caminho a partir de `cwd` e barra normal. */
const doGit = (cwd, ...pastas) => git(cwd, "ls-files", "-z", "--", ...pastas).split("\0").filter(Boolean);

if (!fs.existsSync(path.join(destino, ".git"))) parar(`${destino} não é um clone do git.`);
if (!path.relative(leveling, destino).startsWith("..")) parar("o clone não pode ficar dentro da pasta leveling.");

const sujo = git(leveling, "status", "--porcelain", "--", ...PUBLICO).trimEnd();
if (sujo) parar(`faça o commit antes de publicar:\n${sujo}`);

const lista = doGit(leveling, ...PUBLICO);
const achados = procurarDadosPessoais(lista.map((f) => path.join(leveling, f)), (f) => path.relative(leveling, f));
if (achados.length) parar(`dado pessoal:\n  ${achados.join("\n  ")}`);

// Apaga do clone o que ele guarda e saiu daqui (o que o git de lá ignora, como node_modules, fica).
const fica = new Set(lista);
let apagados = 0;
for (const f of doGit(destino)) {
  if (!fica.has(f)) {
    fs.rmSync(path.join(destino, f), { force: true });
    apagados++;
  }
}
for (const f of lista) {
  const alvo = path.join(destino, f);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.copyFileSync(path.join(leveling, f), alvo);
}

const mudou = git(destino, "status", "--porcelain").split("\n").filter(Boolean);
console.log(`✓ ${lista.length} arquivos sem dado pessoal copiados pra ${destino} (${apagados} apagados).`);
console.log(mudou.length ? `  ${mudou.length} mudanças pra commit lá.` : "  Nada mudou.");
