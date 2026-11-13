//! Ajudantes dos testes: ler a árvore do arquivo enxuto.
#![allow(dead_code)]

use arvore_visao::Arvore;

/// Monta a árvore a partir do texto do arquivo enxuto (`nos` e `ligacoes`).
pub fn arvore_de(texto: &str) -> Arvore {
    let o: serde_json::Value = serde_json::from_str(texto).expect("arquivo da árvore");
    let nos = o["nos"].as_array().expect("nos");
    let ids = nos.iter().map(|n| n[0].as_u64().unwrap() as u32).collect();
    let xs = nos.iter().map(|n| n[1].as_f64().unwrap() as f32).collect();
    let ys = nos.iter().map(|n| n[2].as_f64().unwrap() as f32).collect();
    let tipos = nos.iter().map(|n| n[3].as_u64().unwrap() as u8).collect();
    let ligacoes: Vec<u32> =
        o["ligacoes"].as_array().expect("ligacoes").iter().map(|v| v.as_u64().unwrap() as u32).collect();
    Arvore::nova(ids, xs, ys, tipos, &ligacoes).expect("árvore válida")
}

/// A árvore que o app embute.
pub fn arvore_do_app() -> Arvore {
    let caminho = concat!(env!("CARGO_MANIFEST_DIR"), "/../../src/dados/arvore/arvore.json");
    arvore_de(&std::fs::read_to_string(caminho).expect("src/dados/arvore/arvore.json"))
}
