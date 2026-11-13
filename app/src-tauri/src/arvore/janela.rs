//! A janela do desenho do guia da árvore e os buffers de imagem do Windows.
//!
//! O que isto faz, e só isto: cria uma janela NOSSA, em camadas, por cima da área do jogo, e
//! põe nela o desenho que `desenho` montou. A janela nunca pega o foco (`WS_EX_NOACTIVATE`),
//! deixa o clique passar (`WS_EX_TRANSPARENT`) e fica fora de toda foto da tela
//! (`WDA_EXCLUDEFROMCAPTURE`), pra o guia não fotografar o próprio desenho. Se o Windows
//! recusar essa última parte, a janela não é criada e nada é desenhado.
//!
//! Nada aqui fala com o jogo: nem tecla, nem clique, nem recado de janela. A janela do jogo
//! não é tocada (quem lê a posição dela é `laco`, e só lê).

#[cfg(windows)]
pub use sistema::{atender_recados, Imagem, JanelaDoDesenho};
#[cfg(all(windows, test))]
pub use sistema::pintar_na_memoria;

#[cfg(windows)]
mod sistema {
    use std::ffi::c_void;
    use std::ptr::{null, null_mut};

    use windows_sys::Win32::Foundation::{HWND, POINT, RECT, SIZE};
    use windows_sys::Win32::Graphics::Gdi::{
        CreateCompatibleDC, CreateDIBSection, CreateFontW, DeleteDC, DeleteObject, DrawTextW, GdiFlush, SelectObject,
        SetBkMode, SetTextColor, AC_SRC_ALPHA, AC_SRC_OVER, BITMAPINFO, BITMAPINFOHEADER, BLENDFUNCTION,
        DIB_RGB_COLORS, DT_CALCRECT, DT_LEFT, DT_NOPREFIX, HBITMAP, HDC, HFONT, HGDIOBJ,
    };
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, PeekMessageW, RegisterClassW,
        SetWindowDisplayAffinity, SetWindowPos, ShowWindow, TranslateMessage, UpdateLayeredWindow, HWND_TOPMOST, MSG,
        PM_REMOVE, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_HIDE, SW_SHOWNOACTIVATE, ULW_ALPHA,
        WDA_EXCLUDEFROMCAPTURE, WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
        WS_EX_TRANSPARENT, WS_POPUP,
    };

    use crate::arvore::desenho::{Cena, Forma, Tela, Texto};

    /// Maior lado de imagem que se aceita criar, em pontos (um monitor 8K tem 7680).
    const LADO_MAXIMO: i32 = 16384;
    /// Largura máxima do rascunho de texto, em pontos (uma linha de situação comprida cabe folgada).
    const LARGURA_DO_RASCUNHO: i32 = 2048;
    /// Altura do rascunho de texto como fração da altura da tela, e os limites dela em pontos
    /// (8 linhas de efeito de maestria com letra de 23 pontos dão ~250).
    const FRACAO_DO_RASCUNHO: i32 = 4;
    const ALTURA_MINIMA_DO_RASCUNHO: i32 = 96;
    const ALTURA_MAXIMA_DO_RASCUNHO: i32 = 512;
    /// Peso de letra em negrito (`FW_BOLD` do Windows).
    const NEGRITO: i32 = 700;
    /// Letra com antisserrilhado em tons de cinza (`ANTIALIASED_QUALITY`): o ClearType daria
    /// bordas coloridas, que não servem de cobertura.
    const LETRA_CINZA: u32 = 4;
    /// Fundo transparente pro texto (`TRANSPARENT` do GDI).
    const FUNDO_TRANSPARENTE: i32 = 1;
    /// Branco, no formato de cor do GDI (0x00BBGGRR).
    const BRANCO_DO_GDI: u32 = 0x00FF_FFFF;
    /// Quantas letras (em unidades UTF-16) um texto pode ter. Os do guia chegam com até 400.
    const LETRAS_POR_TEXTO: usize = 512;
    /// Quantos tamanhos de letra ficam guardados: a situação, o efeito da maestria e os números,
    /// que acompanham o anel de cada tipo de nó (normal, notável, pedra angular, encaixe, maestria).
    const FONTES_GUARDADAS: usize = 8;

    /// Uma imagem de 32 bits na memória (DIB de cima pra baixo) com o contexto de desenho dela.
    /// Serve de destino pra foto da tela (`laco`), de superfície da janela e de rascunho de texto.
    pub struct Imagem {
        dc: HDC,
        bitmap: HBITMAP,
        antigo: HGDIOBJ,
        pontos: *mut u8,
        largura: i32,
        altura: i32,
    }

    impl Imagem {
        /// `None` se as medidas não prestam ou se o Windows não deu a memória.
        pub fn nova(largura: i32, altura: i32) -> Option<Imagem> {
            if largura <= 0 || altura <= 0 || largura > LADO_MAXIMO || altura > LADO_MAXIMO {
                return None;
            }
            // SAFETY: os ponteiros apontam pra variáveis locais vivas; o que é criado aqui ou vai
            // pra estrutura (e é solto no `Drop`) ou é solto antes de sair.
            unsafe {
                let dc = CreateCompatibleDC(null_mut());
                if dc.is_null() {
                    return None;
                }
                let mut info: BITMAPINFO = std::mem::zeroed();
                info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
                info.bmiHeader.biWidth = largura;
                info.bmiHeader.biHeight = -altura; // de cima pra baixo
                info.bmiHeader.biPlanes = 1;
                info.bmiHeader.biBitCount = 32;
                let mut pontos: *mut c_void = null_mut();
                let bitmap = CreateDIBSection(dc, &info, DIB_RGB_COLORS, &mut pontos, null_mut(), 0);
                if bitmap.is_null() || pontos.is_null() {
                    if !bitmap.is_null() {
                        DeleteObject(bitmap);
                    }
                    DeleteDC(dc);
                    return None;
                }
                let antigo = SelectObject(dc, bitmap);
                Some(Imagem { dc, bitmap, antigo, pontos: pontos.cast(), largura, altura })
            }
        }

        pub fn largura(&self) -> i32 {
            self.largura
        }

        pub fn altura(&self) -> i32 {
            self.altura
        }

        /// O contexto de desenho (pra `BitBlt`, `DrawTextW`…). Vale enquanto a imagem viver.
        pub fn dc(&self) -> HDC {
            self.dc
        }

        fn bytes(&self) -> usize {
            self.largura as usize * self.altura as usize * 4
        }

        /// Os pontos, 4 bytes cada (B, G, R, X), de cima pra baixo.
        pub fn pontos(&self) -> &[u8] {
            // SAFETY: `pontos` aponta pra memória do DIB, que tem `largura * altura * 4` bytes e
            // vive enquanto `self` viver. O GDI só escreve nela dentro de chamadas feitas por esta
            // mesma thread, nunca ao mesmo tempo que alguém lê a fatia.
            unsafe {
                GdiFlush();
                std::slice::from_raw_parts(self.pontos, self.bytes())
            }
        }

        pub fn pontos_mut(&mut self) -> &mut [u8] {
            // SAFETY: como em `pontos`; o `&mut self` garante que não há outra fatia viva.
            unsafe {
                GdiFlush();
                std::slice::from_raw_parts_mut(self.pontos, self.bytes())
            }
        }
    }

    impl Drop for Imagem {
        fn drop(&mut self) {
            // SAFETY: tudo aqui foi criado em `nova` e é desta estrutura.
            unsafe {
                SelectObject(self.dc, self.antigo);
                DeleteObject(self.bitmap);
                DeleteDC(self.dc);
            }
        }
    }

    /// As letras já criadas, por altura.
    struct Fontes {
        guardadas: Vec<(i32, HFONT)>,
        nome: Vec<u16>,
    }

    impl Fontes {
        fn novas() -> Fontes {
            Fontes { guardadas: Vec::new(), nome: "Segoe UI\0".encode_utf16().collect() }
        }

        /// A letra com esta altura (em pontos), criada na primeira vez. Nula se o Windows recusar.
        fn pegar(&mut self, altura: i32) -> HFONT {
            if let Some((_, fonte)) = self.guardadas.iter().find(|(a, _)| *a == altura) {
                return *fonte;
            }
            if self.guardadas.len() >= FONTES_GUARDADAS {
                self.soltar();
            }
            // SAFETY: `nome` é texto terminado em zero e vive na estrutura. Altura negativa pede
            // a altura da letra, não a da linha.
            let fonte = unsafe {
                CreateFontW(-altura, 0, 0, 0, NEGRITO, 0, 0, 0, 0, 0, 0, LETRA_CINZA, 0, self.nome.as_ptr())
            };
            if !fonte.is_null() {
                self.guardadas.push((altura, fonte));
            }
            fonte
        }

        fn soltar(&mut self) {
            for (_, fonte) in self.guardadas.drain(..) {
                // SAFETY: a letra foi criada aqui e não está selecionada em nenhum contexto
                // (quem usa devolve a antiga antes de sair).
                unsafe { DeleteObject(fonte) };
            }
        }
    }

    impl Drop for Fontes {
        fn drop(&mut self) {
            self.soltar();
        }
    }

    /// A janela em camadas que mostra o desenho por cima da área do jogo.
    pub struct JanelaDoDesenho {
        janela: HWND,
        superficie: Option<Imagem>,
        rascunho: Option<Imagem>,
        fontes: Fontes,
        na_tela: bool,
    }

    impl JanelaDoDesenho {
        /// Cria a janela, escondida. `Err` (com a frase pro usuário) se o Windows não criar ou se
        /// não aceitar deixar a janela fora das fotos da tela: sem isso NUNCA se desenha, senão o
        /// guia leria o próprio desenho como se fosse a árvore.
        pub fn criar() -> Result<JanelaDoDesenho, String> {
            let classe: Vec<u16> = "GuiaLevelingArvore\0".encode_utf16().collect();
            // SAFETY: registra uma classe com o procedimento padrão do Windows (o nome é copiado
            // pelo sistema; registrar de novo só falha, sem efeito) e cria uma janela sem dono,
            // invisível. Os estilos fazem o clique atravessar (TRANSPARENT), não pegar o foco
            // (NOACTIVATE) e não aparecer na barra (TOOLWINDOW).
            unsafe {
                let modulo = GetModuleHandleW(null());
                let mut wc: WNDCLASSW = std::mem::zeroed();
                wc.lpfnWndProc = Some(DefWindowProcW);
                wc.hInstance = modulo;
                wc.lpszClassName = classe.as_ptr();
                RegisterClassW(&wc);
                let janela = CreateWindowExW(
                    WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                    classe.as_ptr(),
                    null(),
                    WS_POPUP,
                    0,
                    0,
                    10,
                    10,
                    null_mut(),
                    null_mut(),
                    modulo,
                    null(),
                );
                if janela.is_null() {
                    return Err("Não deu pra criar a janela do desenho da árvore.".into());
                }
                // De propósito NÃO se chama `SetLayeredWindowAttributes`: ela e `UpdateLayeredWindow`
                // não convivem na mesma janela.
                if SetWindowDisplayAffinity(janela, WDA_EXCLUDEFROMCAPTURE) == 0 {
                    DestroyWindow(janela);
                    return Err(
                        "Este Windows não deixa tirar o desenho das fotos da tela; a árvore fica só no painel.".into(),
                    );
                }
                Ok(JanelaDoDesenho { janela, superficie: None, rascunho: None, fontes: Fontes::novas(), na_tela: false })
            }
        }

        pub fn na_tela(&self) -> bool {
            self.na_tela
        }

        /// Desenha a cena e põe a janela em cima do retângulo (x, y, largura, altura) da tela.
        /// `proibido` diz onde não se risca (tapume, parte fixa da interface), em pontos da janela.
        /// Devolve `false` (e esconde) se algo falhar.
        pub fn mostrar(
            &mut self,
            x: i32,
            y: i32,
            largura: i32,
            altura: i32,
            cena: &Cena,
            proibido: &dyn Fn(f32, f32) -> bool,
        ) -> bool {
            if !self.preparar(largura, altura) {
                self.esconder();
                return false;
            }
            let JanelaDoDesenho { janela, superficie, rascunho, fontes, na_tela } = self;
            let (Some(superficie), Some(rascunho)) = (superficie.as_mut(), rascunho.as_ref()) else {
                return false;
            };
            let dc = superficie.dc();
            {
                let Some(mut tela) = Tela::nova(largura as usize, altura as usize, superficie.pontos_mut()) else {
                    return false;
                };
                pintar(&mut tela, rascunho, fontes, cena, proibido);
            }
            let destino = POINT { x, y };
            let tamanho = SIZE { cx: largura, cy: altura };
            let origem = POINT { x: 0, y: 0 };
            let mistura = BLENDFUNCTION {
                BlendOp: AC_SRC_OVER as u8,
                BlendFlags: 0,
                SourceConstantAlpha: 255,
                AlphaFormat: AC_SRC_ALPHA as u8,
            };
            // SAFETY: a janela e a imagem são nossas; os ponteiros apontam pra variáveis locais
            // vivas. Mostrar com SHOWNOACTIVATE e reafirmar o "por cima" com NOACTIVATE não mexe
            // no foco de ninguém.
            let ok = unsafe {
                let ok = UpdateLayeredWindow(*janela, null_mut(), &destino, &tamanho, dc, &origem, 0, &mistura, ULW_ALPHA);
                if ok != 0 {
                    if !*na_tela {
                        ShowWindow(*janela, SW_SHOWNOACTIVATE);
                    }
                    SetWindowPos(*janela, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                }
                ok != 0
            };
            if ok {
                *na_tela = true;
            } else {
                self.esconder();
            }
            ok
        }

        /// Tira o desenho da tela (a janela continua existindo, escondida).
        pub fn esconder(&mut self) {
            if self.na_tela {
                // SAFETY: a janela é nossa.
                unsafe { ShowWindow(self.janela, SW_HIDE) };
                self.na_tela = false;
            }
        }

        /// Garante a superfície e o rascunho do tamanho certo. `false` se não deu.
        fn preparar(&mut self, largura: i32, altura: i32) -> bool {
            let serve = self.superficie.as_ref().is_some_and(|s| s.largura() == largura && s.altura() == altura);
            if !serve {
                // Solta a antiga antes de pedir a nova, pra não ter as duas na memória.
                self.superficie = None;
                self.rascunho = None;
                self.superficie = Imagem::nova(largura, altura);
            }
            if self.superficie.is_some() && self.rascunho.is_none() {
                self.rascunho = rascunho_pra(largura, altura);
            }
            self.superficie.is_some() && self.rascunho.is_some()
        }
    }

    /// O rascunho de texto pra uma tela deste tamanho.
    fn rascunho_pra(largura: i32, altura: i32) -> Option<Imagem> {
        let alto = (altura / FRACAO_DO_RASCUNHO).clamp(ALTURA_MINIMA_DO_RASCUNHO, ALTURA_MAXIMA_DO_RASCUNHO);
        Imagem::nova(largura.min(LARGURA_DO_RASCUNHO), alto)
    }

    /// Pinta a cena inteira na tela: formas, textos, recorte do proibido e, por último, a caixa de
    /// situação (a única que pode ficar em cima de parte fixa da interface).
    fn pintar(tela: &mut Tela, rascunho: &Imagem, fontes: &mut Fontes, cena: &Cena, proibido: &dyn Fn(f32, f32) -> bool) {
        tela.limpar();
        tela.desenhar(&cena.formas);
        for texto in &cena.textos {
            escrever(tela, rascunho, fontes, texto);
        }
        tela.recortar(proibido);
        if let Some(situacao) = &cena.situacao {
            escrever(tela, rascunho, fontes, situacao);
        }
    }

    /// A cena pintada na memória, do mesmo jeito que `mostrar` pinta (BGRA pré-multiplicado), sem
    /// janela nenhuma: é o que a bancada põe por cima das fotos pra ver o desenho.
    #[cfg(test)]
    pub fn pintar_na_memoria(largura: i32, altura: i32, cena: &Cena, proibido: &dyn Fn(f32, f32) -> bool) -> Option<Vec<u8>> {
        let mut superficie = Imagem::nova(largura, altura)?;
        let rascunho = rascunho_pra(largura, altura)?;
        let mut fontes = Fontes::novas();
        let mut tela = Tela::nova(largura as usize, altura as usize, superficie.pontos_mut())?;
        pintar(&mut tela, &rascunho, &mut fontes, cena, proibido);
        Some(superficie.pontos().to_vec())
    }

    impl Drop for JanelaDoDesenho {
        fn drop(&mut self) {
            // SAFETY: a janela é nossa e foi criada por esta mesma thread. As imagens e as letras
            // se soltam sozinhas em seguida.
            unsafe { DestroyWindow(self.janela) };
        }
    }

    /// Escreve um texto numa caixinha de fundo escuro. O Windows escreve branco sobre preto no
    /// rascunho (o GDI não sabe de transparência) e a luz de cada ponto vira cobertura da cor.
    fn escrever(tela: &mut Tela, rascunho: &Imagem, fontes: &mut Fontes, texto: &Texto) {
        let largo: Vec<u16> = texto.texto.encode_utf16().take(LETRAS_POR_TEXTO).collect();
        if largo.is_empty() || !texto.altura.is_finite() || !texto.x.is_finite() || !texto.y.is_finite() {
            return;
        }
        let altura_da_letra = (texto.altura.round() as i32).clamp(8, 96);
        let fonte = fontes.pegar(altura_da_letra);
        if fonte.is_null() {
            return;
        }
        let dc = rascunho.dc();
        // SAFETY: o contexto e a letra são nossos; `largo` e `medida` vivem até o fim das chamadas
        // e o tamanho passado é o de `largo`. O retângulo de escrita fica dentro do rascunho, e a
        // letra antiga volta pro contexto antes de sair.
        let (largura, altura) = unsafe {
            let antiga = SelectObject(dc, fonte);
            let mut medida = RECT { left: 0, top: 0, right: rascunho.largura(), bottom: 0 };
            DrawTextW(dc, largo.as_ptr(), largo.len() as i32, &mut medida, DT_CALCRECT | DT_NOPREFIX | DT_LEFT);
            let largura = medida.right.clamp(0, rascunho.largura());
            let altura = medida.bottom.clamp(0, rascunho.altura());
            if largura > 0 && altura > 0 {
                // Preto no pedaço que vai ser usado (a memória é a do rascunho, de cima pra baixo).
                GdiFlush();
                let bytes_por_linha = rascunho.largura() as usize * 4;
                std::ptr::write_bytes(rascunho.pontos, 0, bytes_por_linha * altura as usize);
                SetBkMode(dc, FUNDO_TRANSPARENTE);
                SetTextColor(dc, BRANCO_DO_GDI);
                let mut onde = RECT { left: 0, top: 0, right: largura, bottom: altura };
                DrawTextW(dc, largo.as_ptr(), largo.len() as i32, &mut onde, DT_NOPREFIX | DT_LEFT);
            }
            SelectObject(dc, antiga);
            (largura, altura)
        };
        if largura <= 0 || altura <= 0 {
            return;
        }
        let margem = (texto.altura * 0.35).round().max(2.0);
        let (caixa_l, caixa_a) = (largura as f32 + 2.0 * margem, altura as f32 + 2.0 * margem);
        // A caixa fica onde a âncora manda, mas sempre inteira dentro da tela (se couber).
        let maximo_x = (tela.largura() as f32 - caixa_l).max(0.0);
        let maximo_y = (tela.altura() as f32 - caixa_a).max(0.0);
        let x0 = (texto.x - texto.ancora_x * caixa_l).round().clamp(0.0, maximo_x);
        let y0 = (texto.y - texto.ancora_y * caixa_a).round().clamp(0.0, maximo_y);
        tela.desenhar(&[Forma::Caixa { x0, y0, x1: x0 + caixa_l, y1: y0 + caixa_a, cor: texto.fundo }]);
        tela.cobrir(
            (x0 + margem) as i64,
            (y0 + margem) as i64,
            largura as usize,
            altura as usize,
            rascunho.pontos(),
            rascunho.largura() as usize,
            texto.cor,
        );
    }

    /// Atende os recados que o Windows mandou pras janelas desta thread (a do desenho só tem o
    /// procedimento padrão; sem isso a fila enche e o Windows dá a janela por travada).
    pub fn atender_recados() {
        // SAFETY: a fila de mensagens é desta thread e `recado` é uma variável local.
        unsafe {
            let mut recado: MSG = std::mem::zeroed();
            while PeekMessageW(&mut recado, null_mut(), 0, 0, PM_REMOVE) != 0 {
                TranslateMessage(&recado);
                DispatchMessageW(&recado);
            }
        }
    }

    /// Prova de verdade, mas sem jogo nenhum: cria a janela, desenha, mostra e destrói.
    /// Só roda com `GUIA_PROVA_JANELA_DA_ARVORE=1`, porque põe uma janela na tela por um instante.
    #[cfg(test)]
    mod testes {
        use super::*;
        use crate::arvore::desenho::Cor;

        #[test]
        fn imagem_tem_o_tamanho_pedido_e_recusa_medida_ruim() {
            assert!(Imagem::nova(0, 10).is_none());
            assert!(Imagem::nova(10, -3).is_none());
            assert!(Imagem::nova(LADO_MAXIMO + 1, 10).is_none());
            let mut imagem = Imagem::nova(40, 30).expect("o Windows dá uma imagem pequena");
            assert_eq!((imagem.largura(), imagem.altura()), (40, 30));
            assert_eq!(imagem.pontos().len(), 40 * 30 * 4);
            assert!(imagem.pontos().iter().all(|b| *b == 0), "nasce zerada");
            imagem.pontos_mut()[7] = 9;
            assert_eq!(imagem.pontos()[7], 9);
        }

        #[test]
        fn texto_vira_cobertura_dentro_da_caixa() {
            let rascunho = Imagem::nova(400, 96).unwrap();
            let mut fontes = Fontes::novas();
            let mut pontos = vec![0u8; 300 * 200 * 4];
            let mut tela = Tela::nova(300, 200, &mut pontos).unwrap();
            let texto = Texto {
                x: 150.0,
                y: 100.0,
                ancora_x: 0.5,
                ancora_y: 0.5,
                texto: "12 · próximo".into(),
                altura: 20.0,
                cor: Cor { r: 255, g: 255, b: 255, a: 255 },
                fundo: Cor { r: 16, g: 16, b: 16, a: 217 },
            };
            escrever(&mut tela, &rascunho, &mut fontes, &texto);
            let alfa = |x: usize, y: usize| pontos[(y * 300 + x) * 4 + 3];
            assert_eq!(alfa(5, 5), 0, "longe da caixa nada é riscado");
            assert!(alfa(150, 100) >= 217, "o meio da caixa tem pelo menos o fundo");
            // Há letra: pontos claros (branco quase cheio) dentro da caixa.
            let claros = pontos.as_chunks::<4>().0.iter().filter(|p| p[1] > 200).count();
            assert!(claros > 30, "pontos claros: {claros}");
            // Texto num canto impossível continua dentro da tela, sem estourar.
            let mut de_novo = vec![0u8; 300 * 200 * 4];
            let mut tela = Tela::nova(300, 200, &mut de_novo).unwrap();
            let no_canto = Texto { x: 9999.0, y: -500.0, texto: "linha um\nlinha dois".into(), ..texto.clone() };
            escrever(&mut tela, &rascunho, &mut fontes, &no_canto);
            let vazio = Texto { texto: String::new(), ..texto.clone() };
            escrever(&mut tela, &rascunho, &mut fontes, &vazio);
            let torto = Texto { x: f32::NAN, altura: f32::INFINITY, ..texto };
            escrever(&mut tela, &rascunho, &mut fontes, &torto);
            assert!(de_novo[(299 * 4) + 3] > 0, "a caixa encostou no canto de cima à direita");
        }

        #[test]
        fn janela_nasce_some_e_morre_sem_pegar_o_foco() {
            if std::env::var("GUIA_PROVA_JANELA_DA_ARVORE").is_err() {
                return;
            }
            use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, IsWindow, IsWindowVisible};
            let na_frente = unsafe { GetForegroundWindow() };
            let mut janela = JanelaDoDesenho::criar().expect("criar a janela do desenho");
            let cena = Cena {
                formas: vec![Forma::Anel { x: 100.0, y: 100.0, raio: 40.0, espessura: 4.0, cor: Cor { r: 96, g: 255, b: 80, a: 255 } }],
                textos: Vec::new(),
                situacao: None,
            };
            assert!(janela.mostrar(50, 50, 320, 240, &cena, &|_, _| false));
            atender_recados();
            assert!(janela.na_tela());
            let alca = janela.janela;
            unsafe {
                assert!(IsWindowVisible(alca) != 0);
                assert_eq!(GetForegroundWindow(), na_frente, "a janela do desenho não pega o foco");
            }
            // Trocar de tamanho refaz a superfície.
            assert!(janela.mostrar(60, 60, 200, 100, &cena, &|x, _| x < 50.0));
            janela.esconder();
            assert!(!janela.na_tela());
            unsafe { assert!(IsWindowVisible(alca) == 0) };
            drop(janela);
            unsafe { assert!(IsWindow(alca) == 0, "a janela foi destruída") };
        }
    }
}
