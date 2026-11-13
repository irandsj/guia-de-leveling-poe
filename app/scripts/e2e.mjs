#!/usr/bin/env node
// Teste de ponta a ponta: abre o app de verdade, confere a janela e as teclas, importa uma
// build de teste, faz uma corrida de mentira escrevendo num Client.txt de teste, fecha o
// app e abre de novo pra ver se ele retoma de onde parou.
//
//   node scripts/e2e.mjs [--exe caminho\guia-leveling.exe] [--sem-teclas] [--foto caminho.png]
//                        [--medir segundos]
//
// Sem --exe, usa a versão de desenvolvimento com a interface embutida:
//   cd src-tauri && cargo build --features tauri/custom-protocol
//
// A versão final (release) não informa o número das teclas globais. Com ela, use
// --sem-teclas: o teste pula as conferências que dependem de avisar uma tecla ao app.
//
// --medir 60 abre o app de novo no fim, já com a build, e mede a memória e o uso de CPU dele
// e dos processos do WebView2, 60 s em cada situação: com o relógio parado, com ele contando,
// com as imagens de layout na tela e depois de passar por todas as zonas que têm layout (uma
// campanha inteira, acelerada). Só faz sentido com a versão final. A medição é informação:
// não reprova o teste. Ela acrescenta uns 8 minutos.
//
// O teste não usa o teclado nem o mouse e não toca no jogo:
// - não roda se o Path of Exile estiver aberto, e para na hora se ele abrir no meio;
// - usa uma pasta de dados e um Client.txt temporários;
// - conversa com a interface pela porta de depuração do WebView2, só em 127.0.0.1;
// - avisa as teclas globais direto à janela escondida do próprio app.
//
// Durante mais ou menos um minuto o overlay aparece na tela e F2, F3, F4, F6 e F7 ficam
// reservadas.

import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as dormir } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { acrescentar, linhaEntrou, linhaMorte, linhaNivel, linhaZona } from "./simular-client.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const APP = resolve(AQUI, "..");

const argumentos = process.argv.slice(2);
const opcao = (nome) => {
  const posicao = argumentos.indexOf(nome);
  return posicao >= 0 ? argumentos[posicao + 1] : undefined;
};
const EXE = resolve(opcao("--exe") ?? join(APP, "src-tauri", "target", "debug", "guia-leveling.exe"));
const FOTO = opcao("--foto") ? resolve(opcao("--foto")) : null;
const SEM_TECLAS = argumentos.includes("--sem-teclas");
// Segundos de cada medição de consumo (0 = não mede).
const MEDIR = Math.max(0, Number.parseInt(opcao("--medir") ?? "0", 10) || 0);
// Tempo pro app assentar depois de abrir, antes de medir.
const ASSENTAR_MS = 20000;
const META_DE_MEMORIA_MB = 100;

// A build que o teste cola: é a build de exemplo dos testes do importador (um Marauder de
// mentira), já no formato de código do Path of Building.
const BUILD = readFileSync(join(AQUI, "build-de-teste.txt"), "utf8").trim();

// Códigos do Windows pras teclas padrão do app.
const CTRL = 0x0002;
const F2 = 0x71;
const F3 = 0x72;
const F4 = 0x73;
const F6 = 0x75;
const F7 = 0x76;

// Todas as versões do jogo (normal, Steam, Epic) têm um processo que começa por PathOfExile.
const LISTAR_O_JOGO = ["/FI", "IMAGENAME eq PathOfExile*", "/FO", "CSV", "/NH"];
const temOJogo = (lista) => lista.toLowerCase().includes("pathofexile");
// De quanto em quanto tempo o teste olha se o jogo abriu.
const VIGIAR_O_JOGO_A_CADA_MS = 10000;

// No passeio pelas zonas com layout, o tempo em cada zona.
const PASSEIO_MS = 1000;
// A medição abre o app três vezes, mede quatro trechos e faz o passeio (umas 140 zonas).
const TEMPO_MAXIMO_MS = 240000 + (MEDIR > 0 ? (4 * MEDIR + 480) * 1000 : 0);

// ---------------------------------------------------------------------------
// Ferramentas
// ---------------------------------------------------------------------------

/** Roda o ajudante em PowerShell (scripts/janela.ps1) e devolve o JSON dele. */
function ps(acao, extras = {}) {
  const lista = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(AQUI, "janela.ps1"), "-Acao", acao];
  for (const [nome, valor] of Object.entries(extras)) lista.push(`-${nome}`, String(valor));
  const saida = execFileSync("powershell", lista, { encoding: "utf8", windowsHide: true });
  const linha = saida.trim().split(/\r?\n/).filter(Boolean).pop() ?? "{}";
  return JSON.parse(linha);
}

function portaLivre() {
  return new Promise((ok, falhou) => {
    const servidor = createServer();
    servidor.once("error", falhou);
    servidor.listen(0, "127.0.0.1", () => {
      const { port } = servidor.address();
      servidor.close(() => ok(port));
    });
  });
}

function lerJson(caminho) {
  try {
    return JSON.parse(readFileSync(caminho, "utf8"));
  } catch {
    return null;
  }
}

async function esperar(oQue, prazo, funcao) {
  const limite = Date.now() + prazo;
  let ultimo;
  for (;;) {
    try {
      ultimo = await funcao();
      if (ultimo) return ultimo;
    } catch (erro) {
      ultimo = erro.message;
    }
    if (Date.now() > limite) {
      throw new Error(`esperei ${prazo / 1000} s (último valor: ${JSON.stringify(ultimo)})`);
    }
    await dormir(150);
  }
}

/** Conversa com a página do app pelo protocolo de depuração do WebView2. */
class Pagina {
  #ws;
  #proximo = 1;
  #pendentes = new Map();

