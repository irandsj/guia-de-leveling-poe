// O modo de edição: importar a build, acertar a corrida à mão e mexer nas opções.
// É a única hora em que a janela recebe cliques.

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { backend, type AcaoDeTecla, type Config, type Inicial, type SituacaoDoGravador, type StatusLog } from "../backend";
import type { EscolhaDeGemas } from "../nucleo/conjuntos";
import { importar } from "../nucleo/importar";
import { SITES_DE_BUILD } from "../nucleo/links";
import { FiltroDaBuild } from "./FiltroDaBuild";
import { VERSAO_DOS_DADOS } from "../nucleo/arvore/dados";
import { ENDERECO_DA_LEGENDA } from "../nucleo/layouts";
import type { Plano } from "../nucleo/plano";
import {
  ESCALA_MAX,
  ESCALA_MIN,
  OPACIDADE_MAX,
  OPACIDADE_MIN,
  BLOCOS_PADRAO,
  SECOES,
  blocosNoPadrao,
  corDoFundo,
  ordemDosBlocos,
  mudarEscala,
  mudarOpacidade,
  type Preferencias,
} from "../nucleo/preferencias";
import type { Recordes } from "../nucleo/recordes";
import type { Rota } from "../nucleo/rota";
import type { Sessao, SituacaoDaSessao } from "../nucleo/sessao";
import { formatarTempo, lerTimer } from "../nucleo/timer";
import { resumoDoPlano } from "../nucleo/vista";

export interface Acoes {
  /** Passa a usar o plano importado. `ok: false` = não deu, com o motivo na mensagem. */
  adotarPlano(plano: Plano): { ok: boolean; mensagem: string };
  /** Tira a build do guia: volta pro começo, pedindo uma build. */
  removerPlano(): void;
  /** O mesmo que apertar a tecla global. */
  tecla(acao: AcaoDeTecla): void;
  irParaAto(ato: number): void;
  /** `null` = voltar pra estimativa pelo passo da rota. */
  nivel(valor: number | null): void;
  /** `null` = seguir o primeiro personagem da classe que subir de nível. */
  personagem(nome: string | null): void;
  pausar(): void;
  zerarTempo(): void;
  novoPersonagem(): void;
  /** Marca ou desmarca uma gema da rota como comprada/pega. */
  marcarGema(chave: string): void;
  /** `null` = automático. */
  fixarConjunto(id: string | null): void;
  prefs(nova: Preferencias): void;
  opcaoDaRota(chave: "liga_nova" | "biblioteca", valor: boolean): void;
  /** Devolve o erro, se a configuração foi recusada. */
  config(parcial: Partial<Config>): Promise<string | null>;
}

function Bloco({ titulo, aberto: inicial = false, children }: { titulo: string; aberto?: boolean; children: ReactNode }) {
  const [aberto, setAberto] = useState(inicial);
  return (
    <section className="bloco">
      <button className="bloco-titulo" aria-expanded={aberto} onClick={() => setAberto(!aberto)}>
        <span aria-hidden="true">{aberto ? "▾" : "▸"}</span> {titulo}
      </button>
      {aberto && <div className="bloco-corpo">{children}</div>}
    </section>
  );
}

