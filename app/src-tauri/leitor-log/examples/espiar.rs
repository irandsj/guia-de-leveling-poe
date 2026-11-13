//! Mostra o que o leitor enxerga num Client.txt de verdade. Só lê o arquivo.
//!
//! ```text
//! cargo run -p leitor-log --example espiar -- "C:\...\Path of Exile\logs\Client.txt"
//! cargo run -p leitor-log --example espiar -- "C:\...\Client.txt" --seguir
//! ```
//!
//! Sem caminho, procura nas pastas de instalação comuns.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use leitor_log::localizar::{log_mais_recente, pastas_comuns};
use leitor_log::seguidor::CAUDA_PADRAO;
use leitor_log::Seguidor;

fn main() {
    let mut caminho: Option<PathBuf> = None;
    let mut seguir = false;
    for argumento in std::env::args().skip(1) {
        if argumento == "--seguir" {
            seguir = true;
        } else {
            caminho = Some(PathBuf::from(argumento));
        }
    }
    let Some(caminho) = caminho.or_else(|| log_mais_recente(pastas_comuns())) else {
        eprintln!("Não achei o Client.txt. Passe o caminho como argumento.");
        std::process::exit(1);
    };

    let inicio = Instant::now();
    let (mut seguidor, resumo) = match Seguidor::abrir(&caminho, CAUDA_PADRAO) {
        Ok(par) => par,
        Err(erro) => {
            eprintln!("Não consegui abrir {}: {erro}", caminho.display());
            std::process::exit(1);
        }
    };
    println!("Arquivo: {}", caminho.display());
    println!(
        "Tamanho lido até: {} bytes (abriu em {:?})",
        seguidor.posicao(),
        inicio.elapsed()
    );
    match &resumo.zona {
        Some(zona) => println!("Última zona: {} (nível {})", zona.area_id, zona.nivel_area),
        None => println!("Última zona: nenhuma na cauda do arquivo"),
    }
    println!("Personagens que subiram de nível na cauda: {}", resumo.niveis.len());
    for nivel in &resumo.niveis {
        println!("  {} ({}) nível {}", nivel.personagem, nivel.classe, nivel.nivel);
    }

    if !seguir {
        return;
    }
    println!("Acompanhando (Ctrl+C pra sair)...");
    loop {
        match seguidor.ler_novos() {
            Ok(eventos) => {
                for evento in eventos {
                    println!("{evento:?}");
                }
            }
            Err(erro) => eprintln!("Erro lendo: {erro}"),
        }
        std::thread::sleep(Duration::from_millis(500));
    }
}
