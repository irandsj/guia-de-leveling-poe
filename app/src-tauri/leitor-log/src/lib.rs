//! Leitor do `Client.txt` do Path of Exile 1.
//!
//! Só lê o arquivo de log que o próprio jogo grava (permitido pela GGG). Nada aqui
//! toca na memória do jogo, na rede ou no teclado.
//!
//! - [`interpretar_linha`]: uma linha do log → [`Evento`] (ou nada).
//! - [`Seguidor`]: acompanha o fim do arquivo e devolve só as linhas novas.
//! - [`localizar`]: acha o arquivo a partir da pasta do jogo.
//!
//! A ideia de seguir o arquivo veio do exile-log-api (MIT, HeartofPhos) e do estudo em
//! `leveling/conhecimento/overlays.md`. O código foi escrito do zero, com três cuidados
//! que o original não tem: começa no fim do arquivo, guarda a última linha incompleta e
//! recomeça se o arquivo encolher.

pub mod linha;
pub mod localizar;
pub mod seguidor;

pub use linha::{interpretar_linha, Evento};
pub use seguidor::{NivelVisto, Resumo, Seguidor, ZonaVista};
