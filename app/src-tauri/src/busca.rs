//! Põe uma busca pronta na caixa de busca do baú ou do vendedor do jogo, quando o jogador pede
//! (Alt + clique num botão de busca do balão).
//!
//! É o que o Awakened PoE Trade faz no "stash search": o texto vai pra área de transferência, o
//! jogo vem pra frente e recebe Ctrl+F, Ctrl+V e Enter; depois a área de transferência volta a
//! ter o texto que tinha. Um clique é uma busca: nada se repete sozinho, nada é lido do jogo e,
//! se outra janela tomar a frente no meio, as teclas param.

/// O jogo corta a busca em 250 letras.
pub const LIMITE: usize = 250;

/// Confere o texto antes de mandar: sem nada, grande demais ou com quebra de linha não vai.
pub fn conferir(texto: &str) -> Result<&str, String> {
    let texto = texto.trim();
    if texto.is_empty() {
        return Err("A busca está vazia.".into());
    }
    if texto.chars().count() > LIMITE {
        return Err(format!("A busca passa de {LIMITE} letras, o limite do jogo."));
    }
    if texto.contains(['\r', '\n']) {
        return Err("A busca tem quebra de linha.".into());
    }
    Ok(texto)
}

#[cfg(windows)]
pub use sistema::aplicar;

#[cfg(not(windows))]
pub fn aplicar(_texto: &str, _nossa: isize) -> Result<(), String> {
    Err("Só funciona no Windows.".into())
}

#[cfg(windows)]
mod sistema {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::thread::sleep;
    use std::time::{Duration, Instant};

