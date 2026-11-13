//! Fotos dos itens da build (a arte do jogo, de cdn.poedb.tw).
//!
//! A interface diz qual arte quer ("Armours/Helmets/HelmetDex1", tirada da tabela
//! `artes-itens.json`); aqui a foto é baixada uma vez, guardada na pasta de dados e devolvida
//! como `data:image/webp;base64,...` (a janela não busca nada fora do app sozinha).
//! O pedido leva só o nome da arte e um nome de cliente genérico. A arte é da Grinding Gear Games.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

const SITE: &str = "https://cdn.poedb.tw/image/Art/2DItems/";
/// Uma foto de item tem de 2 a 40 KB. 512 KB sobra muito.
const LIMITE: u64 = 512 * 1024;
const MAXIMO_DA_ARTE: usize = 160;
const PASTA: &str = "fotos-itens";

/// Um download por vez: a tela pede várias fotos juntas e o site não precisa de rajada.
static UM_DE_CADA_VEZ: Mutex<()> = Mutex::new(());

/// A foto da `arte`, pronta pra `<img src>`. `None` quando o site não tem essa foto.
pub fn foto(pasta_dados: &Path, arte: &str) -> Result<Option<String>, String> {
    if !arte_valida(arte) {
        return Err("Nome de foto inválido.".into());
    }
    let arquivo = arquivo_da_arte(pasta_dados, arte);
    if let Some(bytes) = ler_se_boa(&arquivo) {
        return Ok(Some(endereco(&bytes)));
    }
    let _vez = UM_DE_CADA_VEZ.lock().unwrap_or_else(|e| e.into_inner());
    // Outro pedido da mesma foto pode ter baixado enquanto este esperava a vez.
    if let Some(bytes) = ler_se_boa(&arquivo) {
        return Ok(Some(endereco(&bytes)));
    }
    let Some(bytes) = baixar(arte)? else {
        return Ok(None);
    };
    // Guardar é só pra próxima vez: se não der, a foto aparece do mesmo jeito.
    let _ = guardar(&arquivo, &bytes);
    Ok(Some(endereco(&bytes)))
}

/// Pedaços de letras, números, `_` e `-`, separados por `/`. Nada de `..`, `\` ou `:`.
pub fn arte_valida(arte: &str) -> bool {
    !arte.is_empty()
        && arte.len() <= MAXIMO_DA_ARTE
        && arte.split('/').all(|pedaco| {
            !pedaco.is_empty()
                && pedaco
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        })
}

/// `Armours/Helmets/HelmetDex1` → `<dados>/fotos-itens/Armours+Helmets+HelmetDex1.webp`
/// (o `+` não existe nos nomes das artes, então dois nomes nunca caem no mesmo arquivo).
fn arquivo_da_arte(pasta_dados: &Path, arte: &str) -> PathBuf {
    pasta_dados
        .join(PASTA)
        .join(format!("{}.webp", arte.replace('/', "+")))
}

fn e_webp(bytes: &[u8]) -> bool {
    bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP"
}

fn ler_se_boa(arquivo: &Path) -> Option<Vec<u8>> {
    let bytes = fs::read(arquivo).ok()?;
    e_webp(&bytes).then_some(bytes)
}

fn guardar(arquivo: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(pasta) = arquivo.parent() {
        fs::create_dir_all(pasta)?;
    }
    let provisorio = arquivo.with_extension("webp.tmp");
    fs::write(&provisorio, bytes)?;
    fs::rename(&provisorio, arquivo)
}

fn baixar(arte: &str) -> Result<Option<Vec<u8>>, String> {
    let agente = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(8))
        .timeout(Duration::from_secs(20))
        .user_agent(concat!("guia-leveling/", env!("CARGO_PKG_VERSION")))
        .redirects(0)
        .build();
    let resposta = match agente.get(&format!("{SITE}{arte}.webp")).call() {
        Ok(resposta) => resposta,
        Err(ureq::Error::Status(404, _)) => return Ok(None),
        Err(ureq::Error::Status(codigo, _)) => return Err(format!("O site das fotos respondeu {codigo}.")),
        Err(_) => return Err("Não consegui baixar a foto. Confira a internet.".into()),
    };
    if resposta.status() != 200 {
        return Ok(None);
    }
    let mut bytes = Vec::new();
    resposta
        .into_reader()
        .take(LIMITE + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "A conexão caiu no meio da foto.".to_string())?;
    if bytes.len() as u64 > LIMITE || !e_webp(&bytes) {
        return Ok(None);
    }
    Ok(Some(bytes))
}

