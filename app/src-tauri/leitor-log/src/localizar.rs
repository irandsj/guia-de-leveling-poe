//! Acha o Client.txt a partir de pastas candidatas.
//!
//! Aqui só tem a parte que mexe com arquivos. A consulta ao registro do Windows e à
//! janela do jogo fica no app (`src/localizar.rs`), que monta a lista de pastas e chama
//! estas funções.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Nomes possíveis do log dentro de `<pasta do jogo>/logs/`, em ordem de preferência.
///
/// O jogo (3.29) grava `Client.txt` (acumulado) e `LatestClient.txt` (só a sessão atual)
/// ao mesmo tempo. Seguimos o `Client.txt`, que é o que todo overlay usa.
pub const NOMES_DO_LOG: [&str; 3] = ["Client.txt", "LatestClient.txt", "KakaoClient.txt"];

/// Pastas de instalação comuns, pra tentar quando o jogo está fechado e o registro não ajudou.
pub fn pastas_comuns() -> Vec<PathBuf> {
    let mut pastas = Vec::new();
    for raiz in ["C:", "D:", "E:", "F:"] {
        for sufixo in [
            r"\Program Files (x86)\Grinding Gear Games\Path of Exile",
            r"\Program Files\Grinding Gear Games\Path of Exile",
            r"\Grinding Gear Games\Path of Exile",
            r"\Program Files (x86)\Steam\steamapps\common\Path of Exile",
            r"\Program Files\Steam\steamapps\common\Path of Exile",
            r"\Steam\steamapps\common\Path of Exile",
            r"\SteamLibrary\steamapps\common\Path of Exile",
            r"\Program Files\Epic Games\PathOfExile",
            r"\Epic Games\PathOfExile",
        ] {
            pastas.push(PathBuf::from(format!("{raiz}{sufixo}")));
        }
    }
    pastas
}

/// Log dentro de uma pasta do jogo, se existir.
pub fn log_na_pasta(pasta_do_jogo: &Path) -> Option<PathBuf> {
    let logs = pasta_do_jogo.join("logs");
    NOMES_DO_LOG
        .iter()
        .map(|nome| logs.join(nome))
        .find(|caminho| caminho.is_file())
}

/// Entre várias pastas do jogo, devolve o log gravado mais recentemente.
pub fn log_mais_recente<I, P>(pastas: I) -> Option<PathBuf>
where
    I: IntoIterator<Item = P>,
    P: AsRef<Path>,
{
    let mut melhor: Option<(SystemTime, PathBuf)> = None;
    for pasta in pastas {
        let Some(caminho) = log_na_pasta(pasta.as_ref()) else {
            continue;
        };
        let modificado = fs::metadata(&caminho)
            .and_then(|m| m.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        if melhor.as_ref().map_or(true, |(quando, _)| modificado > *quando) {
            melhor = Some((modificado, caminho));
        }
    }
    melhor.map(|(_, caminho)| caminho)
}

/// Bibliotecas da Steam listadas no `libraryfolders.vdf`.
///
/// O arquivo tem linhas como `"path"    "D:\\SteamLibrary"`. Devolve, pra cada uma, a
/// pasta onde o PoE ficaria (`<biblioteca>/steamapps/common/Path of Exile`).
pub fn pastas_do_poe_na_steam(conteudo_vdf: &str) -> Vec<PathBuf> {
    let mut pastas = Vec::new();
    for linha in conteudo_vdf.lines() {
        let mut campos = linha.split('"').skip(1).step_by(2);
        if campos.next() != Some("path") {
            continue;
        }
        let Some(valor) = campos.next() else { continue };
        let biblioteca = valor.replace(r"\\", r"\");
        if biblioteca.is_empty() {
            continue;
        }
        pastas.push(
            PathBuf::from(biblioteca)
                .join("steamapps")
                .join("common")
                .join("Path of Exile"),
        );
    }
    pastas
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn le_as_bibliotecas_da_steam() {
        let vdf = r#"
"libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
		"label"		""
		"apps"
		{
			"238960"		"41234567890"
		}
	}
	"1"
	{
		"path"		"D:\\SteamLibrary"
	}
}
"#;
        assert_eq!(
            pastas_do_poe_na_steam(vdf),
            vec![
                PathBuf::from(r"C:\Program Files (x86)\Steam\steamapps\common\Path of Exile"),
                PathBuf::from(r"D:\SteamLibrary\steamapps\common\Path of Exile"),
            ]
        );
    }

    #[test]
    fn vdf_vazio_ou_estranho_nao_quebra() {
        assert!(pastas_do_poe_na_steam("").is_empty());
        assert!(pastas_do_poe_na_steam("\"path\"").is_empty());
        assert!(pastas_do_poe_na_steam("\"path\" \"\"").is_empty());
    }
}
