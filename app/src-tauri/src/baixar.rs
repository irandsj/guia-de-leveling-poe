//! Baixa o texto de um link de build (o código do Path of Building).
//!
//! Só HTTPS e só nos sites de build conhecidos. Um pedido por importação, com um nome
//! de cliente genérico e sem nenhum dado do usuário: a única coisa enviada é o
//! endereço que o próprio usuário colou.

use std::io::Read;
use std::time::Duration;

use tauri::Url;

/// Sites de onde aceitamos baixar.
const SITES: &[&str] = &[
    "pobb.in",
    "poe.ninja",
    "maxroll.gg",
    // Os dados do planner do Maxroll (maxroll.gg/poe/planner/<id>).
    "planners.maxroll.gg",
    "pastebin.com",
    "pastebinp.com",
    "api.pob.codes",
    "rentry.co",
    "poedb.tw",
];

/// Um código de PoB tem de 10 a 100 KB. 3 MB sobra muito.
const LIMITE: u64 = 3 * 1024 * 1024;
const MAXIMO_DE_SALTOS: usize = 4;

pub fn baixar(endereco: &str) -> Result<String, String> {
    let mut atual = validar(endereco)?;
    let agente = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(8))
        .timeout(Duration::from_secs(20))
        .user_agent(concat!("guia-leveling/", env!("CARGO_PKG_VERSION")))
        // Os redirecionamentos são seguidos aqui embaixo, um a um, pra conferir o destino.
        .redirects(0)
        .build();

    for _ in 0..=MAXIMO_DE_SALTOS {
        let resposta = match agente.get(atual.as_str()).call() {
            Ok(resposta) => resposta,
            Err(ureq::Error::Status(codigo, _)) => {
                return Err(match codigo {
                    404 => "O site não achou essa build (erro 404). Confira o link.".to_string(),
                    403 | 429 => format!(
                        "O site recusou o pedido (erro {codigo}). Cole o código do PoB no lugar do link."
                    ),
                    _ => format!("O site respondeu com o erro {codigo}."),
                });
            }
            Err(_) => {
                return Err(format!(
                    "Não consegui conectar em {}. Confira a internet.",
                    atual.host_str().unwrap_or("?")
                ));
            }
        };

        let codigo = resposta.status();
        if (300..400).contains(&codigo) {
            let destino = resposta
                .header("location")
                .ok_or("O site redirecionou sem dizer pra onde.")?;
            let destino = atual
                .join(destino)
                .map_err(|_| "O site redirecionou pra um endereço inválido.".to_string())?;
            atual = validar(destino.as_str())?;
            continue;
        }

        let mut bytes = Vec::new();
        resposta
            .into_reader()
            .take(LIMITE + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "A conexão caiu no meio do download.".to_string())?;
        if bytes.len() as u64 > LIMITE {
            return Err("A resposta do site é grande demais pra ser um código de build.".into());
        }
        return Ok(String::from_utf8_lossy(&bytes).into_owned());
    }
    Err("O site redirecionou vezes demais.".into())
}

/// Confere se o endereço é HTTPS, de um site conhecido e sem truques.
pub fn validar(endereco: &str) -> Result<Url, String> {
    let url = Url::parse(endereco.trim()).map_err(|_| "Endereço inválido.".to_string())?;
    if url.scheme() != "https" {
        return Err("Só aceito endereços https://.".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Endereço inválido.".into());
    }
    if url.port().is_some() {
        return Err("Endereço inválido.".into());
    }
    let site = url.host_str().unwrap_or("").to_ascii_lowercase();
    let site = site.strip_prefix("www.").unwrap_or(&site);
    if !SITES.contains(&site) {
        return Err(format!(
            "Não conheço o site \"{site}\". Cole o código do PoB no lugar do link."
        ));
    }
    Ok(url)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn aceita_os_sites_de_build() {
        for bom in [
            "https://pobb.in/pob/nvw1iAVOzEKz",
            "https://poe.ninja/poe1/pob/raw/73995",
            "https://maxroll.gg/poe/api/pob/tcjqpe0t",
            "https://www.maxroll.gg/poe/api/pob/tcjqpe0t",
            "https://planners.maxroll.gg/profiles/load/poe/hhea800t",
            "https://pastebin.com/raw/abc123",
            "  https://api.pob.codes/abc/raw  ",
        ] {
            assert!(validar(bom).is_ok(), "recusou {bom}");
        }
    }

    #[test]
    fn recusa_o_resto() {
        for ruim in [
            "http://pobb.in/pob/abc",
            "http://planners.maxroll.gg/profiles/load/poe/hhea800t",
            "https://pobb.in.exemplo.com/pob/abc",
            "https://exemplo.com/pobb.in/abc",
            "https://usuario:senha@pobb.in/pob/abc",
            "https://pobb.in:8443/pob/abc",
            "https://127.0.0.1/pob/abc",
            "https://localhost/pob/abc",
            "file:///C:/Windows/win.ini",
            "pobb.in/pob/abc",
            "",
        ] {
            assert!(validar(ruim).is_err(), "aceitou {ruim}");
        }
    }
}