  static async abrir(porta, prazo, appSaiu) {
    const limite = Date.now() + prazo;
    while (Date.now() < limite) {
      if (appSaiu() !== null) throw new Error(`o app fechou sozinho ao abrir (código ${appSaiu()})`);
      try {
        const alvos = await (await fetch(`http://127.0.0.1:${porta}/json/list`)).json();
        const alvo = alvos.find((a) => a.type === "page" && a.webSocketDebuggerUrl);
        if (alvo) {
          const pagina = new Pagina();
          await pagina.#ligar(alvo.webSocketDebuggerUrl);
          return pagina;
        }
      } catch {
        // A porta ainda não abriu: tenta de novo.
      }
      await dormir(200);
    }
    throw new Error("a interface não respondeu na porta de depuração");
  }

  #ligar(endereco) {
    return new Promise((ok, falhou) => {
      this.#ws = new WebSocket(endereco);
      this.#ws.addEventListener("open", () => ok());
      this.#ws.addEventListener("error", () => falhou(new Error("não consegui ligar na interface")));
      this.#ws.addEventListener("message", (mensagem) => {
        const dados = JSON.parse(mensagem.data);
        const pendente = this.#pendentes.get(dados.id);
        if (!pendente) return;
        this.#pendentes.delete(dados.id);
        if (dados.error) pendente.falhou(new Error(dados.error.message));
        else pendente.ok(dados.result);
      });
    });
  }

  /** Manda um comando e espera a resposta. Sem resposta em 8 s, falha (nunca fica parado). */
  enviar(metodo, parametros = {}) {
    const id = this.#proximo++;
    return new Promise((ok, falhou) => {
      const prazo = setTimeout(() => {
        this.#pendentes.delete(id);
        falhou(new Error("a interface não respondeu em 8 s"));
      }, 8000);
      this.#pendentes.set(id, {
        ok: (valor) => (clearTimeout(prazo), ok(valor)),
        falhou: (erro) => (clearTimeout(prazo), falhou(erro)),
      });
      this.#ws.send(JSON.stringify({ id, method: metodo, params: parametros }));
    });
  }

  /** Roda um trecho de JavaScript na página e devolve o valor. */
  async avaliar(expressao) {
    const resposta = await this.enviar("Runtime.evaluate", {
      expression: expressao,
      returnByValue: true,
      awaitPromise: true,
    });
    if (resposta.exceptionDetails) {
      const detalhe = resposta.exceptionDetails.exception?.description ?? resposta.exceptionDetails.text;
      throw new Error(`erro na interface: ${detalhe}`);
    }
    return resposta.result.value;
  }

  fechar() {
    try {
      this.#ws.close();
    } catch {
      // já estava fechada
    }
  }
}

/**
 * O que o teste faz na tela. Tudo roda dentro da página, pelo JavaScript dela: "clicar" aqui
 * é chamar o botão direto, sem mexer no mouse de verdade.
 */
function ferramentas(pagina) {
  const js = (valor) => JSON.stringify(valor);
  return {
    texto: () => pagina.avaliar("document.body.innerText"),
    parte: (seletor) => pagina.avaliar(`document.querySelector(${js(seletor)})?.innerText ?? ""`),
    existe: (seletor) => pagina.avaliar(`document.querySelector(${js(seletor)}) !== null`),
    quantos: (seletor) => pagina.avaliar(`document.querySelectorAll(${js(seletor)}).length`),
    invocar: (comando, parametros = {}) =>
      pagina.avaliar(`window.__TAURI_INTERNALS__.invoke(${js(comando)}, ${js(parametros)})`),

    /** A linha de cima do guia: ato, passo, zona, nível, relógio e mortes. */
    situacao: () =>
      pagina.avaliar(`(() => {
        const caixa = document.querySelector(".situacao");
        if (!caixa) return null;
        const filhos = [...caixa.children].map((filho) => filho.innerText.trim());
        return {
          ato: caixa.querySelector(".ato")?.innerText.trim() ?? "",
          passo: filhos[1] ?? "",
          zona: caixa.querySelector(".zona-atual")?.innerText.trim() ?? "",
          nivel: filhos.find((texto) => texto.startsWith("nv ")) ?? "",
          mortes: caixa.querySelector(".mortes")?.innerText.trim() ?? "",
          relogio_parado: caixa.querySelector(".relogio.parado") !== null,
        };
      })()`),

    temBotao: (rotulo) =>
      pagina.avaliar(
        `[...document.querySelectorAll("button")].some((b) => b.innerText.trim() === ${js(rotulo)} && !b.disabled)`,
      ),

    /** Aciona o botão com este texto. Devolve `false` se ele não existe ou está desligado. */
    clicar: (rotulo) =>
      pagina.avaliar(`(() => {
        const botao = [...document.querySelectorAll("button")].find(
          (b) => b.innerText.trim() === ${js(rotulo)} && !b.disabled,
        );
        if (!botao) return false;
        botao.click();
        return true;
      })()`),

    /** Põe o texto na caixa de colar, do jeito que o React percebe. */
    colar: (texto) =>
      pagina.avaliar(`(() => {
        const caixa = document.querySelector("textarea.colar");
        if (!caixa) return false;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(caixa, ${js(texto)});
        caixa.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`),

    /** Abre um bloco do modo de edição ("Opções", "Corrida"...). */
    abrirBloco: (titulo) =>
      pagina.avaliar(`(() => {
        const botao = [...document.querySelectorAll("button.bloco-titulo")].find((b) =>
          b.innerText.trim().endsWith(${js(titulo)}),
        );
        if (!botao) return false;
        if (botao.getAttribute("aria-expanded") !== "true") botao.click();
        return true;
      })()`),

    /** Liga ou desliga a caixinha de marcar que tem este texto. */
    marcar: (rotulo) =>
      pagina.avaliar(`(() => {
        const marca = [...document.querySelectorAll("label.marca")].find((m) => m.innerText.includes(${js(rotulo)}));
        const caixa = marca?.querySelector("input");
        if (!caixa) return false;
        caixa.click();
        return true;
      })()`),
  };
}

