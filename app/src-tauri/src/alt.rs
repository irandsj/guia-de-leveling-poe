//! Segurar Alt deixa clicar no guia sem entrar no modo de edição (pra marcar uma gema
//! como comprada, por exemplo).
//!
//! Só pergunta ao Windows se a tecla está apertada agora (`GetAsyncKeyState`). Não instala
//! gancho de teclado, não segura nem engole a tecla (o jogo continua recebendo o Alt e
//! mostrando o nome dos itens no chão) e não envia nada ao jogo.
//!
//! Com Alt apertado a janela deixa de ser atravessada pelo clique, mas continua sem pegar
//! o foco (`focusable` desligado). Ao soltar, volta a ser atravessada. Se mesmo assim o
//! Windows tiver passado o teclado pro guia, ele volta pro jogo (só troca a janela ativa).

use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::estado::Estado;
use crate::janela;
use crate::janela_da_busca;
use crate::jogo;

/// 25 olhadas por segundo: o clique já vale logo depois de apertar.
const INTERVALO: Duration = Duration::from_millis(40);

pub fn iniciar(app: AppHandle) {
    let resultado = thread::Builder::new()
        .name("alt".into())
        .spawn(move || laco(app));
    if let Err(erro) = resultado {
        eprintln!("não consegui criar a thread do Alt: {erro}");
    }
}

/// O guia deve aceitar clique agora por causa do Alt?
/// No modo de edição ele já aceita; escondido, não tem o que clicar.
pub fn deve_ligar(alt_apertado: bool, permitido: bool, edicao: bool, visivel: bool) -> bool {
    alt_apertado && permitido && !edicao && visivel
}

fn laco(app: AppHandle) {
    let estado = app.state::<Estado>();
    let mut ligado = false;
    loop {
        let permitido = estado.config.lock().unwrap().segurar_alt_pra_clicar;
        let quer = deve_ligar(
            alt_apertado(),
            permitido,
            estado.edicao.load(Ordering::SeqCst),
            estado.visivel(),
        );
        if quer != ligado {
            ligado = quer;
            aplicar(&app, &estado, quer);
        }
        thread::sleep(INTERVALO);
    }
}

fn aplicar(app: &AppHandle, estado: &Estado, ligar: bool) {
    estado.alt_segurado.store(ligar, Ordering::SeqCst);
    // A janelinha dos botões de busca (embaixo do campo de busca do jogo) vai junto.
    if let Some(busca) = janela_da_busca::janela(app) {
        let _ = busca.set_ignore_cursor_events(!ligar);
        if !ligar {
            let dela = busca.hwnd().map(|hwnd| hwnd.0 as isize).unwrap_or(0);
            if dela != 0 && jogo::janela_na_frente() == dela {
                jogo::trazer_pra_frente(jogo::janela_do_jogo());
            }
        }
    }
    // No modo de edição quem manda na janela é a edição.
    if !estado.edicao.load(Ordering::SeqCst) {
        if let Some(janela) = janela::principal(app) {
            let _ = janela.set_ignore_cursor_events(!ligar);
            if !ligar {
                // Pode ter arrastado o balão com o Alt segurado: guarda o lugar novo.
                janela::guardar_geometria(app, &janela);
                let nossa = janela.hwnd().map(|hwnd| hwnd.0 as isize).unwrap_or(0);
                if nossa != 0 && jogo::janela_na_frente() == nossa {
                    jogo::trazer_pra_frente(jogo::janela_do_jogo());
                }
            }
        }
    }
    janela::emitir_estado(app);
}

#[cfg(windows)]
fn alt_apertado() -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_MENU};
    // SAFETY: só lê o estado da tecla; o bit mais alto ligado = apertada agora.
    unsafe { (GetAsyncKeyState(VK_MENU as i32) as u16 & 0x8000) != 0 }
}

#[cfg(not(windows))]
fn alt_apertado() -> bool {
    false
}

#[cfg(test)]
mod testes {
    use super::deve_ligar;

    #[test]
    fn so_liga_com_alt_apertado_e_permitido() {
        assert!(deve_ligar(true, true, false, true));
        assert!(!deve_ligar(false, true, false, true));
        assert!(!deve_ligar(true, false, false, true), "desligado nas configurações");
    }

    #[test]
    fn nao_mexe_na_edicao_nem_escondido() {
        assert!(!deve_ligar(true, true, true, true), "a edição já aceita clique");
        assert!(!deve_ligar(true, true, false, false), "escondido não tem o que clicar");
    }
}
