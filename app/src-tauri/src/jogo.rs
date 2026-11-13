//! O pouco que o app pergunta ao Windows sobre o jogo.
//!
//! Tudo aqui é consulta ao sistema, nunca ao processo do jogo:
//! - qual janela está em primeiro plano e qual é a classe dela;
//! - em que pasta está o executável dono da janela do jogo (pra achar o Client.txt);
//! - onde o jogo foi instalado, pelo registro do Windows.
//!
//! Nada lê a memória do jogo, nada é enviado pra ele (nem tecla, nem clique, nem
//! mensagem de janela) e a janela dele nunca é movida nem redimensionada.
//!
//! A única ação é `trazer_pra_frente`, que troca a janela ativa como num alt-tab: o
//! overlay ao entrar no modo de edição e, ao sair, a janela que estava ativa antes.
//! É um pedido ao Windows; se ele recusar, fica como está (nunca forçamos com teclas
//! simuladas).

use std::path::{Path, PathBuf};

/// Classe da janela do Path of Exile 1 (igual na versão da Steam e na standalone).
pub const CLASSE_DO_JOGO: &str = "POEWindowClass";

/// Identificador de janela do Windows, guardado como número (0 = nenhuma).
pub type Janela = isize;

#[cfg(windows)]
mod sistema {
    use super::*;
    use std::ffi::c_void;
    use std::iter::once;

    use windows_sys::Win32::Foundation::{CloseHandle, ERROR_SUCCESS, HWND, RECT};
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        FindWindowW, GetClassNameW, GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId, IsWindow,
        SetForegroundWindow,
    };

    fn largo(texto: &str) -> Vec<u16> {
        texto.encode_utf16().chain(once(0)).collect()
    }

    pub fn janela_do_jogo() -> Janela {
        let classe = largo(CLASSE_DO_JOGO);
        // SAFETY: ponteiro válido pra texto terminado em zero; o título é opcional.
        unsafe { FindWindowW(classe.as_ptr(), std::ptr::null()) as Janela }
    }

    pub fn janela_na_frente() -> Janela {
        // SAFETY: sem argumentos.
        unsafe { GetForegroundWindow() as Janela }
    }

    pub fn classe_da_janela(janela: Janela) -> String {
        if janela == 0 {
            return String::new();
        }
        let mut nome = [0u16; 128];
        // SAFETY: o buffer tem o tamanho informado.
        let n = unsafe { GetClassNameW(janela as HWND, nome.as_mut_ptr(), nome.len() as i32) };
        if n <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&nome[..n as usize])
    }

    /// Caminho do executável dono da janela. Só pede o nome ao Windows
    /// (`PROCESS_QUERY_LIMITED_INFORMATION`, que não dá acesso à memória do processo).
    pub fn executavel_da_janela(janela: Janela) -> Option<PathBuf> {
        if janela == 0 {
            return None;
        }
        let mut pid = 0u32;
        // SAFETY: `pid` é um ponteiro válido.
        unsafe { GetWindowThreadProcessId(janela as HWND, &mut pid) };
        if pid == 0 {
            return None;
        }
        // SAFETY: o handle é fechado logo abaixo.
        let processo = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if processo.is_null() {
            return None;
        }
        let mut caminho = vec![0u16; 1024];
        let mut tamanho = caminho.len() as u32;
        // SAFETY: buffer e tamanho combinam; o handle é válido.
        let ok = unsafe {
            QueryFullProcessImageNameW(processo, 0, caminho.as_mut_ptr(), &mut tamanho)
        };
        // SAFETY: handle aberto acima.
        unsafe { CloseHandle(processo) };
        if ok == 0 || tamanho == 0 {
            return None;
        }
        Some(PathBuf::from(String::from_utf16_lossy(
            &caminho[..tamanho as usize],
        )))
    }

    /// Texto de `HKEY_CURRENT_USER\<chave>\<valor>`.
    pub fn texto_do_registro(chave: &str, valor: &str) -> Option<String> {
        let chave = largo(chave);
        let valor = largo(valor);
        let mut dados = vec![0u16; 1024];
        let mut bytes = (dados.len() * 2) as u32;
        // SAFETY: ponteiros válidos e tamanho em bytes do buffer.
        let erro = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                chave.as_ptr(),
                valor.as_ptr(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                dados.as_mut_ptr() as *mut c_void,
                &mut bytes,
            )
        };
        if erro != ERROR_SUCCESS {
            return None;
        }
        let letras = (bytes as usize / 2).min(dados.len());
        let texto = String::from_utf16_lossy(&dados[..letras]);
        let texto = texto.trim_end_matches('\0').trim();
        (!texto.is_empty()).then(|| texto.to_string())
    }

    /// Pede ao Windows pra tornar uma janela a ativa. Usado ao entrar no modo de edição
    /// (o overlay) e ao sair dele, pra o teclado voltar pra onde estava (o jogo,
    /// normalmente) sem o usuário precisar clicar.
    /// Não envia nada à janela. Devolve `false` se ela não existe mais ou se o Windows
    /// recusou a troca.
    pub fn trazer_pra_frente(janela: Janela) -> bool {
        if janela == 0 {
            return false;
        }
        // SAFETY: se a janela não existir mais, as chamadas só falham.
        unsafe { IsWindow(janela as HWND) != 0 && SetForegroundWindow(janela as HWND) != 0 }
    }

    /// Onde a janela está na tela (esquerda, cima, direita, baixo), em pixels físicos. Só consulta.
    pub fn retangulo_da_janela(janela: Janela) -> Option<(i32, i32, i32, i32)> {
        if janela == 0 {
            return None;
        }
        let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        // SAFETY: `r` é um RECT válido; se a janela não existir mais, a chamada só falha.
        let certo = unsafe { IsWindow(janela as HWND) != 0 && GetWindowRect(janela as HWND, &mut r) != 0 };
        (certo && r.right > r.left && r.bottom > r.top).then_some((r.left, r.top, r.right, r.bottom))
    }
}

