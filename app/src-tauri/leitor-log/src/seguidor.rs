//! Acompanha o fim do Client.txt ("tail -f").
//!
//! O arquivo chega a passar de 1 GB, então nunca é lido inteiro:
//! - ao abrir, lê só a cauda (padrão 256 KB) pra saber a última zona e os últimos níveis;
//! - depois, a cada chamada de [`Seguidor::ler_novos`], lê só o que cresceu;
//! - se o arquivo encolheu (o jogo recriou o log), volta pro começo;
//! - a última linha sem `\n` fica guardada até o resto dela chegar.
//!
//! O arquivo é aberto e fechado a cada leitura, sempre em modo leitura, e o Rust abre com
//! compartilhamento total no Windows: o jogo continua gravando normalmente.

use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::linha::{interpretar_linha, Evento};

/// Tamanho padrão da cauda lida ao abrir.
pub const CAUDA_PADRAO: u64 = 256 * 1024;
/// Uma linha maior que isto é lixo e é descartada.
const LINHA_MAXIMA: usize = 64 * 1024;
/// Lê no máximo isto por chamada, pra não travar se o arquivo crescer muito de uma vez.
const LEITURA_MAXIMA: u64 = 16 * 1024 * 1024;

/// Última zona vista na cauda do arquivo.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ZonaVista {
    pub area_id: String,
    pub nivel_area: u32,
}

/// Último nível visto de um personagem na cauda do arquivo.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NivelVisto {
    pub personagem: String,
    pub classe: String,
    pub nivel: u32,
}

/// O que deu pra saber olhando a cauda do arquivo na hora de abrir.
/// Isto é só "onde o jogador estava": não deve fazer a rota andar sozinha.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Resumo {
    /// Última área gerada.
    pub zona: Option<ZonaVista>,
    /// Um registro por personagem, do mais antigo pro mais recente.
    pub niveis: Vec<NivelVisto>,
}

impl Resumo {
    fn acumular(&mut self, evento: Evento) {
        match evento {
            Evento::Zona {
                area_id,
                nivel_area,
                ..
            } => self.zona = Some(ZonaVista { area_id, nivel_area }),
            Evento::Nivel {
                personagem,
                classe,
                nivel,
            } => {
                self.niveis.retain(|n| n.personagem != personagem);
                self.niveis.push(NivelVisto {
                    personagem,
                    classe,
                    nivel,
                });
            }
            Evento::Entrou { .. } | Evento::Morte { .. } => {}
        }
    }
}

/// Leitor que acompanha o crescimento do arquivo.
#[derive(Debug)]
pub struct Seguidor {
    caminho: PathBuf,
    posicao: u64,
    /// Bytes da última linha ainda sem `\n`.
    resto: Vec<u8>,
}

impl Seguidor {
    /// Abre no fim do arquivo, lendo antes a cauda (até `cauda` bytes) pra montar o resumo.
    pub fn abrir(caminho: impl AsRef<Path>, cauda: u64) -> io::Result<(Self, Resumo)> {
        let caminho = caminho.as_ref().to_path_buf();
        let mut arquivo = File::open(&caminho)?;
        let tamanho = arquivo.metadata()?.len();
        let inicio = tamanho.saturating_sub(cauda);
        arquivo.seek(SeekFrom::Start(inicio))?;

        let mut bytes = Vec::with_capacity((tamanho - inicio) as usize);
        (&mut arquivo).take(tamanho - inicio).read_to_end(&mut bytes)?;
        // O jogo pode ter gravado mais enquanto líamos; a posição é o que foi lido de fato.
        let posicao = inicio + bytes.len() as u64;

        let mut fatia: &[u8] = &bytes;
        if inicio > 0 {
            // A cauda quase sempre começa no meio de uma linha: joga essa primeira fora.
            match fatia.iter().position(|&b| b == b'\n') {
                Some(i) => fatia = &fatia[i + 1..],
                None => fatia = &[],
            }
        }

        let mut resumo = Resumo::default();
        let resto = separar_linhas(fatia, |linha| {
            if let Some(evento) = interpretar_linha(linha) {
                resumo.acumular(evento);
            }
        });

        Ok((
            Seguidor {
                caminho,
                posicao,
                resto,
            },
            resumo,
        ))
    }

    /// Arquivo que está sendo acompanhado.
    pub fn caminho(&self) -> &Path {
        &self.caminho
    }

    /// Até onde o arquivo já foi lido, em bytes.
    pub fn posicao(&self) -> u64 {
        self.posicao
    }

    /// Lê o que foi gravado desde a última chamada e devolve os eventos, na ordem.
    pub fn ler_novos(&mut self) -> io::Result<Vec<Evento>> {
        let tamanho = fs::metadata(&self.caminho)?.len();
        if tamanho < self.posicao {
            // O arquivo encolheu: foi apagado e recriado. Começa de novo do zero.
            self.posicao = 0;
            self.resto.clear();
        }
        if tamanho == self.posicao {
            return Ok(Vec::new());
        }

        let mut arquivo = File::open(&self.caminho)?;
        arquivo.seek(SeekFrom::Start(self.posicao))?;
        let quanto = (tamanho - self.posicao).min(LEITURA_MAXIMA);
        let mut bytes = std::mem::take(&mut self.resto);
        let antes = bytes.len();
        (&mut arquivo).take(quanto).read_to_end(&mut bytes)?;
        self.posicao += (bytes.len() - antes) as u64;

        let mut eventos = Vec::new();
        let mut resto = separar_linhas(&bytes, |linha| {
            if let Some(evento) = interpretar_linha(linha) {
                eventos.push(evento);
            }
        });
        if resto.len() > LINHA_MAXIMA {
            resto.clear();
        }
        self.resto = resto;
        Ok(eventos)
    }
}

/// Chama `cada` pra cada linha completa (terminada em `\n`) e devolve o que sobrou.
fn separar_linhas(bytes: &[u8], mut cada: impl FnMut(&str)) -> Vec<u8> {
    let mut inicio = 0;
    while let Some(i) = bytes[inicio..].iter().position(|&b| b == b'\n') {
        let linha = &bytes[inicio..inicio + i];
        if !linha.is_empty() && linha.len() <= LINHA_MAXIMA {
            // O log é UTF-8; se vier um byte quebrado, troca por "?" em vez de falhar.
            cada(&String::from_utf8_lossy(linha));
        }
        inicio += i + 1;
    }
    bytes[inicio..].to_vec()
}