/** O número do passo dentro do ato ("5/41" → 5). */
const numeroDoPasso = (situacao) => Number.parseInt(situacao?.passo ?? "", 10);

// O app que está aberto agora, pra trava de segurança e a faxina do fim saberem quem fechar.
let aberto = null;
let aberturas = 0;

/**
 * Abre o app com a pasta de dados e o Client.txt de teste. Com `depuracao: false` ele abre
 * como na vida real, sem a porta por onde o teste conversa com a interface.
 */
async function abrirApp(pasta, { depuracao = true } = {}) {
  aberturas += 1;
  const porta = depuracao ? await portaLivre() : null;
  const ambiente = {
    ...process.env,
    GUIA_PASTA_DADOS: join(pasta, "dados"),
    GUIA_CLIENT_TXT: join(pasta, "Client.txt"),
    // Uma pasta do WebView2 por abertura: a da vez anterior pode demorar a ser solta.
    WEBVIEW2_USER_DATA_FOLDER: join(pasta, `webview-${aberturas}`),
  };
  delete ambiente.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS;
  if (porta !== null) ambiente.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${porta}`;
  const processo = spawn(EXE, [], { env: ambiente, stdio: ["ignore", "pipe", "pipe"] });
  const app = { processo, porta, codigo: null, saida: "", teclas: {} };
  processo.on("exit", (codigo) => {
    app.codigo = codigo ?? -1;
  });
  // A versão de desenvolvimento escreve o número de cada tecla global que registrou.
  for (const canal of [processo.stdout, processo.stderr]) {
    canal.setEncoding("utf8");
    canal.on("data", (pedaco) => {
      app.saida += pedaco;
      for (const achado of app.saida.matchAll(/\[teclas\] (\w+) id=(\d+)/g)) {
        app.teclas[achado[1]] = Number(achado[2]);
      }
    });
  }
  aberto = app;
  return app;
}

const resultados = [];

function conferir(nome, ok, detalhe = "") {
  resultados.push({ nome, ok: Boolean(ok), detalhe });
  console.log(`${ok ? "  ok   " : "  FALHA"} ${nome}${detalhe ? `  (${detalhe})` : ""}`);
  return Boolean(ok);
}

async function conferirEspera(nome, prazo, funcao) {
  try {
    const valor = await esperar(nome, prazo, funcao);
    conferir(nome, true);
    return valor;
  } catch (erro) {
    conferir(nome, false, erro.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Consumo
// ---------------------------------------------------------------------------

const numero = (valor, casas = 1) =>
  valor.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const soma = (processos, campo) => processos.reduce((total, processo) => total + processo[campo], 0);

/** Memória e tempo de CPU, agora, do app e dos processos do WebView2 que ele abriu. */
function consumoAgora(idDoProcesso) {
  const medida = ps("consumo", { IdProcesso: idDoProcesso });
  if (!medida.ok) throw new Error(medida.erro ?? "não consegui medir o consumo");
  return { ...medida, processos: [medida.processos ?? []].flat() };
}

/** Mede no começo e no fim de um trecho: a memória é a maior das duas; a CPU, o gasto no meio. */
async function medirTrecho(idDoProcesso, segundos) {
  const antes = consumoAgora(idDoProcesso);
  await dormir(segundos * 1000);
  const depois = consumoAgora(idDoProcesso);
  const cpuAntes = new Map(antes.processos.map((processo) => [processo.id, processo.cpu_s]));
  // Processo que nasceu no meio do trecho entra com todo o tempo de CPU dele.
  const cpu = depois.processos.reduce((total, processo) => total + processo.cpu_s - (cpuAntes.get(processo.id) ?? 0), 0);
  const tempo = (depois.quando_ms - antes.quando_ms) / 1000;
  return {
    segundos: tempo,
    memoria_mb: Math.max(soma(antes.processos, "privado_mb"), soma(depois.processos, "privado_mb")),
    memoria_no_comeco_mb: soma(antes.processos, "privado_mb"),
    memoria_no_fim_mb: soma(depois.processos, "privado_mb"),
    // Com as partes que os processos dividem entre si e com o resto do Windows (conta a mais).
    memoria_com_dividida_mb: Math.max(soma(antes.processos, "total_mb"), soma(depois.processos, "total_mb")),
    cpu_um_nucleo: (cpu / tempo) * 100,
    cpu_computador: ((cpu / tempo) * 100) / depois.nucleos,
    nucleos: depois.nucleos,
    processos: depois.processos,
    // false = Windows antigo, que não informa a memória só de cada processo.
    so_do_processo: antes.privado_conhecido !== false && depois.privado_conhecido !== false,
  };
}

// As situações medidas.
const PARADO = "relógio parado";
const CONTANDO = "relógio contando";
const COM_LAYOUT = "contando, com o layout aberto";
const DEPOIS_DO_PASSEIO = "depois de passar pelas zonas";

/** As zonas que têm imagens de layout, com o nome e o nível de cada uma. */
function zonasComLayout() {
  const layouts = lerJson(join(APP, "src", "dados", "layouts.json")) ?? {};
  const areas = lerJson(join(APP, "src", "terceiros", "exile-leveling", "data", "json", "areas.json")) ?? {};
  return Object.keys(layouts).map((id) => ({ id, nome: areas[id]?.name ?? id, nivel: areas[id]?.level ?? 1 }));
}

function mostrarTrecho(nome, trecho) {
  console.log(
    `  ${nome.padEnd(COM_LAYOUT.length)}: ${numero(trecho.memoria_mb)} MB de memória · ` +
      `CPU ${numero(trecho.cpu_computador, 2)}% do computador ` +
      `(${numero(trecho.cpu_um_nucleo, 2)}% de um dos ${trecho.nucleos} núcleos, em ${numero(trecho.segundos, 0)} s)`,
  );
}

function mostrarProcessos(nome, trecho) {
  const partes = trecho.processos
    .toSorted((a, b) => b.privado_mb - a.privado_mb)
    .map((processo) => `${processo.papel} ${numero(processo.privado_mb)}`);
  console.log(`  processos, em MB (${nome}): ${partes.join(" · ")}`);
}

/** Pede à janela que feche, como o Windows pediria; se não sair, encerra o processo. */
async function fecharPelaJanela(app) {
  if (app.codigo !== null) return;
  try {
    ps("fechar", { IdProcesso: app.processo.pid });
    await esperar("o app fechar", 8000, () => app.codigo !== null);
  } catch {
    app.processo.kill();
    await dormir(500);
  }
}

/** Abre o app como na vida real, sem a porta de depuração, e espera ele assentar. */
async function abrirPraMedir(pasta) {
  const app = await abrirApp(pasta, { depuracao: false });
  try {
    await esperar("a janela", 30000, () => app.codigo === null && ps("estilos", { IdProcesso: app.processo.pid }).ok);
  } catch (erro) {
    await fecharPelaJanela(app);
    throw new Error(`a janela do guia não apareceu (${erro.message})`);
  }
  await dormir(ASSENTAR_MS);
  return app;
}

/**
 * Entrar numa zona faz o relógio contar: é o estado normal durante a corrida. A zona é a
 * Costa, que tem 7 layouts: uma zona mostra no máximo 8 de uma vez.
 */
function fazerORelogioContar(pasta) {
  const antes = Date.now();
  acrescentar(join(pasta, "Client.txt"), [linhaZona("1_1_2", 2), linhaEntrou("The Coast")]);
  return esperar("o relógio", 10000, () => {
    const salvo = lerJson(join(pasta, "dados", "progresso.json"));
    return salvo?.salvo_em >= antes && typeof salvo.sessao?.timer?.desde === "number";
  }).catch(() => false);
}

/**
 * Abre o app com a porta de depuração só pra conferir que, com o painel de layout aberto, as
 * imagens estão mesmo na tela e o painel acompanha a troca de zona. Devolve o que está na
 * tela na Costa. A medição é feita depois, sem a porta.
 */
async function imagensDeLayoutNaTela(pasta) {
  const app = await abrirApp(pasta);
  let pagina = null;
  try {
    pagina = await Pagina.abrir(app.porta, 30000, () => app.codigo);
    const naTela = (zona) => () =>
      pagina.avaliar(`(() => {
        const titulo = document.querySelector("section.layout .titulo")?.innerText.trim() ?? "";
        const imagens = [...document.querySelectorAll("section.layout img")];
        if (imagens.length === 0 || !titulo.includes(${JSON.stringify(zona)})) return null;
        if (!imagens.every((imagem) => imagem.complete && imagem.naturalWidth > 0)) return null;
        const pontos = imagens.reduce((total, imagem) => total + imagem.naturalWidth * imagem.naturalHeight, 0);
        return { quantas: imagens.length, megapixels: pontos / 1e6, titulo };
      })()`);
    const falhou = (motivo) => () => {
      throw new Error(motivo);
    };
    await esperar("as imagens de layout", 15000, naTela("The Coast")).catch(
      falhou("as imagens de layout não apareceram na tela"),
    );
    // O painel acompanha a zona: é o que o passeio da medição usa.
    acrescentar(join(pasta, "Client.txt"), [linhaZona("1_1_3", 3), linhaEntrou("The Mud Flats")]);
    await esperar("o painel acompanhar a zona", 8000, naTela("The Mud Flats")).catch(
      falhou("o painel de layout não acompanhou a troca de zona"),
    );
    // De volta à Costa, com o relógio contando: é como a medição começa.
    await fazerORelogioContar(pasta);
    await dormir(1500);
    return await esperar("as imagens de layout", 5000, naTela("The Coast")).catch(
      falhou("as imagens de layout sumiram da tela"),
    );
  } finally {
    pagina?.fechar();
    await fecharPelaJanela(app);
  }
}

/**
 * Mede o consumo com o guia na tela, abrindo o app como na vida real (sem a porta de
 * depuração) e com a build que o teste importou. São quatro situações: o relógio parado, o
 * relógio contando, o relógio contando com as imagens de layout abertas e, ainda com elas
 * abertas, depois de passar por todas as zonas que têm imagens.
 */
async function medirConsumo(pasta) {
  console.log(`\nConsumo (${MEDIR} s por medição, com o guia na tela)`);
  const dados = join(pasta, "dados");
  if (!lerJson(join(dados, "plano.json"))) {
    console.log("  (sem build importada: medição pulada)");
    return;
  }

  let parado;
  let contando;
  let app = await abrirPraMedir(pasta);
  try {
    parado = await medirTrecho(app.processo.pid, MEDIR);
    mostrarTrecho(PARADO, parado);
    const contou = await fazerORelogioContar(pasta);
    if (!contou) console.log("  (o relógio não começou a contar: a medição seguinte também é com ele parado)");
    contando = await medirTrecho(app.processo.pid, MEDIR);
    mostrarTrecho(contou ? CONTANDO : PARADO, contando);
  } finally {
    await fecharPelaJanela(app);
  }

  // O painel de layout fica aberto de uma vez pra outra: basta deixar isso anotado nas
  // preferências antes de abrir o app.
  let comLayout = null;
  let depoisDoPasseio = null;
  let imagens = null;
  const zonas = zonasComLayout();
  try {
    const preferencias = join(dados, "preferencias.json");
    writeFileSync(preferencias, JSON.stringify({ ...lerJson(preferencias), layout_aberto: true }));
    // Se o painel fechasse no meio, o app anotaria isso nas preferências na hora.
    const conferirOPainel = () => {
      if (lerJson(preferencias)?.layout_aberto !== true) throw new Error("o painel de layout fechou no meio");
    };
    imagens = await imagensDeLayoutNaTela(pasta);
    app = await abrirPraMedir(pasta);
    try {
      const contou = await fazerORelogioContar(pasta);
      const trecho = await medirTrecho(app.processo.pid, MEDIR);
      conferirOPainel();
      comLayout = trecho;
      mostrarTrecho(COM_LAYOUT, comLayout);
      if (!contou) console.log("  (nesta o relógio não começou a contar)");

      // Uma campanha inteira, acelerada: todas as zonas que têm imagens, com o painel aberto.
      // É pra ver se a memória cresce conforme as imagens de cada zona passam pela tela.
      const log = join(pasta, "Client.txt");
      for (const zona of zonas) {
        acrescentar(log, [linhaZona(zona.id, zona.nivel), linhaEntrou(zona.nome)]);
        await dormir(PASSEIO_MS);
      }
      const ultima = zonas.at(-1)?.id;
      await esperar("o fim do passeio", 8000, () => lerJson(join(dados, "progresso.json"))?.sessao?.zona_id === ultima).catch(
        () => {
          throw new Error("o guia não acompanhou o passeio pelas zonas até o fim");
        },
      );
      const passeio = await medirTrecho(app.processo.pid, MEDIR);
      conferirOPainel();
      depoisDoPasseio = passeio;
      mostrarTrecho(DEPOIS_DO_PASSEIO, depoisDoPasseio);
    } finally {
      await fecharPelaJanela(app);
    }
  } catch (erro) {
    console.log(`  (a medição com o layout aberto parou no meio: ${erro.message})`);
  }

  if (comLayout && imagens) {
    console.log(
      `  layout aberto = ${imagens.quantas} imagens na tela, ${numero(imagens.megapixels)} megapixels ao todo ` +
        `(${imagens.titulo.replaceAll("\n", " ")})`,
    );
  }
  if (depoisDoPasseio) {
    console.log(
      `  passeio = as ${zonas.length} zonas que têm imagens, uma a cada ${numero(PASSEIO_MS / 1000, 0)} s, com o layout aberto: ` +
        `${numero(depoisDoPasseio.memoria_no_comeco_mb)} MB logo depois e ${numero(depoisDoPasseio.memoria_no_fim_mb)} MB ` +
        `${numero(depoisDoPasseio.segundos, 0)} s mais tarde`,
    );
  }
  mostrarProcessos(CONTANDO, contando);
  if (comLayout) mostrarProcessos("com o layout aberto", comLayout);
  if (depoisDoPasseio) mostrarProcessos("depois do passeio", depoisDoPasseio);
  if (contando.so_do_processo) {
    console.log(`  somando também a memória dividida com outros programas: ${numero(contando.memoria_com_dividida_mb)} MB`);
  } else {
    console.log("  (este Windows não informa a memória só de cada processo: os números acima contam a mais)");
  }
  const veredito = (mb) => (mb < META_DE_MEMORIA_MB ? "dentro da meta" : "ACIMA da meta");
  console.log(
    `  meta de memória: menos de ${META_DE_MEMORIA_MB} MB → ${veredito(Math.max(parado.memoria_mb, contando.memoria_mb))}` +
      (comLayout ? `; com o layout aberto, ${veredito(comLayout.memoria_mb)}` : "") +
      (depoisDoPasseio ? `; depois do passeio, ${veredito(depoisDoPasseio.memoria_mb)}` : ""),
  );
}

// ---------------------------------------------------------------------------
// O teste
// ---------------------------------------------------------------------------

async function principal() {
  if (process.platform !== "win32") {
    console.log("Este teste só roda no Windows.");
    return 0;
  }
  if (!existsSync(EXE)) {
    console.error(`Não achei o app em ${EXE}`);
    console.error("Compile antes: cd src-tauri && cargo build --features tauri/custom-protocol");
    return 2;
  }
  const listar = { encoding: "utf8", windowsHide: true };
  if (ps("jogo").aberto || temOJogo(execFileSync("tasklist", LISTAR_O_JOGO, listar))) {
    console.error("O Path of Exile está aberto. Este teste só roda com o jogo fechado.");
    return 2;
  }
  const abertos = execFileSync("tasklist", ["/FI", "IMAGENAME eq guia-leveling.exe", "/FO", "CSV", "/NH"], listar);
  if (abertos.toLowerCase().includes("guia-leveling.exe")) {
    console.error("O Guia de Leveling já está aberto. Feche antes de rodar o teste.");
    return 2;
  }

  const antes = ps("conflito", { Mods: CTRL, Vk: F2 });

  const pasta = mkdtempSync(join(tmpdir(), "guia-leveling-e2e-"));
  const dados = join(pasta, "dados");
  const log = join(pasta, "Client.txt");
  acrescentar(log, [
    linhaZona("1_1_1", 1),
    linhaEntrou("The Twilight Strand"),
    linhaNivel("HeroiTeste", "Marauder", 2),
  ]);

  // Trava de segurança: aconteça o que acontecer, o app não fica aberto na tela.
  const travaDeSeguranca = setTimeout(() => {
    console.error(`O teste passou de ${TEMPO_MAXIMO_MS / 60000} minutos: fechando o app.`);
    aberto?.processo.kill();
    process.exit(3);
  }, TEMPO_MAXIMO_MS);
  // Se o jogo abrir no meio, o teste para: com o jogo na frente, o app de teste pegaria as
  // teclas de passo e mostraria a corrida de mentira por cima dele.
  const vigiaDoJogo = setInterval(() => {
    execFile("tasklist", LISTAR_O_JOGO, listar, (erro, lista) => {
      if (erro || !temOJogo(lista)) return;
      console.error("O Path of Exile abriu no meio do teste: fechando o app e parando.");
      aberto?.processo.kill();
      process.exit(3);
    });
  }, VIGIAR_O_JOGO_A_CADA_MS);

  let pagina = null;
  let tirouFoto = false;
  try {
    let app = await abrirApp(pasta);
    pagina = await Pagina.abrir(app.porta, 30000, () => app.codigo);
    let t = ferramentas(pagina);
    const estilos = () => ps("estilos", { IdProcesso: app.processo.pid });
    const avisarTecla = (nome, mods, vk) =>
      app.teclas[nome] !== undefined &&
      ps("tecla", { IdProcesso: app.processo.pid, IdTecla: app.teclas[nome], Mods: mods, Vk: vk }).ok;
    const fotografar = () => {
      if (!FOTO || tirouFoto) return;
      tirouFoto = true;
      const foto = ps("foto", { IdProcesso: app.processo.pid, Saida: FOTO });
      console.log(foto.ok ? `         (foto da janela em ${FOTO})` : `         (não deu pra tirar a foto: ${foto.erro})`);
    };

    console.log("\nJanela");
    await conferirEspera("a interface abriu", 20000, async () => (await t.texto()).includes("Guia de Leveling"));
    const fundos = await pagina.avaliar(
      "[getComputedStyle(document.documentElement).backgroundColor, getComputedStyle(document.body).backgroundColor]",
    );
    conferir(
      "o fundo da página é transparente",
      fundos.every((cor) => cor === "rgba(0, 0, 0, 0)"),
      fundos.join(" / "),
    );
    let janela = estilos();
    conferir("a janela existe e está visível", janela.ok, janela.erro ?? `${janela.largura}x${janela.altura} em ${janela.x},${janela.y}`);
    conferir("sem borda nem barra de título", janela.sem_borda);
    conferir("sempre por cima", janela.por_cima);
    conferir("o clique passa (janela marcada como transparente a cliques)", janela.clique_passa && janela.em_camadas);
    conferir("não pega o foco do teclado", janela.nao_pega_foco && !janela.esta_na_frente);
    conferir("o Windows entrega o clique à janela de baixo", !janela.clique_cai_nela);
    const semBuild = await t.texto();
    conferir(
      "sem build, a tela pede pra colar o link",
      semBuild.includes("sem build") && semBuild.includes("Ctrl+F2"),
      semBuild.replaceAll("\n", " | "),
    );

    console.log("\nClient.txt");
    const inicial = await conferirEspera("o app está lendo o Client.txt de teste", 8000, async () => {
      const agora = await t.invocar("iniciar");
      const lendoODeTeste =
        agora.log?.situacao === "lendo" && String(agora.log.caminho).toLowerCase().includes(basename(pasta).toLowerCase());
      return lendoODeTeste ? agora : null;
    });
    conferir(
      "ao abrir, já sabe a zona e o nível que estavam no fim do arquivo",
      inicial?.log?.resumo?.zona?.area_id === "1_1_1" && inicial.log.resumo.niveis?.[0]?.nivel === 2,
      JSON.stringify(inicial?.log?.resumo),
    );
    conferir("a tela não mostra aviso sobre o Client.txt", !(await t.texto()).includes("Client.txt"));

    console.log("\nTeclas");
    conferir("Ctrl+F2 estava livre antes de abrir o app", !antes.registrada);
    conferir("o app registrou Ctrl+F2", ps("conflito", { Mods: CTRL, Vk: F2 }).registrada);
    conferir("F2 sozinha continua livre fora do jogo", !ps("conflito", { Mods: 0, Vk: F2 }).registrada);
    if (SEM_TECLAS) {
      console.log("         (--sem-teclas: as conferências que avisam uma tecla ao app ficam de fora)");
    } else {
      conferir(
        "o app informou o número das teclas",
        app.teclas.interacao !== undefined,
        app.teclas.interacao === undefined ? "é a versão final? Então rode com --sem-teclas" : "",
      );
    }
    const comTeclas = !SEM_TECLAS && app.teclas.interacao !== undefined;

    if (comTeclas) {
      avisarTecla("interacao", CTRL, F2);
      await conferirEspera("Ctrl+F2 liga o modo de edição", 5000, async () => (await t.texto()).includes("Modo de edição"));
      janela = estilos();
      conferir(
        "com Ctrl+F2 a janela passa a aceitar clique e teclado",
        janela.ok && !janela.clique_passa && janela.clique_cai_nela && !janela.nao_pega_foco,
      );
      console.log(`         (o overlay ${janela.esta_na_frente ? "ficou" : "não ficou"} como janela ativa)`);
      avisarTecla("interacao", CTRL, F2);
      await conferirEspera("Ctrl+F2 de novo volta ao modo passivo", 5000, async () => {
        const agora = await t.texto();
        return agora.includes("sem build") && !agora.includes("Modo de edição");
      });
      janela = estilos();
      conferir("de volta ao passivo o clique passa de novo", janela.ok && janela.clique_passa && !janela.clique_cai_nela);
    }

    console.log("\nBuild");
    await t.invocar("definir_edicao", { ligado: true });
    await conferirEspera("o modo de edição abre com a caixa de colar a build", 5000, () => t.existe("textarea.colar"));
    janela = estilos();
    conferir("em edição a janela aceita clique", janela.ok && !janela.clique_passa && janela.clique_cai_nela);
    conferir("em edição a janela aceita teclado", janela.ok && !janela.nao_pega_foco);
    await t.colar(BUILD);
    await conferirEspera("com o código colado, o botão Importar fica liberado", 3000, () => t.clicar("Importar"));
    await conferirEspera("a build de teste é importada", 10000, async () =>
      (await t.parte(".bloco-corpo .certo")).includes("Build importada."),
    );
    const resumoDaBuild = await t.parte(".build-atual");
    conferir("a tela mostra a classe da build", resumoDaBuild.includes("Marauder"), resumoDaBuild.replaceAll("\n", " | "));
    await conferirEspera("o plano fica gravado na pasta de dados", 5000, () =>
      lerJson(join(dados, "plano.json"))?.personagem?.classe === "Marauder",
    );

    // As teclas de passo só valem com o jogo na frente. Sem o jogo, o teste desliga essa
    // opção na tela pra poder conferir o que cada tecla faz.
    await t.abrirBloco("Opções");
    await conferirEspera("a opção das teclas aparece em Opções", 3000, () => t.marcar("só valem com o jogo na frente"));
    await conferirEspera("a opção desligada fica gravada na configuração", 5000, () =>
      lerJson(join(dados, "config.json"))?.atalhos_so_no_jogo === false,
    );

    await t.clicar("Pronto");
    await conferirEspera("o botão Pronto volta ao modo passivo, já com o guia", 5000, async () =>
      !(await t.existe(".painel.editando")) && (await t.existe(".situacao")),
    );
    janela = estilos();
    conferir("fora da edição o clique passa de novo", janela.ok && janela.clique_passa && !janela.clique_cai_nela);
    const posicao = lerJson(join(dados, "config.json"))?.janela;
    conferir(
      "ao sair da edição a posição da janela fica gravada",
      posicao && posicao.largura >= 260 && posicao.altura >= 140,
      JSON.stringify(posicao),
    );
    await conferirEspera("com a opção desligada, F4 passa a ser do app mesmo sem o jogo", 6000, () =>
      ps("conflito", { Mods: 0, Vk: F4 }).registrada,
    );

    console.log("\nCorrida");
    let situacao = await t.situacao();
    conferir(
      "a corrida começa no primeiro passo do ato 1",
      situacao?.ato === "Ato 1" && numeroDoPasso(situacao) === 1,
      JSON.stringify(situacao),
    );
    conferir("a zona veio do que já estava no Client.txt", situacao?.zona === "The Twilight Strand", situacao?.zona);
    conferir("antes da primeira subida de nível, o nível é um chute", situacao?.nivel.startsWith("nv ~"), situacao?.nivel);
    let passoAtual = await t.parte("li.passo.atual");
    conferir("o primeiro passo manda matar o Hillock", passoAtual.includes("Hillock"), passoAtual.replaceAll("\n", " | "));
    conferir("mostra os 2 passos seguintes", (await t.quantos("li.passo.proximo")) === 2);

    acrescentar(log, [linhaZona("1_1_town", 1), linhaEntrou("Lioneye's Watch")]);
    situacao = await conferirEspera("entrar na cidade avança a rota sozinho", 6000, async () => {
      const agora = await t.situacao();
      return agora && numeroDoPasso(agora) > 1 && agora.zona === "Lioneye's Watch" ? agora : null;
    });
    passoAtual = await t.parte("li.passo.atual");
    conferir(
      "o passo da cidade traz a gema da recompensa e quem entrega",
      passoAtual.includes("Tarkleigh") && passoAtual.includes("Ground Slam"),
      passoAtual.replaceAll("\n", " | "),
    );
    conferir("o cronômetro começa a contar na primeira zona", situacao && !situacao.relogio_parado);

    acrescentar(log, [linhaNivel("HeroiTeste", "Marauder", 3)]);
    await conferirEspera("a subida de nível chega à tela", 6000, async () => (await t.situacao())?.nivel === "nv 3");
    acrescentar(log, [linhaMorte("HeroiTeste")]);
    await conferirEspera("a morte chega à tela", 6000, async () => (await t.situacao())?.mortes.includes("1"));
    acrescentar(log, [linhaNivel("HeroiTeste", "Marauder", 4)]);
    await conferirEspera("no nível 4 o guia troca o conjunto de gemas", 6000, async () =>
      (await t.parte("section.conjunto")).includes("Conjunto novo: Level 4 - 12"),
    );

    const antesDaCosta = numeroDoPasso(await t.situacao());
    acrescentar(log, [linhaZona("1_1_2", 2), linhaEntrou("The Coast")]);
    await conferirEspera("entrar na zona seguinte avança de novo", 6000, async () => {
      const agora = await t.situacao();
      return agora && numeroDoPasso(agora) > antesDaCosta && agora.zona === "The Coast";
    });

    if (comTeclas) {
      console.log("\nTeclas da corrida");
      await conferirEspera("o app registrou as seis teclas de jogo", 6000, () =>
        ["esconder", "voltar", "avancar", "layout", "resync", "forma"].every((nome) => app.teclas[nome] !== undefined),
      );
      const passo = numeroDoPasso(await t.situacao());
      avisarTecla("avancar", 0, F4);
      await conferirEspera("F4 avança um passo", 5000, async () => numeroDoPasso(await t.situacao()) === passo + 1);
      avisarTecla("voltar", 0, F3);
      await conferirEspera("F3 volta um passo", 5000, async () => numeroDoPasso(await t.situacao()) === passo);

      avisarTecla("layout", 0, F6);
      await conferirEspera("F6 abre os layouts da zona", 5000, async () =>
        (await t.parte("section.layout .titulo")).includes("The Coast"),
      );
      await conferirEspera("as imagens dos layouts carregam de dentro do app", 8000, () =>
        pagina.avaliar(`(() => {
          const imagens = [...document.querySelectorAll("section.layout img")];
          return imagens.length > 1 && imagens.every((imagem) => imagem.complete && imagem.naturalWidth > 0);
        })()`),
      );
      fotografar();
      avisarTecla("layout", 0, F6);
      await conferirEspera("F6 de novo mostra o primeiro layout em tamanho grande", 5000, async () =>
        (await t.parte("section.layout .titulo")).includes("1 de "),
      );

      acrescentar(log, [linhaZona("1_3_1", 23), linhaEntrou("The City of Sarn")]);
      await conferirEspera("uma zona fora da ordem da rota não muda o passo sozinha", 6000, async () => {
        const agora = await t.situacao();
        return agora?.zona === "The City of Sarn" && agora.ato === "Ato 1";
      });
      avisarTecla("resync", 0, F7);
      await conferirEspera("F7 acha o passo pela zona (pula pro ato 3)", 5000, async () => (await t.situacao())?.ato === "Ato 3");

      avisarTecla("esconder", 0, F2);
      await conferirEspera("F2 esconde o guia", 5000, async () => (await t.texto()).trim() === "");
      janela = estilos();
      conferir("escondido, a janela continua deixando o clique passar", janela.ok && janela.clique_passa);
      avisarTecla("esconder", 0, F2);
      await conferirEspera("F2 de novo mostra o guia", 5000, () => t.existe(".situacao"));
    } else {
      fotografar();
    }

    // Devolve a opção ao padrão: fora do jogo, as teclas de passo voltam a ser dos outros programas.
    const configAgora = (await t.invocar("iniciar")).config;
    await t.invocar("salvar_config", { config: { ...configAgora, atalhos_so_no_jogo: true } });
    await conferirEspera("com a opção ligada de novo, F4 volta a ficar livre fora do jogo", 6000, () =>
      !ps("conflito", { Mods: 0, Vk: F4 }).registrada,
    );

    console.log("\nFechar e abrir de novo");
    const fim = await t.situacao();
    await t.invocar("definir_edicao", { ligado: true });
    await conferirEspera("o modo de edição tem o botão Sair", 5000, () => t.temBotao("Sair"));
    await t.clicar("Sair").catch(() => {});
    await conferirEspera("Sair fecha o app", 10000, () => app.codigo !== null);
    conferir("fechou sem erro", app.codigo === 0, `código ${app.codigo}`);
    pagina.fechar();
    pagina = null;
    const salvo = lerJson(join(dados, "progresso.json"))?.sessao;
    conferir(
      "ao sair, o progresso fica gravado (personagem, nível e mortes)",
      salvo?.personagem === "HeroiTeste" && salvo.nivel === 4 && salvo.mortes === 1,
      JSON.stringify({ personagem: salvo?.personagem, nivel: salvo?.nivel, mortes: salvo?.mortes, passo: salvo?.passo }),
    );

    app = await abrirApp(pasta);
    pagina = await Pagina.abrir(app.porta, 30000, () => app.codigo);
    t = ferramentas(pagina);
    const volta = await conferirEspera("ao abrir de novo, o guia já aparece com a build", 20000, () => t.situacao());
    conferir(
      "volta no mesmo ato e no mesmo passo",
      volta && volta.ato === fim?.ato && volta.passo === fim?.passo,
      `${volta?.ato} ${volta?.passo} (era ${fim?.ato} ${fim?.passo})`,
    );
    conferir("lembra o nível e as mortes", volta?.nivel === "nv 4" && volta.mortes.includes("1"), `${volta?.nivel} ${volta?.mortes}`);
    conferir("o cronômetro volta parado, esperando o jogo", volta?.relogio_parado === true);
    janela = estilos();
    conferir("abre no modo passivo: o clique passa", janela.ok && janela.clique_passa && !janela.clique_cai_nela);

    await pagina.avaliar("void window.__TAURI_INTERNALS__.invoke('fechar')").catch(() => {});
    await conferirEspera("o app fecha quando pedido", 8000, () => app.codigo !== null);
    conferir("fechou sem erro de novo", app.codigo === 0, `código ${app.codigo}`);
    pagina.fechar();
    pagina = null;

    if (MEDIR > 0) {
      try {
        await medirConsumo(pasta);
      } catch (erro) {
        console.log(`  (não deu pra medir o consumo: ${erro.message})`);
      }
    }
  } catch (erro) {
    conferir("o teste chegou ao fim", false, erro.message);
  } finally {
    clearTimeout(travaDeSeguranca);
    clearInterval(vigiaDoJogo);
    pagina?.fechar();
    if (aberto && aberto.codigo === null) {
      aberto.processo.kill();
      await dormir(500);
    }
    for (let tentativa = 0; tentativa < 10; tentativa++) {
      try {
        rmSync(pasta, { recursive: true, force: true });
        break;
      } catch {
        await dormir(300);
      }
    }
  }

  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length} de ${resultados.length} conferências passaram.`);
  if (falhas.length > 0) {
    console.log("Falharam:");
    falhas.forEach((falha) => console.log(`  - ${falha.nome}${falha.detalhe ? `: ${falha.detalhe}` : ""}`));
    const erros = (aberto?.saida ?? "").split(/\r?\n/).filter((linha) => linha && !linha.startsWith("[teclas]"));
    if (erros.length > 0) console.log(`Saída do app:\n  ${erros.slice(-15).join("\n  ")}`);
  }
  return falhas.length === 0 ? 0 : 1;
}

process.exitCode = await principal();
