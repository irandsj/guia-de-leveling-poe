#!/usr/bin/env node
// Simulador do Client.txt: escreve linhas no mesmo formato do jogo num arquivo de TESTE,
// pra exercitar o app sem abrir o Path of Exile.
//
//   node scripts/simular-client.mjs <arquivo> zona <idDaArea> [nivelDaArea] [nome da área]
//   node scripts/simular-client.mjs <arquivo> nivel <personagem> <classe> <nivel>
//   node scripts/simular-client.mjs <arquivo> morte <personagem>
//
// Pra o app ler esse arquivo, abra o app com a variável GUIA_CLIENT_TXT apontando pra
// ele (ou escolha o arquivo na tela de configuração).
//
// O simulador se recusa a escrever dentro da pasta do jogo: o Client.txt de verdade é
// só pra leitura.

import { appendFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let relogioDoJogo = 1026000;

const dois = (n) => String(n).padStart(2, "0");

/** Data e hora no formato do log: 2026/11/10 20:00:31. */
export function carimbo(quando = new Date()) {
  const data = `${quando.getFullYear()}/${dois(quando.getMonth() + 1)}/${dois(quando.getDate())}`;
  const hora = `${dois(quando.getHours())}:${dois(quando.getMinutes())}:${dois(quando.getSeconds())}`;
  return `${data} ${hora}`;
}

function comeco(tipo) {
  relogioDoJogo += 1100;
  const marca = tipo === "DEBUG" ? "1186a8a3" : "cffb065b";
  return `${carimbo()} ${relogioDoJogo} ${marca} [${tipo} Client 4321]`;
}

/** O jogo montou uma zona (é esta linha que traz o id e o nível da área). */
export function linhaZona(idDaArea, nivelDaArea = 1, semente = 1 + Math.floor(Math.random() * 4e9)) {
  return `${comeco("DEBUG")} Generating level ${nivelDaArea} area "${idDaArea}" with seed ${semente}`;
}

/** O personagem entrou numa zona (traz o nome, no idioma do jogo). */
export function linhaEntrou(nomeDaArea) {
  return `${comeco("INFO")} : You have entered ${nomeDaArea}.`;
}

export function linhaNivel(personagem, classe, nivel) {
  return `${comeco("INFO")} : ${personagem} (${classe}) is now level ${nivel}`;
}

export function linhaMorte(personagem) {
  return `${comeco("INFO")} : ${personagem} has been slain.`;
}

/** Recusa qualquer caminho que pareça ser da instalação do jogo. */
export function conferirDestino(caminho) {
  const completo = resolve(caminho);
  const minusculo = completo.toLowerCase().replaceAll("/", "\\");
  const proibidos = ["grinding gear games", "path of exile", "pathofexile", "steamapps"];
  if (proibidos.some((pedaco) => minusculo.includes(pedaco))) {
    throw new Error(`Não escrevo na pasta do jogo: ${completo}`);
  }
  // Uma pasta "logs" ao lado do executável do jogo também é do jogo.
  let vizinhos = [];
  try {
    vizinhos = readdirSync(dirname(dirname(completo)));
  } catch {
    // A pasta de cima não existe ou não dá pra ler: então não é a do jogo.
  }
  if (vizinhos.some((nome) => /^pathofexile.*\.exe$/i.test(nome))) {
    throw new Error(`Não escrevo na pasta do jogo: ${completo}`);
  }
  return completo;
}

/** Acrescenta linhas ao fim do arquivo de teste (com fim de linha do Windows, como o jogo). */
export function acrescentar(caminho, linhas) {
  const destino = conferirDestino(caminho);
  mkdirSync(dirname(destino), { recursive: true });
  appendFileSync(destino, linhas.map((linha) => `${linha}\r\n`).join(""), "utf8");
}

function ajuda() {
  console.log(
    [
      "Uso:",
      "  node scripts/simular-client.mjs <arquivo> zona <idDaArea> [nivelDaArea] [nome da área]",
      "  node scripts/simular-client.mjs <arquivo> nivel <personagem> <classe> <nivel>",
      "  node scripts/simular-client.mjs <arquivo> morte <personagem>",
      "",
      "Exemplos:",
      '  node scripts/simular-client.mjs C:\\temp\\Client.txt zona 1_1_2 2 "The Coast"',
      "  node scripts/simular-client.mjs C:\\temp\\Client.txt nivel Heroi Marauder 3",
    ].join("\n"),
  );
}

function linhaDeComando(argumentos) {
  const [arquivo, comando, ...resto] = argumentos;
  if (!arquivo || !comando) {
    ajuda();
    return 1;
  }
  let linhas;
  if (comando === "zona" && resto[0]) {
    const nivel = Number(resto[1] ?? 1);
    const nome = resto.slice(2).join(" ");
    linhas = [linhaZona(resto[0], Number.isFinite(nivel) ? nivel : 1)];
    if (nome) linhas.push(linhaEntrou(nome));
  } else if (comando === "nivel" && resto.length >= 3) {
    linhas = [linhaNivel(resto[0], resto[1], Number(resto[2]))];
  } else if (comando === "morte" && resto[0]) {
    linhas = [linhaMorte(resto[0])];
  } else {
    ajuda();
    return 1;
  }
  acrescentar(arquivo, linhas);
  linhas.forEach((linha) => console.log(linha));
  return 0;
}

const chamadoDireto = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (chamadoDireto) {
  try {
    process.exitCode = linhaDeComando(process.argv.slice(2));
  } catch (erro) {
    console.error(erro.message);
    process.exitCode = 1;
  }
}
