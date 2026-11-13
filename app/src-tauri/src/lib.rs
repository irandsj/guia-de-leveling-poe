//! Guia de Leveling: overlay para o Path of Exile 1.
//!
//! Regras da GGG seguidas à risca (risco de ban se quebrar):
//! - o app é uma janela separada, por cima do jogo em "tela cheia em janela";
//! - do jogo só se lê o Client.txt, a posição/foco da janela dele e uma foto da tela (`visao`),
//!   nunca a memória;
//! - nada é enviado ao jogo (nenhuma tecla, clique, texto ou pacote), com uma exceção pedida pelo
//!   jogador: Alt + clique num botão de busca da loja manda Ctrl+F, Ctrl+V e Enter, uma vez (`busca`);
//! - cada tecla global faz uma ação só, e sempre no nosso overlay;
//! - o filtro de itens da build é um arquivo na pasta do jogo (`filtro`); quem escolhe é o jogador.

mod alt;
mod arvore;
#[cfg(test)]
mod bancada;
mod atalhos;
mod baixar;
mod busca;
mod casar;
mod gravador;
mod config;
mod dados;
mod estado;
mod filtro;
mod fotos;
mod janela;
mod janela_da_busca;
mod jogo;
mod mochila;
mod paineis;
mod vigia;
mod visao;

use std::path::PathBuf;
use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, State};

use config::Config;
use estado::{Estado, EstadoJanela, StatusLog};

/// Variável de ambiente que troca a pasta de dados (usada nos testes, pra não mexer
/// nos dados de verdade do usuário).
const VARIAVEL_PASTA_DADOS: &str = "GUIA_PASTA_DADOS";

/// Tudo o que a interface precisa saber ao abrir.
#[derive(Serialize)]
struct Inicial {
    versao: &'static str,
    config: Config,
    estado: EstadoJanela,
    log: StatusLog,
    pasta_dados: String,
}

#[tauri::command]
fn iniciar(app: AppHandle, estado: State<'_, Estado>) -> Inicial {
    vigia::conferir_opcoes_do_jogo(&app);
    montar_inicial(&estado)
}

fn montar_inicial(estado: &Estado) -> Inicial {
    // Cada cadeado é pego e solto na sua própria linha. Se ficassem dentro do
    // `Inicial { .. }`, o da configuração continuaria preso enquanto `retrato()` tenta
    // pegar o mesmo cadeado, e o comando travaria pra sempre.
    let config = estado.config.lock().unwrap().clone();
    let log = estado.log.lock().unwrap().clone();
    let retrato = estado.retrato();
    Inicial {
        versao: env!("CARGO_PKG_VERSION"),
        config,
        estado: retrato,
        log,
        pasta_dados: estado.pasta_dados.display().to_string(),
    }
}

#[tauri::command]
fn ler_dados(estado: State<'_, Estado>, nome: String) -> Result<Option<String>, String> {
    dados::ler(&estado.pasta_dados, &nome)
}

#[tauri::command]
fn gravar_dados(estado: State<'_, Estado>, nome: String, conteudo: String) -> Result<(), String> {
    dados::gravar(&estado.pasta_dados, &nome, &conteudo)
}

#[tauri::command]
async fn baixar_texto(url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || baixar::baixar(&url))
        .await
        .map_err(|_| "O download foi interrompido.".to_string())?
}

/// Foto de um item da build (`arte` como na tabela `artes-itens.json`), baixada uma vez e guardada.
#[tauri::command]
async fn foto_do_item(estado: State<'_, Estado>, arte: String) -> Result<Option<String>, String> {
    let pasta = estado.pasta_dados.clone();
    tauri::async_runtime::spawn_blocking(move || fotos::foto(&pasta, &arte))
        .await
        .map_err(|_| "O download foi interrompido.".to_string())?
}

#[tauri::command]
fn definir_edicao(app: AppHandle, ligado: bool) {
    janela::definir_edicao(&app, ligado);
}

/// Põe `texto` na caixa de busca do baú/vendedor do jogo (Alt + clique num botão de busca).
#[tauri::command]
async fn aplicar_busca(app: AppHandle, texto: String) -> Result<(), String> {
    busca::conferir(&texto)?;
    let nossa = janela::principal(&app)
        .and_then(|janela| janela.hwnd().ok())
        .map(|hwnd| hwnd.0 as isize)
        .unwrap_or(0);
    tauri::async_runtime::spawn_blocking(move || busca::aplicar(&texto, nossa))
        .await
        .map_err(|_| "A busca foi interrompida.".to_string())?
}

/// As buscas da build pros botões que ficam embaixo do campo de busca do Baú e do vendedor.
#[tauri::command]
fn definir_buscas(app: AppHandle, buscas: Vec<serde_json::Value>) {
    janela_da_busca::definir_buscas(&app, buscas);
}