#[cfg(not(windows))]
mod sistema {
    use super::*;

    pub fn janela_do_jogo() -> Janela {
        0
    }
    pub fn janela_na_frente() -> Janela {
        0
    }
    pub fn classe_da_janela(_janela: Janela) -> String {
        String::new()
    }
    pub fn executavel_da_janela(_janela: Janela) -> Option<PathBuf> {
        None
    }
    pub fn texto_do_registro(_chave: &str, _valor: &str) -> Option<String> {
        None
    }
    pub fn trazer_pra_frente(_janela: Janela) -> bool {
        false
    }
    pub fn retangulo_da_janela(_janela: Janela) -> Option<(i32, i32, i32, i32)> {
        None
    }
}

pub use sistema::{classe_da_janela, janela_do_jogo, janela_na_frente, retangulo_da_janela, trazer_pra_frente};

/// Pasta de instalação do jogo que está aberto agora, se houver.
pub fn pasta_do_jogo_aberto() -> Option<PathBuf> {
    let executavel = sistema::executavel_da_janela(janela_do_jogo())?;
    executavel.parent().map(Path::to_path_buf)
}

/// Pastas onde o jogo pode estar instalado, segundo o registro, a Steam e a Epic.
pub fn pastas_instaladas() -> Vec<PathBuf> {
    let mut pastas = Vec::new();

    // Versão standalone (launcher da GGG).
    if let Some(pasta) = sistema::texto_do_registro(
        r"Software\GrindingGearGames\Path of Exile",
        "InstallLocation",
    ) {
        pastas.push(PathBuf::from(pasta));
    }

    // Steam: a pasta principal e as bibliotecas extras.
    if let Some(steam) = sistema::texto_do_registro(r"Software\Valve\Steam", "SteamPath") {
        let steam = PathBuf::from(steam.replace('/', "\\"));
        pastas.push(steam.join("steamapps").join("common").join("Path of Exile"));
        for vdf in [
            steam.join("steamapps").join("libraryfolders.vdf"),
            steam.join("config").join("libraryfolders.vdf"),
        ] {
            if let Ok(conteudo) = std::fs::read_to_string(&vdf) {
                pastas.extend(leitor_log::localizar::pastas_do_poe_na_steam(&conteudo));
            }
        }
    }

    // Epic Games: um arquivo .item por jogo instalado, com a pasta dele (em qualquer disco).
    pastas.extend(pastas_da_epic());

    pastas.extend(leitor_log::localizar::pastas_comuns());
    pastas
}