function Marca({ ligado, aoMudar, children }: { ligado: boolean; aoMudar: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="marca">
      <input type="checkbox" checked={ligado} onChange={(e) => aoMudar(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

/** Gravador de estudo: liga e desliga as fotos da tela do jogo e mostra a conta. */
function Gravador() {
  const [situacao, setSituacao] = useState<SituacaoDoGravador | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const ligado = situacao?.ligado ?? false;

  useEffect(() => {
    let vivo = true;
    const ver = () =>
      void backend
        .gravador()
        .then((s) => vivo && setSituacao(s))
        .catch(() => {});
    ver();
    const relogio = setInterval(ver, 2000);
    return () => {
      vivo = false;
      clearInterval(relogio);
    };
  }, []);

  const alternar = () => {
    setErro(null);
    backend
      .gravador(!ligado)
      .then(setSituacao)
      .catch((e: unknown) => setErro(String(e)));
  };

  return (
    <div className="campo gravador">
      <button className={ligado ? "perigo" : undefined} onClick={alternar}>
        {ligado ? "■ Parar a gravação" : "● Gravar a tela (estudo)"}
      </button>
      <span className="valor">
        {ligado ? "Gravando: " : situacao && situacao.fotos > 0 ? "Parado. Última: " : "Parado"}
        {situacao && (ligado || situacao.fotos > 0) ? `${situacao.fotos} fotos, ${situacao.megas} MB` : ""}
      </span>
      <div className="dica">
        Uma foto por segundo da janela do jogo, só com ela na frente. Fica em {situacao?.pasta ?? "gravacoes, na pasta de dados do guia"}
      </div>
      {erro && <div className="erro">{erro}</div>}
    </div>
  );
}

function Confirmar({ rotulo, confirmacao, aoConfirmar }: { rotulo: string; confirmacao: string; aoConfirmar: () => void }) {
  const [armado, setArmado] = useState(false);
  if (!armado) return <button onClick={() => setArmado(true)}>{rotulo}</button>;
  return (
    <>
      <button
        className="perigo"
        onClick={() => {
          setArmado(false);
          aoConfirmar();
        }}
      >
        {confirmacao}
      </button>
      <button onClick={() => setArmado(false)}>Cancelar</button>
    </>
  );
}

function Importacao({
  plano,
  rota,
  config,
  acoes,
  aoImportar,
}: {
  plano: Plano | null;
  rota: Rota | null;
  config: Config;
  acoes: Acoes;
  /** A build nova entrou: hora de perguntar pelo filtro. */
  aoImportar: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const [opcoes, setOpcoes] = useState<{ id: string; link: string }[] | null>(null);

  async function rodar(colado: string) {
    if (ocupado || colado.trim() === "") return;
    setOcupado(true);
    setErro(null);
    setFeito(null);
    setOpcoes(null);
    const resultado = await importar(colado, (url) => backend.baixarTexto(url));
    setOcupado(false);
    if (resultado.tipo === "erro") {
      setErro(resultado.mensagem);
      return;
    }
    if (resultado.tipo === "escolher") {
      setOpcoes(resultado.opcoes);
      return;
    }
    const adotado = acoes.adotarPlano(resultado.plano);
    if (!adotado.ok) {
      setErro(adotado.mensagem);
      return;
    }
    setTexto("");
    setFeito(adotado.mensagem);
    aoImportar();
  }

  const avisos = [...(plano?.avisos ?? []), ...(rota?.avisos ?? [])];
  return (
    <>
      {plano && (
        <div className="build-atual">
          <div>
            <strong>{plano.fonte.titulo || "Build importada"}</strong>
            <span className="fraco"> · {plano.fonte.site}</span>
          </div>
          <div className="fraco">{resumoDoPlano(plano)}</div>
          {avisos.map((aviso, i) => (
            <div key={i} className="aviso">
              {aviso}
            </div>
          ))}
        </div>
      )}
      <textarea
        className="colar"
        rows={3}
        spellCheck={false}
        placeholder={`Cole aqui o link (${SITES_DE_BUILD}) ou o código do Path of Building`}
        value={texto}
        disabled={ocupado}
        onChange={(e) => setTexto(e.target.value)}
      />
      <div className="linha-de-botoes">
        <button className="principal" disabled={ocupado || texto.trim() === ""} onClick={() => void rodar(texto)}>
          {ocupado ? "Importando…" : plano ? "Trocar a build" : "Importar"}
        </button>
        {plano && !ocupado && (
          <Confirmar
            rotulo="Remover a build"
            confirmacao="Remover mesmo (zera o passo e o tempo)"
            aoConfirmar={() => {
              setErro(null);
              setFeito(null);
              setOpcoes(null);
              acoes.removerPlano();
            }}
          />
        )}
      </div>
      {opcoes && (
        <div className="escolher">
          <div>Essa página cita mais de uma build. Qual delas?</div>
          <div className="linha-de-botoes">
            {opcoes.map((opcao, i) => (
              <button key={opcao.id} disabled={ocupado} onClick={() => void rodar(opcao.link)}>
                Build {i + 1} <span className="fraco">({opcao.id})</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {erro && <div className="erro">{erro}</div>}
      {feito && (
        <div className="certo">
          {feito}
          {config.atalhos.resync && ` Já está no meio da campanha? ${config.atalhos.resync} acha o passo pela zona.`}
        </div>
      )}
    </>
  );
}

/** Um personagem que apareceu subindo de nível no Client.txt. */
export interface Visto {
  personagem: string;
  classe: string;
  nivel: number;
}

interface PropsDaCorrida {
  plano: Plano;
  rota: Rota;
  sessao: Sessao;
  situacao: SituacaoDaSessao;
  escolha: EscolhaDeGemas;
  vistos: Visto[];
  config: Config;
  painelAberto: boolean;
  recordes: Recordes;
  acoes: Acoes;
}

/**
 * Tempo de cada ato nesta corrida, o recorde e as mortes. O tempo do ato concluído fica verde
 * quando bateu o recorde e vermelho quando não bateu.
 */
function TemposPorAto({ sessao, recordes, atos }: { sessao: Sessao; recordes: Recordes; atos: number[] }) {
  const leitura = lerTimer(sessao.timer, Date.now());
  const linhas = atos.filter((ato) => {
    const chave = String(ato);
    return chave in leitura.por_ato || chave in recordes.atos || chave in sessao.mortes_por_ato;
  });
  if (linhas.length === 0) return null;
  return (
    <table className="tempos">
      <thead>
        <tr>
          <th>Ato</th>
          <th>Agora</th>
          <th>Recorde</th>
          <th title="Mortes nesta corrida">☠</th>
        </tr>
      </thead>
      <tbody>
        {linhas.map((ato) => {
          const chave = String(ato);
          const agora = leitura.por_ato[chave];
          const concluido = sessao.timer.concluidos[chave];
          const recorde = recordes.atos[chave];
          const classe =
            concluido !== undefined && recorde ? (concluido <= recorde.ms ? "no-ritmo" : "atrasado") : undefined;
          return (
            <tr key={ato} className={ato === sessao.timer.ato ? "atual" : undefined}>
              <td>{ato}</td>
              <td className={classe}>{agora !== undefined ? formatarTempo(agora) : "—"}</td>
              <td title={recorde ? `${recorde.mortes} mortes nessa corrida` : undefined}>
                {recorde ? formatarTempo(recorde.ms) : "—"}
              </td>
              <td>{sessao.mortes_por_ato[chave] ?? 0}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Corrida({ plano, rota, sessao, situacao, escolha, vistos, config, painelAberto, recordes, acoes }: PropsDaCorrida) {
  const atos = Object.keys(rota.inicio_do_ato)
    .map(Number)
    .sort((a, b) => a - b);
  const nomes = [...new Set([...(sessao.personagem ? [sessao.personagem] : []), ...vistos.map((v) => v.personagem)])];
  const rodando = sessao.timer.desde !== null;
  return (
    <>
      <div className="campo">
        <span className="rotulo">Passo</span>
        <button onClick={() => acoes.tecla("voltar")}>◀ Voltar</button>
        <button onClick={() => acoes.tecla("avancar")}>Avançar ▶</button>
        <button onClick={() => acoes.tecla("resync")} title="Procura o passo pela zona em que você está">
          Achar pela zona
        </button>
      </div>
      <div className="campo">
        <label className="rotulo" htmlFor="ato">
          Ir pro ato
        </label>
        <select id="ato" value={situacao.ato} onChange={(e) => acoes.irParaAto(Number(e.target.value))}>
          {atos.map((ato) => (
            <option key={ato} value={ato}>
              Ato {ato}
            </option>
          ))}
        </select>
      </div>
      <div className="campo">
        <span className="rotulo">Nível</span>
        <button aria-label="Diminuir o nível" onClick={() => acoes.nivel(situacao.nivel - 1)}>
          −
        </button>
        <span className="valor">
          {situacao.nivel_conhecido ? "" : "~"}
          {situacao.nivel}
        </span>
        <button aria-label="Aumentar o nível" onClick={() => acoes.nivel(situacao.nivel + 1)}>
          +
        </button>
        {situacao.nivel_conhecido && <button onClick={() => acoes.nivel(null)}>Estimar pela rota</button>}
      </div>
      <div className="campo">
        <label className="rotulo" htmlFor="personagem">
          Personagem
        </label>
        <select id="personagem" value={sessao.personagem ?? ""} onChange={(e) => acoes.personagem(e.target.value || null)}>
          <option value="">O primeiro {plano.personagem.classe} que subir de nível</option>
          {nomes.map((nome) => {
            const visto = vistos.find((v) => v.personagem === nome);
            return (
              <option key={nome} value={nome}>
                {nome}
                {visto ? ` (${visto.classe}, nível ${visto.nivel})` : ""}
              </option>
            );
          })}
        </select>
      </div>
      <div className="campo">
        <label className="rotulo" htmlFor="conjunto">
          Conjunto de gemas
        </label>
        <select id="conjunto" value={escolha.automatica ? "" : (escolha.etapa?.id ?? "")} onChange={(e) => acoes.fixarConjunto(e.target.value || null)}>
          <option value="">Automático (pelo nível)</option>
          {plano.gemas.etapas.map((etapa) => (
            <option key={etapa.id} value={etapa.id}>
              {etapa.titulo || "(sem nome)"}
            </option>
          ))}
        </select>
      </div>
      <div className="campo">
        <span className="rotulo">Tempo</span>
        <button onClick={() => acoes.pausar()}>{rodando ? "Pausar" : "Continuar"}</button>
        <Confirmar rotulo="Zerar o tempo" confirmacao="Zerar mesmo" aoConfirmar={() => acoes.zerarTempo()} />
      </div>
      <TemposPorAto sessao={sessao} recordes={recordes} atos={atos} />
      <div className="campo">
        <span className="rotulo">Layout da zona</span>
        <button onClick={() => acoes.tecla("layout")}>
          {painelAberto ? "Próximo / fechar" : "Abrir"}
          {config.atalhos.layout && ` (${config.atalhos.layout})`}
        </button>
      </div>
      <div className="campo">
        <span className="rotulo">Recomeçar</span>
        <Confirmar
          rotulo="Novo personagem"
          confirmacao="Zerar passo, nível, tempo e mortes"
          aoConfirmar={() => acoes.novoPersonagem()}
        />
      </div>
    </>
  );
}

const NOME_DAS_TECLAS: { chave: keyof Config["atalhos"]; nome: string }[] = [
  { chave: "interacao", nome: "Abrir e fechar este modo de edição" },
  { chave: "esconder", nome: "Esconder e mostrar o guia" },
  { chave: "voltar", nome: "Voltar um passo" },
  { chave: "avancar", nome: "Avançar um passo" },
  { chave: "layout", nome: "Layout da zona" },
  { chave: "resync", nome: "Achar o passo pela zona" },
  { chave: "forma", nome: "Trocar o tamanho do balão: bolinha, normal e expandido" },
];

const SITUACAO_DO_LOG: Record<StatusLog["situacao"], string> = {
  "": "começando…",
  procurando: "procurando o arquivo…",
  lendo: "lendo",
  erro: "com erro",
};

function Opcoes({ inicial, config, log, prefs, acoes }: { inicial: Inicial; config: Config; log: StatusLog | null; prefs: Preferencias; acoes: Acoes }) {
  const [caminho, setCaminho] = useState(config.client_txt);
  const [erro, setErro] = useState<string | null>(null);

  async function mudar(parcial: Partial<Config>) {
    setErro(await acoes.config(parcial));
  }

  return (
    <>
      <div className="subtitulo">Rota</div>
      <Marca ligado={prefs.liga_nova} aoMudar={(v) => acoes.opcaoDaRota("liga_nova", v)}>
        Começo de liga (sem itens guardados no baú)
      </Marca>
      <Marca ligado={prefs.biblioteca} aoMudar={(v) => acoes.opcaoDaRota("biblioteca", v)}>
        Fazer a Biblioteca no ato 3 (libera a Siosa, que vende gemas de outras classes)
      </Marca>

      <div className="subtitulo">Mostrar durante o jogo</div>
      {SECOES.map((secao) => (
        <Marca
          key={secao.chave}
          ligado={prefs.mostrar[secao.chave]}
          aoMudar={(v) => acoes.prefs({ ...prefs, mostrar: { ...prefs.mostrar, [secao.chave]: v } })}
        >
          {secao.nome}
        </Marca>
      ))}
      <div className="campo">
        <span className="rotulo">Blocos do balão</span>
        <span className="fraco">{ordemDosBlocos(prefs.blocos)}</span>
        <button
          disabled={blocosNoPadrao(prefs.blocos)}
          title="Volta os blocos pra ordem de fábrica e abre todos"
          onClick={() => acoes.prefs({ ...prefs, blocos: BLOCOS_PADRAO })}
        >
          Restaurar
        </button>
      </div>
      <Marca ligado={prefs.marcar_gemas} aoMudar={(v) => acoes.prefs({ ...prefs, marcar_gemas: v })}>
        Piscar na tela a gema certa (recompensa de quest e loja). Tira fotos da tela do jogo, só na cidade
      </Marca>
      <Marca ligado={prefs.guia_da_arvore} aoMudar={(v) => acoes.prefs({ ...prefs, guia_da_arvore: v })}>
        Desenhar na árvore de passivas do jogo os próximos pontos da build. Tira fotos da tela do jogo, em qualquer
        lugar, enquanto o jogo está na frente
        <span className="fraco ressalva">
          Experimental: ainda não testado dentro do jogo; provado só em 16:9; dados da árvore {VERSAO_DOS_DADOS}
        </span>
      </Marca>
      <Marca ligado={prefs.avisar_filtro} aoMudar={(v) => acoes.prefs({ ...prefs, avisar_filtro: v })}>
        Avisar quando o jogo não está com o filtro de itens que eu criei pra build. Volta a valer sempre que você
        cria um filtro
      </Marca>
      <Gravador />
      <div className="campo">
        <span className="rotulo">Tamanho do texto</span>
        <button aria-label="Diminuir o texto" disabled={prefs.escala <= ESCALA_MIN} onClick={() => acoes.prefs(mudarEscala(prefs, -1))}>
          A−
        </button>
        <span className="valor">{Math.round(prefs.escala * 100)}%</span>
        <button aria-label="Aumentar o texto" disabled={prefs.escala >= ESCALA_MAX} onClick={() => acoes.prefs(mudarEscala(prefs, 1))}>
          A+
        </button>
      </div>
      <div className="campo">
        <span className="rotulo">Fundo do balão</span>
        <button
          aria-label="Fundo mais transparente"
          title="Mais transparente: dá pra ver mais do jogo atrás do guia"
          disabled={prefs.opacidade <= OPACIDADE_MIN}
          onClick={() => acoes.prefs(mudarOpacidade(prefs, -1))}
        >
          −
        </button>
        <span className="valor">{Math.round(prefs.opacidade * 100)}%</span>
        <button
          aria-label="Fundo mais escuro"
          title="Mais escuro: o texto fica mais fácil de ler"
          disabled={prefs.opacidade >= OPACIDADE_MAX}
          onClick={() => acoes.prefs(mudarOpacidade(prefs, 1))}
        >
          +
        </button>
        <span className="amostra-fundo" aria-hidden style={{ "--cor": corDoFundo(prefs.opacidade) } as CSSProperties}>
          Aa
        </span>
      </div>
      <div className="campo">
        <span className="rotulo">Balão no jogo</span>
        {(
          [
            ["expandido", "Expandido"],
            ["detalhado", "Detalhado"],
            ["resumido", "Resumido"],
            ["bolinha", "Bolinha"],
          ] as const
        ).map(([forma, nome]) => (
          <button
            key={forma}
            className={prefs.forma === forma ? "escolhido" : undefined}
            aria-pressed={prefs.forma === forma}
            onClick={() => acoes.prefs({ ...prefs, forma })}
          >
            {nome}
          </button>
        ))}
      </div>
      <div className="fraco">
        No jogo, segure Alt e use os botões no canto do guia: + mostra mais (o expandido põe embaixo os links em
        soquetes e as fotos dos itens), − mostra menos e • vira bolinha. Arraste pela linha de cima pra mudar o guia
        de lugar. A bolinha abre com Alt e clique, na forma em que estava.
        {config.atalhos.forma && ` ${config.atalhos.forma} passa por bolinha, normal e expandido.`} O fundo vale fora
        deste modo de edição.
      </div>

      <div className="subtitulo">Janela e teclas</div>
      <Marca ligado={config.esconder_fora_do_jogo} aoMudar={(v) => void mudar({ esconder_fora_do_jogo: v })}>
        Esconder o guia quando o jogo não está na frente
      </Marca>
      <Marca ligado={config.atalhos_so_no_jogo} aoMudar={(v) => void mudar({ atalhos_so_no_jogo: v })}>
        As teclas de passo só valem com o jogo na frente
      </Marca>
      <Marca ligado={config.segurar_alt_pra_clicar} aoMudar={(v) => void mudar({ segurar_alt_pra_clicar: v })}>
        Segurar Alt deixa clicar no guia (marcar as gemas, trocar o tamanho e arrastar)
      </Marca>
      <Marca ligado={config.guia_fora_das_fotos} aoMudar={(v) => void mudar({ guia_fora_das_fotos: v })}>
        Guia fora das fotos da tela (a leitura de tela vê a gema ou a árvore embaixo do balão; prints e gravações
        também não mostram o guia)
      </Marca>
      <Marca ligado={config.bolinha_com_painel} aoMudar={(v) => void mudar({ bolinha_com_painel: v })}>
        Virar bolinha quando um painel da esquerda do jogo (Mundo, Baú…) abre por baixo do balão, e voltar quando
        ele fecha
      </Marca>
      <ul className="teclas">
        {NOME_DAS_TECLAS.map((tecla) => (
          <li key={tecla.chave}>
            <kbd>{config.atalhos[tecla.chave] || "sem tecla"}</kbd> {tecla.nome}
          </li>
        ))}
      </ul>
      <div className="fraco">
        Pra trocar as teclas, saia do guia e edite o arquivo config.json em <span className="selecionavel">{inicial.pasta_dados}</span>.
        Use teclas F ou combinações com Ctrl ou Alt, nunca uma tecla que o jogo usa.
      </div>

      <div className="subtitulo">Client.txt</div>
      <div className="fraco">
        Situação: {SITUACAO_DO_LOG[log?.situacao ?? ""]}
        {log?.caminho && (
          <>
            {" · "}
            <span className="selecionavel">{log.caminho}</span>
          </>
        )}
        {log?.erro && <span className="erro"> · {log.erro}</span>}
      </div>
      <input
        className="caminho"
        type="text"
        spellCheck={false}
        aria-label="Caminho do Client.txt"
        placeholder="Vazio = achar sozinho (Steam ou instalação normal)"
        value={caminho}
        onChange={(e) => setCaminho(e.target.value)}
      />
      <div className="linha-de-botoes">
        <button disabled={caminho.trim() === config.client_txt.trim()} onClick={() => void mudar({ client_txt: caminho })}>
          Usar este caminho
        </button>
        {config.client_txt !== "" && (
          <button
            onClick={() => {
              setCaminho("");
              void mudar({ client_txt: "" });
            }}
          >
            Achar sozinho
          </button>
        )}
      </div>
      {erro && <div className="erro">{erro}</div>}
    </>
  );
}

const LIMITE_DAS_NOTAS = 8000;

export interface PropsDaEdicao {
  inicial: Inicial;
  config: Config;
  log: StatusLog | null;
  plano: Plano | null;
  rota: Rota | null;
  sessao: Sessao;
  situacao: SituacaoDaSessao | null;
  escolha: EscolhaDeGemas | null;
  vistos: Visto[];
  prefs: Preferencias;
  painelAberto: boolean;
  recordes: Recordes;
  acoes: Acoes;
}

export function Edicao(props: PropsDaEdicao) {
  const { plano, rota, situacao, escolha, acoes } = props;
  const notas = plano ? plano.notas.leveling || plano.notas.completas : "";
  // Cada build importada aqui ganha a pergunta do filtro (a chave remonta o passo a passo).
  const [importadas, setImportadas] = useState(0);
  const [perguntarFiltro, setPerguntarFiltro] = useState(false);
  return (
    <div className="edicao">
      <Bloco titulo="Build" aberto={plano === null}>
        {plano === null && (
          <div className="boas-vindas passo-a-passo">
            <div className="numero-do-passo">Passo 1 de 2 · Sua build</div>
            <div>
              Cole abaixo o link da build ({SITES_DE_BUILD}) ou o código do Path of Building.
            </div>
            <div className="fraco">
              Depois eu olho os itens da build e pergunto se você quer um filtro que destaque eles no chão.
            </div>
          </div>
        )}
        <Importacao
          plano={plano}
          rota={rota}
          config={props.config}
          acoes={acoes}
          aoImportar={() => {
            setImportadas((n) => n + 1);
            setPerguntarFiltro(true);
          }}
        />
        {plano && (
          <FiltroDaBuild
            key={importadas}
            plano={plano}
            perguntar={perguntarFiltro}
            aoResponder={() => setPerguntarFiltro(false)}
            aoTerminar={() => void backend.definirEdicao(false).catch(() => undefined)}
            aoCriar={() => {
              if (!props.prefs.avisar_filtro) acoes.prefs({ ...props.prefs, avisar_filtro: true });
            }}
          />
        )}
      </Bloco>
      {plano && rota && situacao && escolha && (
        <Bloco titulo="Corrida">
          <Corrida
            plano={plano}
            rota={rota}
            sessao={props.sessao}
            situacao={situacao}
            escolha={escolha}
            vistos={props.vistos}
            config={props.config}
            painelAberto={props.painelAberto}
            recordes={props.recordes}
            acoes={acoes}
          />
        </Bloco>
      )}
      <Bloco titulo="Opções">
        <Opcoes inicial={props.inicial} config={props.config} log={props.log} prefs={props.prefs} acoes={acoes} />
      </Bloco>
      {notas.trim() !== "" && (
        <Bloco titulo="Notas da build">
          <pre className="notas selecionavel">
            {notas.length > LIMITE_DAS_NOTAS ? `${notas.slice(0, LIMITE_DAS_NOTAS)}…` : notas}
          </pre>
        </Bloco>
      )}
      {plano && plano.arvore.etapas.length > 0 && (
        <Bloco titulo="Árvores da build (links)">
          <div className="fraco">
            Com a opção ligada (em Opções), o guia desenha os próximos pontos por cima da árvore de passivas do jogo
            (experimental: ainda não testado dentro do jogo).
            Pra ver a árvore inteira, copie o link e abra no navegador, ou veja no Path of Building.
          </div>
          {plano.arvore.etapas.map((etapa) => (
            <div key={etapa.id} className="arvore-link">
              <div>
                {etapa.titulo || "Árvore"} <span className="fraco">· {etapa.nos.length} nós</span>
              </div>
              {etapa.url && (
                <input
                  type="text"
                  readOnly
                  aria-label={`Link da árvore ${etapa.titulo}`}
                  value={etapa.url}
                  onFocus={(e) => e.target.select()}
                />
              )}
            </div>
          ))}
        </Bloco>
      )}
      <Bloco titulo="Legenda dos layouts">
        <img className="legenda" src={ENDERECO_DA_LEGENDA} alt="Legenda dos símbolos das imagens de layout" draggable={false} />
        <div className="fraco">
          Cada zona tem alguns layouts possíveis. A primeira imagem mostra o que se vê na entrada; escolha a que bate e
          veja o caminho.
        </div>
      </Bloco>
      <Bloco titulo="Sobre">
        <div className="fraco">
          Guia de Leveling {props.inicial.versao}. Lê o Client.txt e a posição da janela do jogo e, com as opções de
          leitura de tela ligadas, tira fotos da tela do jogo e desenha por cima numa janela própria. Não lê a
          memória e não injeta nada. Só manda teclas pro jogo quando você segura Alt e clica num botão de busca da
          loja (Ctrl+F, Ctrl+V e Enter, uma vez). Na pasta do jogo, só grava o filtro novo que você pede (com o nome
          da build, como "Witch Leveling.filter"); os seus filtros ficam como estão.
        </div>
        <div className="fraco">
          Rota e dados de gemas: exile-leveling, de HeartofPhos (MIT). Imagens de layout: Exile-UI, de Lailloken (MIT).
          Receitas de vendedor conferidas nas patch notes da 3.30 e no poedb.tw. Uma marcada "(a confirmar)" não foi.
        </div>
        <div className="fraco">
          Dados da árvore de passivas: Grinding Gear Games (skilltree-export). Pontos de passiva por missão: Path of
          Building (MIT).
        </div>
        <div className="fraco">
          Seus dados ficam em <span className="selecionavel">{props.inicial.pasta_dados}</span>.
        </div>
      </Bloco>
    </div>
  );
}