fn endereco(bytes: &[u8]) -> String {
    format!("data:image/webp;base64,{}", base64(bytes))
}

fn base64(bytes: &[u8]) -> String {
    const LETRAS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut saida = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for bloco in bytes.chunks(3) {
        let n = (bloco[0] as u32) << 16
            | (*bloco.get(1).unwrap_or(&0) as u32) << 8
            | *bloco.get(2).unwrap_or(&0) as u32;
        saida.push(LETRAS[(n >> 18) as usize & 63] as char);
        saida.push(LETRAS[(n >> 12) as usize & 63] as char);
        saida.push(if bloco.len() > 1 { LETRAS[(n >> 6) as usize & 63] as char } else { '=' });
        saida.push(if bloco.len() > 2 { LETRAS[n as usize & 63] as char } else { '=' });
    }
    saida
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn so_aceita_nome_de_arte() {
        for boa in ["Armours/Helmets/HelmetDex1", "Rings/Ring1", "Flasks/lifeflask11", "a-b_c/D9"] {
            assert!(arte_valida(boa), "recusou {boa}");
        }
        for ruim in [
            "",
            "/Rings/Ring1",
            "Rings//Ring1",
            "Rings/Ring1/",
            "../config",
            "Rings/../../x",
            "C:/Windows/x",
            "Rings\\Ring1",
            "Rings/Ring 1",
            "Rings/Ring1.webp",
            "https://exemplo.com/x",
        ] {
            assert!(!arte_valida(ruim), "aceitou {ruim}");
        }
        assert!(!arte_valida(&"a".repeat(MAXIMO_DA_ARTE + 1)));
    }

    #[test]
    fn cada_arte_tem_seu_arquivo() {
        let pasta = Path::new("dados");
        assert_eq!(
            arquivo_da_arte(pasta, "Armours/Helmets/HelmetDex1"),
            pasta.join("fotos-itens").join("Armours+Helmets+HelmetDex1.webp")
        );
        assert_ne!(arquivo_da_arte(pasta, "A/B_C"), arquivo_da_arte(pasta, "A_B/C"));
    }

    #[test]
    fn base64_como_o_padrao() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"M"), "TQ==");
        assert_eq!(base64(b"Ma"), "TWE=");
        assert_eq!(base64(b"Man"), "TWFu");
        assert_eq!(base64(&[0xff, 0xfe, 0xfd, 0x00]), "//79AA==");
    }

    #[test]
    fn usa_a_foto_guardada_e_ignora_lixo() {
        let pasta = std::env::temp_dir().join(format!("guia-fotos-{}", std::process::id()));
        let _ = fs::remove_dir_all(&pasta);
        let arte = "Rings/RingDeTeste";
        let webp = b"RIFF\x10\x00\x00\x00WEBPVP8 qualquer coisa";
        guardar(&arquivo_da_arte(&pasta, arte), webp).unwrap();
        assert_eq!(foto(&pasta, arte).unwrap(), Some(endereco(webp)));
        // Arquivo estragado não vale como foto guardada.
        assert!(ler_se_boa(&arquivo_da_arte(&pasta, "Rings/Lixo")).is_none());
        fs::write(pasta.join(PASTA).join("Rings+Lixo.webp"), b"<html>").unwrap();
        assert!(ler_se_boa(&arquivo_da_arte(&pasta, "Rings/Lixo")).is_none());
        assert!(foto(&pasta, "../fora").is_err());
        let _ = fs::remove_dir_all(&pasta);
    }

    /// Vai na internet: `cargo test baixa_de_verdade -- --ignored`.
    #[test]
    #[ignore]
    fn baixa_de_verdade() {
        let bytes = baixar("Armours/Helmets/HelmetDex1").unwrap().expect("o site não tem a foto");
        assert!(e_webp(&bytes));
        assert_eq!(baixar("Armours/Helmets/NaoExisteEssaArte123").unwrap(), None);
    }
}