fn pastas_da_epic() -> Vec<PathBuf> {
    let dados = std::env::var_os("ProgramData")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
    let manifestos = dados.join("Epic").join("EpicGamesLauncher").join("Data").join("Manifests");
    let Ok(entradas) = std::fs::read_dir(manifestos) else {
        return Vec::new();
    };
    entradas
        .filter_map(|entrada| entrada.ok().map(|e| e.path()))
        .filter(|caminho| caminho.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("item")))
        .filter_map(|caminho| std::fs::read_to_string(caminho).ok())
        .filter_map(|texto| pasta_do_poe_na_epic(&texto))
        .collect()
}

/// A pasta do Path of Exile (o 1, não o 2) num manifesto da Epic.
fn pasta_do_poe_na_epic(manifesto: &str) -> Option<PathBuf> {
    let valor: serde_json::Value = serde_json::from_str(manifesto).ok()?;
    let nome = valor.get("DisplayName")?.as_str()?.trim();
    if !nome.eq_ignore_ascii_case("Path of Exile") {
        return None;
    }
    let pasta = valor.get("InstallLocation")?.as_str()?.trim();
    (!pasta.is_empty()).then(|| PathBuf::from(pasta))
}

/// O que o arquivo de opções do jogo diz e que atrapalha o guia.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct OpcoesDoJogo {
    /// Tela cheia exclusiva: nenhum overlay aparece por cima do jogo.
    pub tela_cheia_exclusiva: bool,
    /// O idioma do jogo, quando não é o inglês ("pt", "ru"...). O Client.txt sai nesse idioma.
    pub outro_idioma: Option<String>,
}

/// Lê `Documentos\My Games\Path of Exile\production_Config.ini` (arquivo de opções do jogo,
/// texto simples; só lido, nunca gravado). Sem o arquivo, nada a avisar.
pub fn opcoes_do_jogo(documentos: &Path) -> OpcoesDoJogo {
    let caminho = documentos
        .join("My Games")
        .join("Path of Exile")
        .join("production_Config.ini");
    std::fs::read_to_string(caminho)
        .map(|conteudo| ler_opcoes(&conteudo))
        .unwrap_or_default()
}

fn ler_opcoes(conteudo: &str) -> OpcoesDoJogo {
    let mut tela_cheia = false;
    let mut em_janela = false;
    let mut idioma = None;
    let mut secao = String::new();
    for linha in conteudo.lines() {
        let linha = linha.trim_start_matches('\u{feff}').trim();
        if let Some(nome) = linha.strip_prefix('[') {
            secao = nome.trim_end_matches(']').to_ascii_uppercase();
            continue;
        }
        let Some((chave, valor)) = linha.split_once('=') else {
            continue;
        };
        let valor = valor.trim();
        let ligado = valor.eq_ignore_ascii_case("true");
        match chave.trim() {
            "fullscreen" => tela_cheia = ligado,
            "borderless_windowed_fullscreen" => em_janela = ligado,
            "language" if secao.is_empty() || secao == "LANGUAGE" => idioma = Some(valor.to_string()),
            _ => {}
        }
    }
    OpcoesDoJogo {
        tela_cheia_exclusiva: tela_cheia && !em_janela,
        outro_idioma: idioma.filter(|i| !i.is_empty() && !i.eq_ignore_ascii_case("en")),
    }
}

