//! Thread que vigia duas coisas, de leve (4 olhadas por segundo):
//! - qual janela está em primeiro plano, pra mostrar/esconder o overlay e ligar as teclas;
//! - o fim do Client.txt, pra mandar os eventos de zona, nível e morte pra interface.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::thread;
use std::time::{Duration, Instant};

use leitor_log::localizar::{log_mais_recente, log_na_pasta};
use leitor_log::seguidor::CAUDA_PADRAO;
use leitor_log::Seguidor;
use tauri::{AppHandle, Emitter, Manager};

use crate::arvore;
use crate::atalhos;
use crate::estado::{Estado, StatusLog};
use crate::janela;
use crate::jogo;

const INTERVALO: Duration = Duration::from_millis(250);
/// Lê o log a cada 2 voltas (500 ms).
const VOLTAS_POR_LEITURA: u64 = 2;
const ESPERA_PRA_PROCURAR: Duration = Duration::from_secs(5);
/// Quantas leituras seguidas com erro até desistir do arquivo e procurar de novo.
const ERROS_ATE_DESISTIR: u32 = 10;
/// Quantas voltas seguidas fora do jogo até esconder (evita piscar no alt-tab).
const VOLTAS_ATE_ESCONDER: u32 = 2;
/// Com o jogo aberto, as opções dele (tela cheia, idioma) são lidas de novo a cada tantas voltas (10 s):
/// o jogador pode trocar e o aviso some sem precisar abrir o guia de novo.
const VOLTAS_POR_OPCOES: u64 = 40;

/// Variável de ambiente que aponta um Client.txt de teste (usada pelo simulador).
pub const VARIAVEL_CLIENT_TXT: &str = "GUIA_CLIENT_TXT";

pub fn iniciar(app: AppHandle) {
    let resultado = thread::Builder::new()
        .name("vigia".into())
        .spawn(move || laco(app));
    if let Err(erro) = resultado {
        eprintln!("não consegui criar a thread de vigia: {erro}");
    }
}

/// Lê as opções do jogo (só lê o arquivo) e guarda os avisos delas. A interface recebe no próximo
/// `estado` (ou no `iniciar`).
pub fn conferir_opcoes_do_jogo(app: &AppHandle) {
    let Ok(documentos) = app.path().document_dir() else { return };
    let opcoes = jogo::opcoes_do_jogo(&documentos);
    crate::visao::anotar_idioma(opcoes.outro_idioma.is_some());
    let avisos = jogo::avisos_das_opcoes(&opcoes);
    *app.state::<Estado>().avisos_do_jogo.lock().unwrap() = avisos;
}