    use windows_sys::Win32::Foundation::{GlobalFree, HANDLE, HWND};
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, MapVirtualKeyW, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
        MAPVK_VK_TO_VSC, VK_CONTROL, VK_MENU, VK_RETURN,
    };

    use crate::jogo;

    /// Formato de texto Unicode da área de transferência.
    const CF_UNICODETEXT: u32 = 13;
    const VK_F: u16 = 0x46;
    const VK_V: u16 = 0x56;

    /// Até quanto tempo esperar o jogador soltar o Alt (com ele apertado, Ctrl+F viraria Ctrl+Alt+F).
    const ESPERA_DO_ALT: Duration = Duration::from_secs(3);
    /// Até quanto tempo esperar o jogo vir pra frente.
    const ESPERA_DO_JOGO: Duration = Duration::from_millis(800);
    /// Pausa entre apertar e soltar cada tecla.
    const DENTRO_DA_TECLA: Duration = Duration::from_millis(15);
    /// Pausa entre um atalho e o outro (o jogo abre a caixa de busca antes de colar).
    const ENTRE_ATALHOS: Duration = Duration::from_millis(60);
    /// Depois do Enter, quanto esperar o jogo ler a área de transferência antes de devolver o texto antigo.
    const ANTES_DE_DEVOLVER: Duration = Duration::from_millis(350);
    /// Tentativas de abrir a área de transferência (outro programa pode estar com ela).
    const TENTATIVAS: u32 = 10;

    /// Uma busca de cada vez: outro clique durante a primeira é ignorado.
    static OCUPADO: AtomicBool = AtomicBool::new(false);

    struct Livre;
    impl Drop for Livre {
        fn drop(&mut self) {
            OCUPADO.store(false, Ordering::SeqCst);
        }
    }

    /// `nossa` é a janela do guia (dona da área de transferência enquanto o texto está lá).
    pub fn aplicar(texto: &str, nossa: isize) -> Result<(), String> {
        let texto = super::conferir(texto)?;
        if OCUPADO.swap(true, Ordering::SeqCst) {
            return Err("Ainda pondo a busca anterior.".into());
        }
        let _livre = Livre;

        let do_jogo = jogo::janela_do_jogo();
        if do_jogo == 0 {
            return Err("O jogo não está aberto.".into());
        }
        if !esperar(ESPERA_DO_ALT, || !apertada(VK_MENU)) {
            return Err("Solte o Alt pra busca ir pro jogo.".into());
        }

        let antes = ler_texto(nossa);
        gravar_texto(nossa, texto)?;
        let resultado = mandar(do_jogo);
        sleep(ANTES_DE_DEVOLVER);
        if let Some(antes) = antes {
            let _ = gravar_texto(nossa, &antes);
        }
        resultado
    }

    /// Traz o jogo pra frente e manda Ctrl+F, Ctrl+V e Enter, parando se ele sair da frente.
    fn mandar(do_jogo: jogo::Janela) -> Result<(), String> {
        jogo::trazer_pra_frente(do_jogo);
        if !esperar(ESPERA_DO_JOGO, || jogo::janela_na_frente() == do_jogo) {
            return Err("O jogo não veio pra frente. A busca ficou copiada: cole com Ctrl+V.".into());
        }
        sleep(ENTRE_ATALHOS);
        let passos: [(&[u16], &str); 3] = [(&[VK_CONTROL, VK_F], "Ctrl+F"), (&[VK_CONTROL, VK_V], "Ctrl+V"), (&[VK_RETURN], "Enter")];
        for (teclas, nome) in passos {
            if jogo::janela_na_frente() != do_jogo {
                return Err(format!("O jogo saiu da frente antes do {nome}."));
            }
            if !tocar(teclas) {
                // Acontece quando o jogo foi aberto como administrador e o guia não.
                return Err(format!(
                    "O Windows não deixou o {nome} chegar no jogo (o jogo está aberto como administrador?). \
                     A busca ficou copiada: cole com Ctrl+V."
                ));
            }
            sleep(ENTRE_ATALHOS);
        }
        Ok(())
    }

    /// Espera `condicao` ficar verdadeira, olhando a cada 10 ms, até `limite`.
    fn esperar(limite: Duration, condicao: impl Fn() -> bool) -> bool {
        let inicio = Instant::now();
        loop {
            if condicao() {
                return true;
            }
            if inicio.elapsed() >= limite {
                return false;
            }
            sleep(Duration::from_millis(10));
        }
    }

    fn apertada(tecla: u16) -> bool {
        // SAFETY: só pergunta o estado da tecla.
        unsafe { (GetAsyncKeyState(tecla as i32) as u16 & 0x8000) != 0 }
    }

    fn evento(tecla: u16, soltar: bool) -> INPUT {
        // SAFETY: só converte o código da tecla.
        let scan = unsafe { MapVirtualKeyW(tecla as u32, MAPVK_VK_TO_VSC) } as u16;
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: tecla,
                    wScan: scan,
                    dwFlags: if soltar { KEYEVENTF_KEYUP } else { 0 },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    /// Manda um evento de teclado. Falso se o Windows recusou.
    fn enviar(entrada: INPUT) -> bool {
        // SAFETY: um evento de teclado montado aqui, com o tamanho certo.
        unsafe { SendInput(1, &entrada, std::mem::size_of::<INPUT>() as i32) == 1 }
    }

    /// Aperta as teclas na ordem e solta na ordem contrária (Ctrl, F, solta F, solta Ctrl).
    /// Sempre solta todas, mesmo se alguma falhou. Falso se o Windows recusou alguma.
    fn tocar(teclas: &[u16]) -> bool {
        let mut todas = true;
        for &tecla in teclas {
            todas &= enviar(evento(tecla, false));
            sleep(DENTRO_DA_TECLA);
        }
        for &tecla in teclas.iter().rev() {
            todas &= enviar(evento(tecla, true));
            sleep(DENTRO_DA_TECLA);
        }
        todas
    }

    /// Abre a área de transferência, tentando de novo se outro programa estiver com ela.
    fn abrir(nossa: isize) -> bool {
        for _ in 0..TENTATIVAS {
            // SAFETY: a janela pode ser 0 (nenhuma dona); a chamada só falha.
            if unsafe { OpenClipboard(nossa as HWND) } != 0 {
                return true;
            }
            sleep(Duration::from_millis(20));
        }
        false
    }

    /// O texto que está na área de transferência agora (`None` se não tem texto).
    fn ler_texto(nossa: isize) -> Option<String> {
        // SAFETY: só pergunta se há texto.
        if unsafe { IsClipboardFormatAvailable(CF_UNICODETEXT) } == 0 || !abrir(nossa) {
            return None;
        }
        // SAFETY: a área está aberta; o bloco é travado só pra copiar o texto, até o zero do fim.
        let texto = unsafe {
            let dados: HANDLE = GetClipboardData(CF_UNICODETEXT);
            let mut texto = None;
            if !dados.is_null() {
                let ponteiro = GlobalLock(dados) as *const u16;
                if !ponteiro.is_null() {
                    let mut tamanho = 0usize;
                    while *ponteiro.add(tamanho) != 0 {
                        tamanho += 1;
                    }
                    texto = Some(String::from_utf16_lossy(std::slice::from_raw_parts(ponteiro, tamanho)));
                    GlobalUnlock(dados);
                }
            }
            CloseClipboard();
            texto
        };
        texto
    }

    /// Põe `texto` na área de transferência.
    fn gravar_texto(nossa: isize, texto: &str) -> Result<(), String> {
        let mut letras: Vec<u16> = texto.encode_utf16().collect();
        letras.push(0);
        if !abrir(nossa) {
            return Err("Outro programa está usando a área de transferência.".into());
        }
        // SAFETY: a área está aberta; o bloco tem o tamanho do texto com o zero do fim. Se o
        // Windows aceitar o bloco, ele passa a ser dele; se não, é liberado aqui.
        let certo = unsafe {
            let mut certo = false;
            if EmptyClipboard() != 0 {
                let bloco = GlobalAlloc(GMEM_MOVEABLE, letras.len() * 2);
                if !bloco.is_null() {
                    let destino = GlobalLock(bloco) as *mut u16;
                    if !destino.is_null() {
                        std::ptr::copy_nonoverlapping(letras.as_ptr(), destino, letras.len());
                        GlobalUnlock(bloco);
                        certo = !SetClipboardData(CF_UNICODETEXT, bloco).is_null();
                    }
                    if !certo {
                        GlobalFree(bloco);
                    }
                }
            }
            CloseClipboard();
            certo
        };
        if certo {
            Ok(())
        } else {
            Err("Não consegui pôr a busca na área de transferência.".into())
        }
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn confere_o_texto() {
        assert_eq!(conferir("  \"a|b\" "), Ok("\"a|b\""));
        assert!(conferir("   ").is_err());
        assert!(conferir("a\nb").is_err());
        assert!(conferir(&"a".repeat(LIMITE)).is_ok());
        assert!(conferir(&"a".repeat(LIMITE + 1)).is_err());
    }
}