/// A janelinha dos botões de busca pergunta as buscas quando abre.
#[tauri::command]
fn ler_buscas() -> Vec<serde_json::Value> {
    janela_da_busca::buscas()
}

/// A janelinha dos botões de busca diz o tamanho dos botões (pixels lógicos).
#[tauri::command]
fn medir_busca(app: AppHandle, largura: f64, altura: f64) {
    janela_da_busca::medir(&app, largura, altura);
}

/// A pasta `Documentos` do Windows (segue a do OneDrive, se for o caso).
fn documentos(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().document_dir().map_err(|_| "Não achei a pasta Documentos.".to_string())
}

/// Os filtros de itens que estão na pasta do jogo e qual está escolhido.
#[tauri::command]
fn filtros_do_jogo(app: AppHandle) -> Result<filtro::Filtros, String> {
    Ok(filtro::listar(&documentos(&app)?))
}

/// O filtro que o jogo está usando e os que o guia criou (pra avisar quando o jogo ficou noutro).
#[tauri::command]
fn filtro_no_jogo(app: AppHandle) -> Result<filtro::NoJogo, String> {
    Ok(filtro::no_jogo(&documentos(&app)?))
}

/// Cria na pasta do jogo o filtro `nome` (os destaques da build em cima do filtro `base`).
#[tauri::command]
fn aplicar_filtro(
    app: AppHandle,
    nome: String,
    destaques: String,
    base: Option<String>,
) -> Result<filtro::Gravado, String> {
    filtro::gravar(&documentos(&app)?, &nome, &destaques, base.as_deref())
}

/// Boas-vindas (sem build): a edição abre no centro da tela, na frente.
#[tauri::command]
fn abrir_no_centro(app: AppHandle) {
    janela::abrir_no_centro(&app);
}

#[tauri::command]
fn definir_forma(app: AppHandle, forma: String, altura: Option<f64>) -> Result<(), String> {
    let forma = estado::Forma::do_nome(&forma).ok_or_else(|| format!("forma desconhecida: {forma}"))?;
    janela::definir_forma(&app, forma, altura);
    Ok(())
}

#[tauri::command]
fn alternar_escondido(app: AppHandle) {
    janela::alternar_escondido(&app);
}

/// Grava a configuração nova. Devolve a configuração que ficou valendo.
#[tauri::command]
fn salvar_config(
    app: AppHandle,
    estado: State<'_, Estado>,
    config: Config,
) -> Result<Config, String> {
    let tabela = atalhos::montar(&config.atalhos)?;
    let (nova, mudou_log) = {
        let mut atual = estado.config.lock().unwrap();
        let mudou_log = atual.client_txt.trim() != config.client_txt.trim();
        // A posição da janela é assunto do Rust: a interface não mexe nela.
        let nova = Config {
            janela: atual.janela,
            escala_da_janela: atual.escala_da_janela,
            client_txt: config.client_txt.trim().to_string(),
            ..config
        };
        *atual = nova.clone();
        (nova, mudou_log)
    };
    config::salvar(&estado.pasta_dados, &nova)
        .map_err(|erro| format!("Não consegui gravar a configuração: {erro}"))?;
    atalhos::trocar(&app, tabela);
    janela::aplicar_fotos(&app);
    if mudou_log {
        estado.relocalizar.store(true, Ordering::SeqCst);
    }
    janela::emitir_estado(&app);
    Ok(nova)
}

/// Gemas pra procurar na tela do jogo (lista vazia desliga a leitura de tela).
#[tauri::command]
fn definir_alvos(alvos: Vec<visao::AlvoRecebido>) -> usize {
    visao::definir_alvos(alvos)
}

/// Todas as gemas da rota, pra conferir no inventário (a gema da lista não vira uma parecida).
#[tauri::command]
fn definir_gemas_da_build(gemas: Vec<visao::GemaRecebida>) -> usize {
    visao::definir_gemas_da_build(gemas)
}

/// Posições dos nós da árvore de passivas (o painel manda uma vez por versão).
#[tauri::command]
fn definir_arvore(arvore: arvore::ArvoreRecebida) -> Result<usize, String> {
    arvore::definir_arvore(arvore)
}

/// Guia da árvore: a ordem dos nós da build (sem guia, desliga o desenho por cima do jogo).
#[tauri::command]
fn definir_guia_da_arvore(guia: Option<arvore::GuiaRecebido>) -> usize {
    arvore::definir_guia(guia)
}

