// Gera o zip pra mandar o guia pra outra pessoa: o instalador, o LEIA-ME e as licenças.
//
//   node scripts/pacote.mjs                 compila e monta o zip
//   node scripts/pacote.mjs --sem-compilar  só monta o zip de novo (depois de mexer no LEIA-ME)
//
// Compila numa pasta à parte (src-tauri/target/pacote): não mexe no guia que está aberto nem
// no build normal. O Rust guarda dentro do exe o caminho de cada arquivo das bibliotecas (pras
// mensagens de erro), e elas ficam na pasta do usuário: o remap troca "C:\Users\<nome>" por "~".
// No fim, procura no exe e na tela embutida o nome do usuário, a pasta dele, o nome do PC e o
// e-mail do git. Se achar qualquer um, para sem gerar o zip.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dadosPessoais, procurarDadosPessoais } from "./dados-pessoais.mjs";

const app = path.resolve(import.meta.dirname, "..");
const alvo = path.join(app, "src-tauri", "target", "pacote");
const conf = JSON.parse(fs.readFileSync(path.join(app, "src-tauri", "tauri.conf.json"), "utf8"));
const versao = conf.version;
const nome = `${conf.productName} ${versao}`;
const casa = os.homedir();

function parar(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

// 1. Compilar.
if (!process.argv.includes("--sem-compilar")) {
  const env = {
    ...process.env,
    CARGO_TARGET_DIR: alvo,
    CARGO_ENCODED_RUSTFLAGS: `--remap-path-prefix=${casa}=~`,
  };
  const r = spawnSync("npx", ["tauri", "build"], { cwd: app, env, stdio: "inherit", shell: true });
  if (r.status !== 0) parar(`o build saiu com ${r.status}.`);
}

const exe = path.join(alvo, "release", `${conf.mainBinaryName}.exe`);
const instalador = path.join(alvo, "release", "bundle", "nsis", `${conf.productName}_${versao}_x64-setup.exe`);
for (const f of [exe, instalador]) if (!fs.existsSync(f)) parar(`não achei ${f}`);

// 2. Procurar dados pessoais.
function arquivos(pasta) {
  return fs.readdirSync(pasta, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath, e.name));
}
const conferir = [exe, instalador, ...arquivos(path.join(app, "dist")), ...arquivos(path.join(app, "distribuir"))];
const proibidos = dadosPessoais();
const achados = procurarDadosPessoais(conferir, (f) => path.relative(app, f), proibidos);
if (achados.length) parar(`dado pessoal no pacote:\n  ${achados.join("\n  ")}`);
console.log(`\n✓ ${conferir.length} arquivos conferidos: nenhum tem ${proibidos.length} dados pessoais deste PC.`);

// 3. Montar a pasta e o zip. Texto com BOM e CRLF, pro Bloco de Notas mostrar os acentos.
const pasta = path.join(alvo, nome);
fs.rmSync(pasta, { recursive: true, force: true });
fs.mkdirSync(pasta, { recursive: true });
fs.copyFileSync(instalador, path.join(pasta, `Instalar ${conf.productName}.exe`));

function texto(arquivo, extra = "") {
  const t = fs.readFileSync(path.join(app, "distribuir", arquivo), "utf8").replaceAll("{versao}", versao) + extra;
  return "\ufeff" + t.replace(/\r?\n/g, "\r\n");
}
fs.writeFileSync(path.join(pasta, "LEIA-ME.txt"), texto("LEIA-ME.txt"));
const licencas = [
  ["exile-leveling", "../terceiros/exile-leveling/LICENSE"],
  ["Exile-UI", "../terceiros/exile-ui/LICENSE.md"],
]
  .map(([projeto, arquivo]) => `\n\n==== ${projeto} ====\n\n${fs.readFileSync(path.join(app, arquivo), "utf8").trim()}\n`)
  .join("");
fs.writeFileSync(path.join(pasta, "LICENCAS.txt"), texto("LICENCAS.txt", licencas));

// O tar do Windows (não o do Git) faz zip com "-a".
const zip = path.join(alvo, `${nome}.zip`);
fs.rmSync(zip, { force: true });
const tar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
execFileSync(tar, ["-a", "-c", "-f", zip, nome], { cwd: alvo });

const mb = (f) => (fs.statSync(f).size / 1024 / 1024).toFixed(1);
console.log(`✓ ${zip} (${mb(zip)} MB)`);