/// Os avisos pro jogador que saem das opções do jogo.
pub fn avisos_das_opcoes(opcoes: &OpcoesDoJogo) -> Vec<String> {
    let mut avisos = Vec::new();
    if opcoes.tela_cheia_exclusiva {
        avisos.push(
            "O jogo está em tela cheia exclusiva, e aí o guia não aparece por cima. Nas opções de vídeo do \
             jogo, troque pra \"Windowed Fullscreen\"."
                .to_string(),
        );
    }
    if let Some(idioma) = &opcoes.outro_idioma {
        avisos.push(format!(
            "O jogo está em outro idioma ({idioma}). O guia lê o jogo em inglês: em outro idioma ele não vê \
             o nível nem as mortes, e a busca da loja não acha as gemas. Pra usar tudo, deixe o jogo em English."
        ));
    }
    avisos
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn acha_o_poe_nos_manifestos_da_epic() {
        let poe = r#"{"DisplayName": "Path of Exile", "InstallLocation": "G:\\Epic Games\\PathOfExile", "AppName": "x"}"#;
        assert_eq!(pasta_do_poe_na_epic(poe), Some(PathBuf::from(r"G:\Epic Games\PathOfExile")));
        // Outro jogo, o PoE 2 e arquivo estragado: nada.
        let outro = r#"{"DisplayName": "Fortnite", "InstallLocation": "C:\\Epic\\Fortnite"}"#;
        assert_eq!(pasta_do_poe_na_epic(outro), None);
        let poe2 = r#"{"DisplayName": "Path of Exile 2", "InstallLocation": "C:\\Epic\\PoE2"}"#;
        assert_eq!(pasta_do_poe_na_epic(poe2), None);
        assert_eq!(pasta_do_poe_na_epic("{ estragado"), None);
    }

    #[test]
    fn tela_cheia_em_janela_nao_avisa() {
        let ini = "[DISPLAY]\nborderless_windowed_fullscreen=true\nfullscreen=false\n";
        assert!(!ler_opcoes(ini).tela_cheia_exclusiva);
    }

    #[test]
    fn janela_comum_nao_avisa() {
        let ini = "[DISPLAY]\nborderless_windowed_fullscreen=false\nfullscreen=false\n";
        assert!(!ler_opcoes(ini).tela_cheia_exclusiva);
    }

    #[test]
    fn tela_cheia_exclusiva_avisa() {
        let ini = "[DISPLAY]\r\nborderless_windowed_fullscreen=false\r\nfullscreen=true\r\n";
        assert!(ler_opcoes(ini).tela_cheia_exclusiva);
        assert_eq!(avisos_das_opcoes(&ler_opcoes(ini)).len(), 1);
    }

    #[test]
    fn arquivo_vazio_nao_avisa() {
        assert_eq!(ler_opcoes(""), OpcoesDoJogo::default());
        assert!(avisos_das_opcoes(&OpcoesDoJogo::default()).is_empty());
    }

    #[test]
    fn jogo_em_ingles_nao_avisa_do_idioma() {
        let ini = "\u{feff}[ACTION_KEYS]\r\n[LANGUAGE]\r\nlanguage=en\r\nchat_language=en\r\n";
        assert_eq!(ler_opcoes(ini).outro_idioma, None);
    }

    #[test]
    fn jogo_em_portugues_avisa() {
        let ini = "[DISPLAY]\nfullscreen=false\n[LANGUAGE]\nlanguage=pt\nchat_language=en\n";
        let opcoes = ler_opcoes(ini);
        assert_eq!(opcoes.outro_idioma.as_deref(), Some("pt"));
        let avisos = avisos_das_opcoes(&opcoes);
        assert_eq!(avisos.len(), 1);
        assert!(avisos[0].contains("(pt)"));
        // O idioma do chat não conta.
        let so_o_chat = "[LANGUAGE]\nlanguage=en\nchat_language=pt\n";
        assert_eq!(ler_opcoes(so_o_chat).outro_idioma, None);
    }
}
