//! Arquivos de dados que a interface guarda (o plano importado, o progresso, as
//! preferências e os recordes por ato). Só estes nomes são aceitos, sempre dentro da pasta
//! de dados do app.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::config::gravar_atomico;

const NOMES: &[&str] = &["plano", "progresso", "preferencias", "recordes"];
const LIMITE: usize = 8 * 1024 * 1024;

fn caminho(pasta: &Path, nome: &str) -> Result<PathBuf, String> {
    if !NOMES.contains(&nome) {
        return Err(format!("Nome de arquivo não permitido: {nome}"));
    }
    Ok(pasta.join(format!("{nome}.json")))
}

/// Lê um arquivo de dados. Se ainda não existe, devolve `None`.
pub fn ler(pasta: &Path, nome: &str) -> Result<Option<String>, String> {
    match fs::read_to_string(caminho(pasta, nome)?) {
        Ok(texto) => Ok(Some(texto)),
        Err(erro) if erro.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(erro) => Err(format!("Não consegui ler {nome}.json: {erro}")),
    }
}

pub fn gravar(pasta: &Path, nome: &str, conteudo: &str) -> Result<(), String> {
    if conteudo.len() > LIMITE {
        return Err(format!("{nome}.json ficou grande demais."));
    }
    gravar_atomico(&caminho(pasta, nome)?, conteudo.as_bytes())
        .map_err(|erro| format!("Não consegui gravar {nome}.json: {erro}"))
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn grava_le_e_recusa_nomes_de_fora() {
        let pasta = std::env::temp_dir().join(format!("guia-leveling-dados-{}", std::process::id()));
        let _ = fs::remove_dir_all(&pasta);

        assert_eq!(ler(&pasta, "plano").unwrap(), None);
        gravar(&pasta, "plano", "{\"versao\":1}").unwrap();
        assert_eq!(ler(&pasta, "plano").unwrap().as_deref(), Some("{\"versao\":1}"));
        gravar(&pasta, "plano", "{}").unwrap();
        assert_eq!(ler(&pasta, "plano").unwrap().as_deref(), Some("{}"));
        gravar(&pasta, "recordes", "{\"versao\":1}").unwrap();
        assert_eq!(ler(&pasta, "recordes").unwrap().as_deref(), Some("{\"versao\":1}"));

        for ruim in ["config", "../plano", "plano.json", "C:\\x", ""] {
            assert!(ler(&pasta, ruim).is_err(), "leu {ruim}");
            assert!(gravar(&pasta, ruim, "{}").is_err(), "gravou {ruim}");
        }
        let _ = fs::remove_dir_all(&pasta);
    }
}