/// Gravador de estudo: `ligado` liga ou desliga; sem ele, só conta como está.
#[tauri::command]
fn gravador(ligado: Option<bool>) -> Result<gravador::Situacao, String> {
    match ligado {
        Some(ligado) => gravador::ligar(ligado),
        None => Ok(gravador::situacao()),
    }
}

#[tauri::command]
fn fechar(app: AppHandle) {
    sair(&app);
}

fn sair(app: &AppHandle) {
    if let Some(janela) = janela::principal(app) {
        janela::guardar_geometria(app, &janela);
    }
    app.exit(0);
}

fn pasta_de_dados(app: &AppHandle) -> PathBuf {
    if let Ok(pasta) = std::env::var(VARIAVEL_PASTA_DADOS) {
        if !pasta.trim().is_empty() {
            return PathBuf::from(pasta);
        }
    }
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn criar_bandeja(app: &AppHandle) -> tauri::Result<()> {
    let mostrar = MenuItem::with_id(app, "mostrar", "Mostrar / esconder", true, None::<&str>)?;
    let editar = MenuItem::with_id(app, "editar", "Configurar (modo de edição)", true, None::<&str>)?;
    let recolocar = MenuItem::with_id(app, "recolocar", "Recolocar o guia (sumiu da tela)", true, None::<&str>)?;
    let fechar = MenuItem::with_id(app, "sair", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&mostrar, &editar, &recolocar, &fechar])?;

    let mut bandeja = TrayIconBuilder::with_id("principal")
        .tooltip("Guia de Leveling")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, evento| match evento.id().as_ref() {
            "mostrar" => janela::alternar_escondido(app),
            "editar" => janela::definir_edicao(app, true),
            "recolocar" => janela::recolocar(app),
            "sair" => sair(app),
            _ => {}
        });
    if let Some(icone) = app.default_window_icon() {
        bandeja = bandeja.icon(icone.clone());
    }
    bandeja.build(app)?;
    Ok(())
}

pub fn executar() {
    tauri::Builder::default()
        // Abrir o app de novo só traz o que já está aberto pro modo de edição.
        .plugin(tauri_plugin_single_instance::init(|app, _argumentos, _pasta| {
            janela::definir_edicao(app, true);
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(atalhos::tratar)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            iniciar,
            ler_dados,
            gravar_dados,
            baixar_texto,
            foto_do_item,
            definir_edicao,
            aplicar_busca,
            definir_buscas,
            ler_buscas,
            medir_busca,
            filtros_do_jogo,
            filtro_no_jogo,
            aplicar_filtro,
            abrir_no_centro,
            definir_forma,
            alternar_escondido,
            salvar_config,
            fechar,
            definir_alvos,
            definir_gemas_da_build,
            gravador,
            definir_arvore,
            definir_guia_da_arvore,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let pasta = pasta_de_dados(&handle);
            let pasta_das_gravacoes = pasta.join("gravacoes");
            let mut config = config::carregar(&pasta);
            // Teclas inválidas no arquivo (editado à mão) voltam pro padrão.
            let tabela = match atalhos::montar(&config.atalhos) {
                Ok(tabela) => tabela,
                Err(_) => {
                    config.atalhos = config::Atalhos::default();
                    atalhos::montar(&config.atalhos).unwrap_or_default()
                }
            };
            app.manage(Estado::novo(pasta, config, tabela));

            janela::preparar(&handle);
            janela_da_busca::criar(&handle);
            atalhos::ligar_fixas(&handle);
            if let Err(erro) = criar_bandeja(&handle) {
                eprintln!("não consegui criar o ícone da bandeja: {erro}");
            }
            arvore::iniciar(handle.clone());
            vigia::iniciar(handle.clone());
            paineis::iniciar(handle.clone());
            alt::iniciar(handle.clone());
            visao::iniciar(handle);
            gravador::iniciar(pasta_das_gravacoes);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Guia de Leveling");
}

#[cfg(test)]
mod testes {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    /// O comando de abertura já travou por pegar o mesmo cadeado duas vezes.
    /// O teste roda em outra thread pra falhar em vez de ficar parado.
    #[test]
    fn montar_inicial_nao_trava() {
        let (aviso, espera) = mpsc::channel();
        std::thread::spawn(move || {
            let config = Config::default();
            let tabela = atalhos::montar(&config.atalhos).unwrap();
            let estado = Estado::novo(PathBuf::from("pasta-de-teste"), config, tabela);
            let inicial = montar_inicial(&estado);
            let _ = aviso.send((inicial.estado.visivel, inicial.pasta_dados));
        });
        let (visivel, pasta) = espera
            .recv_timeout(Duration::from_secs(5))
            .expect("montar_inicial travou");
        assert!(visivel, "com o jogo fechado o overlay aparece");
        assert_eq!(pasta, "pasta-de-teste");
    }
}
