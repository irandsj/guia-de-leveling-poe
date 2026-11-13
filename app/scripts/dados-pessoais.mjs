// Dados deste PC que não podem sair em nada que vai pra outra pessoa: o zip (pacote.mjs) e o
// repositório público (publicar.mjs).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

function git(chave) {
  try {
    return execFileSync("git", ["config", chave], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

/** A pasta do usuário (com \ e com /), o nome dele, o nome do PC e o e-mail do git. */
export function dadosPessoais() {
  const casa = os.homedir();
  return [casa, casa.replaceAll("\\", "/"), os.userInfo().username, os.hostname(), git("user.email")].filter(
    (s) => s.length >= 4,
  );
}

/**
 * Procura cada dado em cada arquivo, sem ligar pra maiúscula, como texto comum e como UTF-16 (o
 * jeito do Windows guardar texto dentro do exe), nos dois alinhamentos. Devolve "arquivo: dado".
 */
export function procurarDadosPessoais(arquivos, nomeDoArquivo = (f) => f, proibidos = dadosPessoais()) {
  const achados = [];
  for (const f of arquivos) {
    const bytes = fs.readFileSync(f);
    const formas = [bytes.toString("latin1"), bytes.toString("utf16le"), bytes.subarray(1).toString("utf16le")].map(
      (t) => t.toLowerCase(),
    );
    for (const p of proibidos) {
      const q = p.toLowerCase();
      if (formas.some((t) => t.includes(q))) achados.push(`${nomeDoArquivo(f)}: "${p}"`);
    }
  }
  return achados;
}
