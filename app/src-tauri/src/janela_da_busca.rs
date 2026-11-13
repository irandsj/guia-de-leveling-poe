//! A janelinha dos botões de busca da loja: fica logo abaixo do campo "Type keywords here..." do
//! Baú ou da janela de compra do vendedor, só enquanto o guia vê um deles aberto (quem diz onde é
//! o laço dos painéis, em `paineis.rs`).
//!
//! É uma janela à parte, transparente, por cima, sem pegar o foco e atravessada pelo clique, como
//! o balão. Com Alt segurado ela aceita clique (`alt.rs`), e o clique chama o mesmo `aplicar_busca`
//! de antes.
//!
//! Ela existe o tempo todo: sem loja aberta fica longe, fora de qualquer monitor. Mostrar uma
//! janela escondida no Windows passa o foco pra ela (e tira do jogo); mover, não.

use std::sync::Mutex;

use serde_json::Value;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::estado::Estado;

pub const ROTULO: &str = "busca";

/// Longe de qualquer monitor (em pontos da tela).
const FORA: (i32, i32) = (-20000, -20000);

/// As buscas da build, como a interface do balão mandou (a janelinha só desenha).
static BUSCAS: Mutex<Vec<Value>> = Mutex::new(Vec::new());

pub fn janela(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(ROTULO)
}

/// Cria a janelinha, longe da tela. Chamado uma vez, na abertura.
pub fn criar(app: &AppHandle) {
    let fora_das_fotos = app.state::<Estado>().config.lock().unwrap().guia_fora_das_fotos;
    let criada = WebviewWindowBuilder::new(app, ROTULO, WebviewUrl::App("index.html".into()))
        .title("Busca da loja")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .focusable(false)
        .visible(true)
        .position(FORA.0 as f64, FORA.1 as f64)
        .inner_size(260.0, 34.0)
        .content_protected(fora_das_fotos)
        .disable_drag_drop_handler()
        .build();
    match criada {
        Ok(janela) => {
            let _ = janela.set_ignore_cursor_events(true);
            // O `.position` acima não vale: o tao (que cria a janela) troca um lugar fora de todos
            // os monitores pelo lugar padrão do Windows, o canto de cima, à esquerda, da tela
            // principal, bem em cima do balão. Mover depois de criada leva pra onde se pede.
            let _ = janela.set_position(PhysicalPosition::new(FORA.0, FORA.1));
        }
        Err(erro) => eprintln!("não consegui criar a janela dos botões de busca: {erro}"),
    }
}

/// A janelinha está onde deve? `esta` é o canto de cima, à esquerda, de verdade (sem janela, não
/// há o que conferir). Escondida, basta estar longe de qualquer monitor.
pub fn no_lugar(esta: Option<(i64, i64)>, quer: Option<(i32, i32)>) -> bool {
    let Some((x, y)) = esta else { return true };
    match quer {
        Some((qx, qy)) => (x - qx as i64).abs() <= 2 && (y - qy as i64).abs() <= 2,
        None => x <= FORA.0 as i64 / 2 && y <= FORA.1 as i64 / 2,
    }
}

/// Põe a janelinha com o canto de cima, à esquerda, em `onde` (pontos da tela), ou longe.
pub fn mover(app: &AppHandle, onde: Option<(i32, i32)>) {
    if let Some(janela) = janela(app) {
        let (x, y) = onde.unwrap_or(FORA);
        let _ = janela.set_position(PhysicalPosition::new(x, y));
    }
}

pub fn tem_buscas() -> bool {
    !BUSCAS.lock().unwrap().is_empty()
}

pub fn buscas() -> Vec<Value> {
    BUSCAS.lock().unwrap().clone()
}

/// Guarda as buscas da build e avisa a janelinha.
pub fn definir_buscas(app: &AppHandle, buscas: Vec<Value>) {
    *BUSCAS.lock().unwrap() = buscas.clone();
    let _ = app.emit_to(ROTULO, "buscas", buscas);
}

/// A janelinha fica do tamanho dos botões (pixels lógicos, medidos pela interface).
pub fn medir(app: &AppHandle, largura: f64, altura: f64) {
    if let Some(janela) = janela(app) {
        let largura = largura.clamp(40.0, 1200.0);
        let altura = altura.clamp(16.0, 300.0);
        let _ = janela.set_size(LogicalSize::new(largura, altura));
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn confere_se_a_janelinha_esta_no_lugar() {
        // Nasceu no canto da tela (o lugar padrão do Windows): não é pra estar ali.
        assert!(!no_lugar(Some((0, 0)), None));
        assert!(no_lugar(Some((-20000, -20000)), None));
        // Com o Baú aberto, vai pra baixo do campo de busca (um ponto de folga).
        assert!(no_lugar(Some((435, 954)), Some((435, 954))));
        assert!(no_lugar(Some((436, 953)), Some((435, 954))));
        assert!(!no_lugar(Some((-20000, -20000)), Some((435, 954))));
        assert!(!no_lugar(Some((0, 0)), Some((435, 954))));
        // Sem a janela, não há o que mover.
        assert!(no_lugar(None, Some((435, 954))));
    }
}
