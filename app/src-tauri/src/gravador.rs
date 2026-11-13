//! Gravador de estudo: ligado, guarda uma foto por segundo da janela do jogo (só com ela na
//! frente) numa pasta do computador. Serve pra estudar depois o que aparece na tela: lista de
//! missões, recompensas, lojas.
//!
//! Só tira foto da tela. Nada é lido da memória do jogo, nada é enviado a ele e as fotos não
//! saem do computador. Começa sempre desligado; quem liga é o usuário, no modo de edição.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;

/// Desliga sozinho depois de tantas fotos (4 horas), pra não encher o disco por esquecimento.
const MAXIMO_DE_FOTOS: u32 = 4 * 60 * 60;

#[derive(Default)]
struct Estado {
    raiz: PathBuf,
    ligado: bool,
    pasta: Option<PathBuf>,
    fotos: u32,
    bytes: u64,
}

static ESTADO: Mutex<Option<Estado>> = Mutex::new(None);

/// O que a interface mostra.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Situacao {
    pub ligado: bool,
    pub fotos: u32,
    pub megas: u32,
    /// Pasta da gravação atual (ou da última).
    pub pasta: Option<String>,
}

fn com_estado<T>(f: impl FnOnce(&mut Estado) -> T) -> T {
    let mut guarda = ESTADO.lock().unwrap_or_else(|e| e.into_inner());
    f(guarda.get_or_insert_with(Estado::default))
}

fn situacao_de(estado: &Estado) -> Situacao {
    Situacao {
        ligado: estado.ligado,
        fotos: estado.fotos,
        megas: (estado.bytes / (1024 * 1024)) as u32,
        pasta: estado.pasta.as_ref().map(|p| p.to_string_lossy().into_owned()),
    }
}

pub fn situacao() -> Situacao {
    com_estado(|e| situacao_de(e))
}

/// Liga (numa pasta nova, com o nome dado) ou desliga.
fn definir(ligado: bool, nome_da_pasta: &str) -> Result<Situacao, String> {
    com_estado(|e| {
        if ligado && !e.ligado {
            let pasta = e.raiz.join(nome_da_pasta);
            std::fs::create_dir_all(&pasta).map_err(|erro| format!("Não deu pra criar {}: {erro}", pasta.display()))?;
            e.pasta = Some(pasta);
            e.fotos = 0;
            e.bytes = 0;
        }
        e.ligado = ligado;
        Ok(situacao_de(e))
    })
}

pub fn ligar(ligado: bool) -> Result<Situacao, String> {
    definir(ligado, &sistema::agora().0)
}

/// Diz onde as gravações ficam e liga a thread (que fica parada enquanto estiver desligado).
pub fn iniciar(raiz: PathBuf) {
    com_estado(|e| e.raiz = raiz);
    #[cfg(windows)]
    {
        let resultado = std::thread::Builder::new().name("gravador".into()).spawn(sistema::laco);
        if let Err(erro) = resultado {
            eprintln!("Gravador: a thread não abriu: {erro}");
        }
    }
}

#[cfg(windows)]
mod sistema {
    use std::thread::sleep;
    use std::time::Duration;

    use windows_sys::Win32::System::SystemInformation::GetLocalTime;

    use super::{com_estado, MAXIMO_DE_FOTOS};
    use crate::casar::Foto;
    use crate::jogo;
    use crate::visao;

    const ENTRE_FOTOS: Duration = Duration::from_millis(1000);
    const QUALIDADE: u8 = 88;

    /// Data e hora daqui: (nome de pasta "2026-11-11_02-30-05", nome de foto "02-30-05-123").
    pub fn agora() -> (String, String) {
        // SAFETY: a função só preenche a estrutura local.
        let t = unsafe {
            let mut t = std::mem::zeroed();
            GetLocalTime(&mut t);
            t
        };
        (
            format!("{:04}-{:02}-{:02}_{:02}-{:02}-{:02}", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond),
            format!("{:02}-{:02}-{:02}-{:03}", t.wHour, t.wMinute, t.wSecond, t.wMilliseconds),
        )
    }

    pub fn laco() {
        let mut foto = Foto { largura: 0, altura: 0, rgb: Vec::new() };
        let mut bruto: Vec<u8> = Vec::new();
        loop {
            sleep(ENTRE_FOTOS);
            let Some(pasta) = com_estado(|e| if e.ligado { e.pasta.clone() } else { None }) else {
                // Desligado: solta a memória das fotos.
                if foto.rgb.capacity() > 0 {
                    foto.rgb = Vec::new();
                    bruto = Vec::new();
                }
                continue;
            };
            let na_frente = jogo::janela_na_frente();
            if na_frente == 0 || jogo::classe_da_janela(na_frente) != jogo::CLASSE_DO_JOGO {
                continue;
            }
            if visao::fotografar(na_frente, &mut foto, &mut bruto, true).is_none() {
                continue;
            }
            let (Ok(largura), Ok(altura)) = (u16::try_from(foto.largura), u16::try_from(foto.altura)) else {
                continue;
            };
            let arquivo = pasta.join(format!("{}.jpg", agora().1));
            let gravou = jpeg_encoder::Encoder::new_file(&arquivo, QUALIDADE)
                .and_then(|codificador| codificador.encode(&foto.rgb, largura, altura, jpeg_encoder::ColorType::Rgb));
            match gravou {
                Ok(()) => {
                    let tamanho = std::fs::metadata(&arquivo).map(|m| m.len()).unwrap_or(0);
                    com_estado(|e| {
                        e.fotos += 1;
                        e.bytes += tamanho;
                        if e.fotos >= MAXIMO_DE_FOTOS {
                            e.ligado = false;
                        }
                    });
                }
                Err(erro) => {
                    // Disco cheio ou pasta apagada: para de gravar em vez de insistir.
                    eprintln!("Gravador: {erro}");
                    com_estado(|e| e.ligado = false);
                }
            }
        }
    }
}

#[cfg(not(windows))]
mod sistema {
    pub fn agora() -> (String, String) {
        ("gravacao".into(), "foto".into())
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn liga_numa_pasta_nova_e_desliga_guardando_a_conta() {
        let raiz = std::env::temp_dir().join(format!("guia-gravador-{}", std::process::id()));
        com_estado(|e| *e = Estado { raiz: raiz.clone(), ..Estado::default() });
        assert_eq!(situacao(), Situacao { ligado: false, fotos: 0, megas: 0, pasta: None });

        let ligado = definir(true, "primeira").unwrap();
        assert!(ligado.ligado);
        assert!(raiz.join("primeira").is_dir());
        com_estado(|e| {
            e.fotos = 3;
            e.bytes = 5 * 1024 * 1024;
        });

        let parado = definir(false, "ignorada").unwrap();
        assert_eq!((parado.ligado, parado.fotos, parado.megas), (false, 3, 5));
        assert!(!raiz.join("ignorada").exists());

        let de_novo = definir(true, "segunda").unwrap();
        assert_eq!((de_novo.fotos, de_novo.megas), (0, 0));
        assert!(de_novo.pasta.unwrap().ends_with("segunda"));
        com_estado(|e| *e = Estado::default());
        let _ = std::fs::remove_dir_all(raiz);
    }
}
