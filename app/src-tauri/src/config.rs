//! Configuração do app (teclas, opções e posição da janela) e gravação segura em disco.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Teclas globais. Texto no formato "Ctrl+F2", "F4", "Alt+KeyQ". Vazio = desligada.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Atalhos {
    /// Liga/desliga a interação (modo de edição). Vale sempre.
    pub interacao: String,
    /// Esconde/mostra o overlay.
    pub esconder: String,
    /// Volta um passo.
    pub voltar: String,
    /// Avança um passo.
    pub avancar: String,
    /// Mostra/esconde o layout da zona.
    pub layout: String,
    /// Procura de novo o passo pela zona atual.
    pub resync: String,
    /// Troca o tamanho do balão: bolinha, meio (detalhado) e expandido.
    pub forma: String,
}

impl Default for Atalhos {
    fn default() -> Self {
        Atalhos {
            interacao: "Ctrl+F2".into(),
            esconder: "F2".into(),
            voltar: "F3".into(),
            avancar: "F4".into(),
            layout: "F6".into(),
            resync: "F7".into(),
            forma: "Ctrl+F3".into(),
        }
    }
}

/// Posição e tamanho da janela, em pixels físicos.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Geometria {
    pub x: i32,
    pub y: i32,
    pub largura: u32,
    pub altura: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Config {
    pub atalhos: Atalhos,
    /// As teclas de passo/layout só ficam registradas com o jogo em primeiro plano.
    pub atalhos_so_no_jogo: bool,
    /// Some quando o jogo está aberto mas outra janela está na frente.
    pub esconder_fora_do_jogo: bool,
    /// Segurar Alt deixa clicar no guia (marcar gemas) sem entrar no modo de edição.
    pub segurar_alt_pra_clicar: bool,
    /// O guia fica fora das fotos da tela: a leitura de tela (gemas e árvore) vê o jogo que está
    /// embaixo do balão. Prints e gravações também não mostram o guia.
    pub guia_fora_das_fotos: bool,
    /// O balão vira bolinha enquanto um painel da esquerda do jogo (Mundo, Baú…) está aberto
    /// por baixo dele, e volta quando o painel fecha.
    pub bolinha_com_painel: bool,
    /// Caminho do Client.txt escolhido à mão. Vazio = procurar sozinho.
    pub client_txt: String,
    pub janela: Option<Geometria>,
    /// Escala do Windows (1.0 = 100%) quando a janela foi guardada: com outra escala (outro monitor,
    /// ou o jogador mudou), o tamanho guardado é convertido. Sem ela (config antiga), vale como está.
    pub escala_da_janela: Option<f64>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            atalhos: Atalhos::default(),
            atalhos_so_no_jogo: true,
            esconder_fora_do_jogo: true,
            segurar_alt_pra_clicar: true,
            guia_fora_das_fotos: true,
            bolinha_com_painel: true,
            client_txt: String::new(),
            janela: None,
            escala_da_janela: None,
        }
    }
}

const ARQUIVO: &str = "config.json";

/// Lê a configuração. Arquivo ausente ou estragado vira a configuração padrão
/// (o estragado é guardado ao lado, pra não perder o que o usuário tinha).
pub fn carregar(pasta: &Path) -> Config {
    let caminho = pasta.join(ARQUIVO);
    let Ok(texto) = fs::read_to_string(&caminho) else {
        return Config::default();
    };
    match serde_json::from_str(&texto) {
        Ok(config) => config,
        Err(_) => {
            let _ = fs::copy(&caminho, pasta.join("config.json.estragado"));
            Config::default()
        }
    }
}

pub fn salvar(pasta: &Path, config: &Config) -> io::Result<()> {
    let texto = serde_json::to_string_pretty(config).map_err(io::Error::other)?;
    gravar_atomico(&pasta.join(ARQUIVO), texto.as_bytes())
}

/// Grava num arquivo temporário e troca de nome, pra nunca deixar um arquivo pela metade.
pub fn gravar_atomico(caminho: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(pasta) = caminho.parent() {
        fs::create_dir_all(pasta)?;
    }
    let mut temporario: PathBuf = caminho.to_path_buf();
    temporario.set_extension("tmp");
    fs::write(&temporario, bytes)?;
    fs::rename(&temporario, caminho)
}

#[cfg(test)]
mod testes {
    use super::*;

    fn pasta_de_teste(nome: &str) -> PathBuf {
        let pasta = std::env::temp_dir().join(format!(
            "guia-leveling-config-{}-{nome}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&pasta);
        fs::create_dir_all(&pasta).unwrap();
        pasta
    }

    #[test]
    fn sem_arquivo_usa_o_padrao() {
        let pasta = pasta_de_teste("padrao");
        assert_eq!(carregar(&pasta), Config::default());
        let _ = fs::remove_dir_all(&pasta);
    }

    #[test]
    fn grava_e_le_de_volta() {
        let pasta = pasta_de_teste("vaivem");
        let mut config = Config::default();
        config.atalhos.avancar = "Alt+F4".into();
        config.client_txt = r"D:\Jogos\PoE\logs\Client.txt".into();
        config.janela = Some(Geometria {
            x: -1900,
            y: 20,
            largura: 420,
            altura: 700,
        });
        salvar(&pasta, &config).unwrap();
        assert_eq!(carregar(&pasta), config);
        let _ = fs::remove_dir_all(&pasta);
    }

    #[test]
    fn arquivo_antigo_sem_campos_novos_ganha_os_padroes() {
        let pasta = pasta_de_teste("parcial");
        fs::write(
            pasta.join(ARQUIVO),
            r#"{ "atalhos": { "esconder": "F9" }, "client_txt": "x" }"#,
        )
        .unwrap();
        let config = carregar(&pasta);
        assert_eq!(config.atalhos.esconder, "F9");
        assert_eq!(config.atalhos.interacao, "Ctrl+F2");
        assert!(config.atalhos_so_no_jogo);
        assert!(config.segurar_alt_pra_clicar);
        assert!(config.guia_fora_das_fotos);
        assert!(config.bolinha_com_painel);
        assert_eq!(config.client_txt, "x");
        let _ = fs::remove_dir_all(&pasta);
    }

    #[test]
    fn arquivo_estragado_vira_padrao_e_fica_guardado() {
        let pasta = pasta_de_teste("estragado");
        fs::write(pasta.join(ARQUIVO), "{ isto não é json").unwrap();
        assert_eq!(carregar(&pasta), Config::default());
        assert!(pasta.join("config.json.estragado").is_file());
        let _ = fs::remove_dir_all(&pasta);
    }
}