fn laco(app: AppHandle) {
    let estado = app.state::<Estado>();
    let nossa_janela: jogo::Janela = janela::principal(&app)
        .and_then(|janela| janela.hwnd().ok())
        .map(|hwnd| hwnd.0 as isize)
        .unwrap_or(0);

    let mut seguidor: Option<Seguidor> = None;
    let mut seguindo_manual = false;
    let mut erros_seguidos = 0u32;
    let mut ultima_procura: Option<Instant> = None;
    let mut voltas_fora = 0u32;
    let mut ultimo_retrato = estado.retrato();
    let mut volta = 0u64;

    loop {
        // ---- 1. Quem está em primeiro plano ----
        let do_jogo = jogo::janela_do_jogo();
        let na_frente = jogo::janela_na_frente();
        let jogo_aberto = do_jogo != 0;
        let jogo_em_foco = na_frente != 0 && jogo::classe_da_janela(na_frente) == jogo::CLASSE_DO_JOGO;
        let overlay_em_foco = na_frente != 0 && na_frente == nossa_janela;

        let abriu_agora = jogo_aberto && !estado.jogo_aberto.load(Ordering::SeqCst);
        let ganhou_foco = jogo_em_foco && !estado.jogo_em_foco.load(Ordering::SeqCst);
        estado.jogo_aberto.store(jogo_aberto, Ordering::SeqCst);
        estado.janela_do_jogo.store(do_jogo, Ordering::SeqCst);

        // Na troca de janela o Windows passa um instante sem nenhuma na frente:
        // só conta como "fora do jogo" depois de algumas voltas seguidas.
        if jogo_em_foco || overlay_em_foco {
            voltas_fora = 0;
        } else {
            voltas_fora = voltas_fora.saturating_add(1);
        }
        if voltas_fora == 0 || voltas_fora >= VOLTAS_ATE_ESCONDER {
            estado.jogo_em_foco.store(jogo_em_foco, Ordering::SeqCst);
            estado.overlay_em_foco.store(overlay_em_foco, Ordering::SeqCst);

            let so_no_jogo = estado.config.lock().unwrap().atalhos_so_no_jogo;
            atalhos::ajustar_de_jogo(&app, !so_no_jogo || jogo_em_foco || overlay_em_foco);
        }
        // As setas mexem na etapa da árvore só com ela aberta no jogo (fora disso são do jogo).
        // Olha toda volta, pra devolver as setas logo que a árvore fecha.
        let editando = estado.edicao.load(Ordering::SeqCst);
        atalhos::ajustar_setas(&app, jogo_em_foco && arvore::aberta() && !editando);

        if abriu_agora || (jogo_aberto && volta % VOLTAS_POR_OPCOES == 0) {
            conferir_opcoes_do_jogo(&app);
        }

        if ganhou_foco {
            // O jogo voltou pra frente: garante que o overlay continua por cima dele.
            if let Some(janela) = janela::principal(&app) {
                let _ = janela.set_always_on_top(true);
            }
        }

        let retrato = estado.retrato();
        if retrato != ultimo_retrato {
            let _ = app.emit("estado", retrato.clone());
            ultimo_retrato = retrato;
        }

        // ---- 2. Client.txt ----
        if estado.relocalizar.swap(false, Ordering::SeqCst) {
            seguidor = None;
            ultima_procura = None;
        }

        // O jogo acabou de abrir e pode ser outra instalação (Steam x standalone).
        if abriu_agora && !seguindo_manual {
            if let Some(log) = jogo::pasta_do_jogo_aberto().and_then(|pasta| log_na_pasta(&pasta)) {
                let outro = seguidor
                    .as_ref()
                    .map_or(true, |atual| !mesmo_arquivo(atual.caminho(), &log));
                if outro {
                    seguidor = None;
                    ultima_procura = None;
                }
            }
        }

        if seguidor.is_none() {
            let hora_de_procurar =
                ultima_procura.map_or(true, |quando| quando.elapsed() >= ESPERA_PRA_PROCURAR);
            if hora_de_procurar {
                ultima_procura = Some(Instant::now());
                let manual = estado.config.lock().unwrap().client_txt.clone();
                match localizar(&manual) {
                    Some((caminho, origem)) => match Seguidor::abrir(&caminho, CAUDA_PADRAO) {
                        Ok((novo, resumo)) => {
                            seguindo_manual = origem == "manual";
                            erros_seguidos = 0;
                            seguidor = Some(novo);
                            publicar(
                                &app,
                                StatusLog {
                                    situacao: "lendo".into(),
                                    caminho: Some(caminho.display().to_string()),
                                    origem: Some(origem.into()),
                                    erro: None,
                                    resumo: Some(resumo),
                                },
                            );
                        }
                        Err(erro) => publicar(
                            &app,
                            StatusLog {
                                situacao: "erro".into(),
                                caminho: Some(caminho.display().to_string()),
                                origem: Some(origem.into()),
                                erro: Some(format!("Não consegui abrir o arquivo: {erro}")),
                                resumo: None,
                            },
                        ),
                    },
                    None => publicar(
                        &app,
                        StatusLog {
                            situacao: "procurando".into(),
                            erro: (!manual.trim().is_empty())
                                .then(|| "O caminho escolhido não existe.".to_string()),
                            ..StatusLog::default()
                        },
                    ),
                }
            }
        } else if volta % VOLTAS_POR_LEITURA == 0 {
            let leitura = seguidor.as_mut().map(|s| s.ler_novos());
            match leitura {
                Some(Ok(eventos)) => {
                    erros_seguidos = 0;
                    for evento in eventos {
                        let _ = app.emit("log-evento", evento);
                    }
                }
                Some(Err(_)) => {
                    erros_seguidos += 1;
                    if erros_seguidos >= ERROS_ATE_DESISTIR {
                        seguidor = None;
                        ultima_procura = None;
                    }
                }
                None => {}
            }
        }

        volta = volta.wrapping_add(1);
        thread::sleep(INTERVALO);
    }
}

/// Guarda a situação do log e avisa a interface, só quando mudou.
fn publicar(app: &AppHandle, novo: StatusLog) {
    let estado = app.state::<Estado>();
    {
        let mut atual = estado.log.lock().unwrap();
        if *atual == novo {
            return;
        }
        *atual = novo.clone();
    }
    let _ = app.emit("log-status", novo);
}

/// Onde está o Client.txt, por ordem de confiança.
fn localizar(manual: &str) -> Option<(PathBuf, &'static str)> {
    // 1. Arquivo de teste (simulador).
    if let Ok(caminho) = std::env::var(VARIAVEL_CLIENT_TXT) {
        let caminho = PathBuf::from(caminho);
        if caminho.is_file() {
            return Some((caminho, "manual"));
        }
    }
    // 2. Escolhido à mão na configuração.
    let manual = manual.trim().trim_matches('"');
    if !manual.is_empty() {
        let caminho = PathBuf::from(manual);
        if caminho.is_file() {
            return Some((caminho, "manual"));
        }
        // Também aceita a pasta do jogo ou a pasta logs.
        if let Some(log) = log_na_pasta(&caminho) {
            return Some((log, "manual"));
        }
        if let Some(log) = caminho.parent().and_then(log_na_pasta) {
            if caminho.is_dir() {
                return Some((log, "manual"));
            }
        }
        return None;
    }
    // 3. A pasta do jogo que está aberto agora.
    if let Some(log) = jogo::pasta_do_jogo_aberto().and_then(|pasta| log_na_pasta(&pasta)) {
        return Some((log, "jogo aberto"));
    }
    // 4. Instalações conhecidas: fica com o log gravado por último.
    log_mais_recente(jogo::pastas_instaladas()).map(|log| (log, "instalacao"))
}

fn mesmo_arquivo(a: &Path, b: &Path) -> bool {
    let normal = |caminho: &Path| caminho.to_string_lossy().replace('/', "\\").to_lowercase();
    normal(a) == normal(b)
}
