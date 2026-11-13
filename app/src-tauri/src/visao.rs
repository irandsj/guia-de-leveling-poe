//! Leitura de tela: acha na tela do jogo o ícone da gema que a build pede e põe uma moldura
//! piscando em volta dele (na janela de recompensa da quest e na loja do vendedor).
//!
//! O que isto faz, e só isto:
//! - tira uma foto da parte esquerda da janela do jogo (a mesma coisa que um print);
//! - compara com os ícones das gemas que a interface mandou procurar (`casar`);
//! - desenha molduras em janelinhas nossas, por cima, que não recebem clique nem teclado.
//!
//! Nada é lido da memória do jogo e nada é enviado a ele. Só roda com o jogo na frente e
//! com gemas pra procurar (a interface só manda gemas quando o personagem está na cidade).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Deserialize;

use crate::casar::{Foto, Icone, Lugar};

/// Lado do ícone na janela de recompensa, como fração da altura da tela do jogo.
/// Medido com a arte da GGG num print de 2000x1125: de 62 a 64 pontos (média 63,2), uns 81 em 1440.
pub(crate) const FRACAO_NA_RECOMPENSA: f32 = 0.0562;
/// Lado de um quadradinho da loja e do inventário, como fração da altura. O ícone ocupa o quadradinho.
pub(crate) const FRACAO_NA_LOJA: f32 = 0.0489;
/// As janelas de recompensa e de loja ficam no espaço livre à esquerda do inventário, que ocupa
/// `LARGURA_DO_PAINEL` alturas de tela na direita (em qualquer formato: 16:9, 4:3, 21:9, 32:9...).
/// A foto vai até a borda do inventário e mais esta folga (em alturas), pra pegar o ícone que encosta nela.
const FOLGA_DO_INVENTARIO: f32 = 0.02;
/// No máximo quantas gemas são procuradas de uma vez.
pub const MAXIMO_DE_ALVOS: usize = 12;

/// Uma gema pra procurar, como a interface manda.
#[derive(Deserialize)]
pub struct AlvoRecebido {
    pub id: String,
    /// "quest" (janela de recompensa) ou "vendedor" (loja).
    pub tipo: String,
    pub lado: usize,
    pub rgba: Vec<u8>,
}

pub struct Alvo {
    /// Qual gema é (só pra conferir nos testes e em recados de erro).
    #[allow(dead_code)]
    pub id: String,
    pub na_loja: bool,
    pub icone: Icone,
}

impl Alvo {
    /// Recompensa (com o selo "!" em cima do ícone) ou loja.
    pub fn lugar(&self) -> Lugar {
        if self.na_loja { Lugar::Loja } else { Lugar::Recompensa }
    }

    /// Lado esperado do ícone na tela, pra uma tela do jogo com esta altura.
    pub fn lado_na_tela(&self, altura: usize) -> usize {
        let fracao = if self.na_loja { FRACAO_NA_LOJA } else { FRACAO_NA_RECOMPENSA };
        (altura as f32 * fracao).round() as usize
    }
}

static ALVOS: Mutex<Option<Arc<Vec<Alvo>>>> = Mutex::new(None);

/// Troca a lista de gemas procuradas. Lista vazia desliga a leitura de tela. Devolve quantas valeram.
pub fn definir_alvos(recebidos: Vec<AlvoRecebido>) -> usize {
    let alvos: Vec<Alvo> = recebidos
        .into_iter()
        .take(MAXIMO_DE_ALVOS)
        .filter_map(|r| {
            Some(Alvo { id: r.id, na_loja: r.tipo == "vendedor", icone: Icone::novo(r.lado, r.rgba)? })
        })
        .collect();
    let quantos = alvos.len();
    *ALVOS.lock().unwrap() = (quantos > 0).then(|| Arc::new(alvos));
    quantos
}

fn alvos_de_agora() -> Option<Arc<Vec<Alvo>>> {
    ALVOS.lock().unwrap().clone()
}

// ---------- Onde procurar: a janela de compra do vendedor ----------
//
// O laço dos painéis (`paineis`) já reconhece a janela de compra a cada 300 ms. A visão usa isso
// pra não procurar à toa: com a compra fechada não procura as gemas da loja, e com ela aberta
// procura só as da loja, só dentro dela (a recompensa da quest não abre junto). Quando não dá pra
// confiar na leitura (velha, ou o jogo em outro idioma), procura tudo, como antes.

/// Até quanto tempo vale o que o laço dos painéis disse da janela de compra.
const COMPRA_VALE: Duration = Duration::from_secs(2);
/// Folga em volta da janela de compra, em alturas de tela (o ícone pode encostar na borda).
const FOLGA_DA_COMPRA: f32 = 0.01;

/// A janela de compra como o laço dos painéis viu por último: quando, e onde (esquerda, topo,
/// direita e base, em pontos da tela), ou `None` se ela não estava aberta.
static COMPRA: Mutex<Option<(Instant, Option<[i32; 4]>)>> = Mutex::new(None);
/// O jogo está em outro idioma: o cabeçalho da compra tem texto em inglês e pode não ser reconhecido.
static OUTRO_IDIOMA: AtomicBool = AtomicBool::new(false);

/// O laço dos painéis conta o que viu da janela de compra (em pontos da tela).
pub fn anotar_compra(janela: Option<[i32; 4]>) {
    *COMPRA.lock().unwrap() = Some((Instant::now(), janela));
}

/// As opções do jogo dizem se ele está em outro idioma.
pub fn anotar_idioma(outro: bool) {
    OUTRO_IDIOMA.store(outro, Ordering::SeqCst);
}

/// O que se sabe da janela de compra numa olhada.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Loja {
    /// Não dá pra confiar na leitura: procura todas as gemas, na foto inteira.
    NaoSei,
    /// Fechada: só as gemas da recompensa.
    Fechada,
    /// Aberta neste pedaço da foto (esquerda, topo, direita, base): só as gemas da loja, só ali.
    Aberta([usize; 4]),
}

impl Loja {
    /// Vale procurar esta gema agora?
    pub fn procura(self, na_loja: bool) -> bool {
        match self {
            Loja::NaoSei => true,
            Loja::Fechada => !na_loja,
            Loja::Aberta(_) => na_loja,
        }
    }
}

/// A `Loja` de uma foto de `largura` x `altura` com este `canto` na tela, pelo que foi `anotado`.
pub(crate) fn loja_de(
    anotado: Option<(Instant, Option<[i32; 4]>)>,
    outro_idioma: bool,
    agora: Instant,
    canto: (i32, i32),
    largura: usize,
    altura: usize,
) -> Loja {
    let Some((quando, janela)) = anotado else { return Loja::NaoSei };
    if outro_idioma || agora.saturating_duration_since(quando) > COMPRA_VALE {
        return Loja::NaoSei;
    }
    let Some([esquerda, topo, direita, base]) = janela else { return Loja::Fechada };
    let folga = (FOLGA_DA_COMPRA * altura as f32).ceil() as i64;
    let dentro = |v: i32, origem: i32, ate: usize| (v as i64 - origem as i64).clamp(0, ate as i64) as usize;
    let (x0, x1) = (dentro(esquerda, canto.0 + folga as i32, largura), dentro(direita, canto.0 - folga as i32, largura));
    let (y0, y1) = (dentro(topo, canto.1 + folga as i32, altura), dentro(base, canto.1 - folga as i32, altura));
    if x1 <= x0 || y1 <= y0 {
        // A janela vista não cai na foto: melhor procurar tudo do que nada.
        return Loja::NaoSei;
    }
    Loja::Aberta([x0, y0, x1, y1])
}

/// A `Loja` de agora, pra foto com este canto e tamanho.
pub fn loja_agora(canto: (i32, i32), largura: usize, altura: usize) -> Loja {
    let anotado = *COMPRA.lock().unwrap();
    loja_de(anotado, OUTRO_IDIOMA.load(Ordering::SeqCst), Instant::now(), canto, largura, altura)
}

/// Copia o pedaço `[x0, y0, x1, y1]` da foto pra `destino`.
pub(crate) fn recortar(foto: &Foto, [x0, y0, x1, y1]: [usize; 4], destino: &mut Foto) {
    let (x1, y1) = (x1.min(foto.largura), y1.min(foto.altura));
    let (largura, altura) = (x1.saturating_sub(x0), y1.saturating_sub(y0));
    destino.largura = largura;
    destino.altura = altura;
    destino.rgb.clear();
    for y in y0..y0 + altura {
        destino.rgb.extend_from_slice(&foto.rgb[(y * foto.largura + x0) * 3..(y * foto.largura + x1) * 3]);
    }
}

/// Largura, em pontos, da parte da tela do jogo que é fotografada: o espaço livre à esquerda do
/// inventário. Num monitor largo (21:9, 32:9) as janelas ficam mais pra direita, no meio desse espaço.
pub(crate) fn largura_olhada(largura: usize, altura: usize) -> usize {
    let inventario = (crate::paineis::LARGURA_DO_PAINEL as f32 - FOLGA_DO_INVENTARIO) * altura as f32;
    largura.min((largura as f32 - inventario).ceil().max(1.0) as usize)
}

/// Liga a thread que olha a tela. Fica parada enquanto não houver gemas pra procurar.
pub fn iniciar() {
    #[cfg(windows)]
    {
        let resultado = std::thread::Builder::new().name("visao".into()).spawn(sistema::laco);
        if let Err(erro) = resultado {
            eprintln!("não consegui criar a thread da leitura de tela: {erro}");
        }
    }
}

#[cfg(windows)]
pub use sistema::{copiar, fotografar, medir};
#[cfg(all(windows, test))]
pub(crate) use sistema::{olhar, Olhadas, Visto};

#[cfg(windows)]
mod sistema {
    use std::ptr::{null, null_mut};
    use std::sync::Arc;
    use std::thread::sleep;
    use std::time::{Duration, Instant};

    use windows_sys::Win32::Foundation::{HWND, POINT, RECT};
    use windows_sys::Win32::Graphics::Gdi::{
        BitBlt, ClientToScreen, CombineRgn, CreateCompatibleBitmap, CreateCompatibleDC, CreateRectRgn,
        CreateSolidBrush, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC, SelectObject, SetWindowRgn,
        BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, RGN_DIFF, SRCCOPY,
    };
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetClientRect, PeekMessageW, RegisterClassW,
        SetLayeredWindowAttributes, SetWindowDisplayAffinity, SetWindowPos, ShowWindow, TranslateMessage,
        HWND_TOPMOST, LWA_ALPHA, MSG, PM_REMOVE, SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_HIDE,
        WDA_EXCLUDEFROMCAPTURE, WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP,
    };

    use super::{alvos_de_agora, largura_olhada, loja_agora, recortar, Alvo, Loja};
    use crate::casar::{conferir, fator_pro_lado, procurar, Achado, Foto, FotoGrossa};
    use crate::jogo;

    /// De quanto em quanto tempo a tela é fotografada.
    const ENTRE_OLHADAS: Duration = Duration::from_millis(500);
    /// Volta do laço com moldura na tela (pra piscar liso) e sem.
    const VOLTA_PISCANDO: Duration = Duration::from_millis(40);
    const VOLTA_PARADA: Duration = Duration::from_millis(250);
    /// Além das duas primeiras gemas da lista, quantas das ainda não achadas são procuradas por olhada.
    const PROCURAS_POR_OLHADA: usize = 2;
    /// Sem a janela de recompensa reconhecida, as gemas dela são procuradas (na foto inteira) só uma
    /// olhada a cada tantas: a cada 2 s em vez de 0,5 s. Se a janela estiver lá sem ser reconhecida
    /// (como na interface de controle), a moldura só demora um pouco mais.
    const OLHADAS_SEM_A_JANELA: usize = 4;
    /// Quantas olhadas seguidas sem ver o ícone até tirar a moldura (evita piscar à toa).
    const FALTAS_ATE_SUMIR: u32 = 2;
    /// Cor da moldura (0x00BBGGRR): verde-claro, que não existe na interface do jogo.
    const COR: u32 = 0x0050_FF60;
    /// Folga entre o ícone e a moldura, em pontos.
    const FOLGA: i32 = 3;
    /// Um pisca completo, em milissegundos.
    const PISCA_MS: u128 = 900;

    /// Foto da tela do jogo: só a parte esquerda (onde ficam recompensa e loja) ou `inteira`.
    /// Devolve o canto dela na tela.
    pub fn fotografar(janela: jogo::Janela, foto: &mut Foto, bruto: &mut Vec<u8>, inteira: bool) -> Option<(i32, i32)> {
        let area = medir(janela)?;
        let largura = if inteira { area.largura } else { largura_olhada(area.largura, area.altura) };
        copiar(area.canto, largura, area.altura, foto, bruto).then_some(area.canto)
    }

    /// A área de jogo de uma janela, na tela.
    #[derive(Clone, Copy, Debug, PartialEq)]
    pub struct AreaDoJogo {
        pub canto: (i32, i32),
        pub largura: usize,
        pub altura: usize,
    }

    /// Onde fica a área de jogo da janela e de que tamanho é. Nada se ela sumiu ou é pequena demais.
    pub fn medir(janela: jogo::Janela) -> Option<AreaDoJogo> {
        let janela = janela as HWND;
        // SAFETY: chamadas simples da API do Windows; os ponteiros apontam pra variáveis locais vivas.
        unsafe {
            let mut area: RECT = std::mem::zeroed();
            if GetClientRect(janela, &mut area) == 0 {
                return None;
            }
            let (largura, altura) = (area.right as usize, area.bottom as usize);
            if altura < 480 || largura < 640 {
                return None;
            }
            let mut canto = POINT { x: 0, y: 0 };
            if ClientToScreen(janela, &mut canto) == 0 {
                return None;
            }
            Some(AreaDoJogo { canto: (canto.x, canto.y), largura, altura })
        }
    }

    /// Copia pra `foto`, em RGB, o retângulo da tela com este canto e este tamanho (como um print).
    pub fn copiar(canto: (i32, i32), largura: usize, altura: usize, foto: &mut Foto, bruto: &mut Vec<u8>) -> bool {
        if largura == 0 || altura == 0 {
            return false;
        }
        // SAFETY: chamadas simples da API do Windows; os ponteiros apontam pra variáveis locais
        // vivas, e tudo o que é criado aqui é liberado antes de sair.
        unsafe {
            let canto = POINT { x: canto.0, y: canto.1 };
            let tela = GetDC(null_mut());
            if tela.is_null() {
                return false;
            }
            let memoria = CreateCompatibleDC(tela);
            let bitmap = CreateCompatibleBitmap(tela, largura as i32, altura as i32);
            let antigo = SelectObject(memoria, bitmap);
            let copiou = BitBlt(memoria, 0, 0, largura as i32, altura as i32, tela, canto.x, canto.y, SRCCOPY);
            SelectObject(memoria, antigo);

            let mut info: BITMAPINFO = std::mem::zeroed();
            info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
            info.bmiHeader.biWidth = largura as i32;
            info.bmiHeader.biHeight = -(altura as i32); // de cima pra baixo
            info.bmiHeader.biPlanes = 1;
            info.bmiHeader.biBitCount = 32;
            bruto.resize(largura * altura * 4, 0);
            let linhas = if copiou != 0 {
                GetDIBits(memoria, bitmap, 0, altura as u32, bruto.as_mut_ptr().cast(), &mut info, DIB_RGB_COLORS)
            } else {
                0
            };
            DeleteObject(bitmap);
            DeleteDC(memoria);
            ReleaseDC(null_mut(), tela);
            if linhas as usize != altura {
                return false;
            }

            foto.largura = largura;
            foto.altura = altura;
            foto.rgb.resize(largura * altura * 3, 0);
            for (destino, origem) in foto.rgb.chunks_exact_mut(3).zip(bruto.chunks_exact(4)) {
                destino[0] = origem[2];
                destino[1] = origem[1];
                destino[2] = origem[0];
            }
            true
        }
    }

    /// O que se sabe de cada gema procurada, de uma olhada pra outra.
    #[derive(Clone, Copy, Default)]
    pub struct Visto {
        pub achado: Option<Achado>,
        faltas: u32,
    }

    /// O que passa de uma olhada pra outra, fora as gemas vistas.
    pub struct Olhadas {
        /// Quantas olhadas já foram (espaça a procura da recompensa sem a janela dela).
        conta: usize,
        /// Revezamento das gemas ainda não achadas: um pras olhadas sem as da recompensa e outro
        /// pras com elas (a lista muda de tamanho entre as duas, e um só deixaria gema de fora).
        vez: [usize; 2],
        /// Os pedaços recortados da foto (no máximo dois por olhada), guardados pra não pedir
        /// memória toda vez.
        pedacos: [Foto; 2],
    }

    impl Olhadas {
        pub fn novas() -> Olhadas {
            let vazia = || Foto { largura: 0, altura: 0, rgb: Vec::new() };
            Olhadas { conta: 0, vez: [0; 2], pedacos: [vazia(), vazia()] }
        }

        /// A próxima olhada procura tudo (lista nova, ou de volta ao jogo).
        pub fn recomecar(&mut self) {
            self.conta = 0;
        }

        /// Solta a memória dos pedaços.
        pub fn soltar(&mut self) {
            for pedaco in &mut self.pedacos {
                pedaco.rgb = Vec::new();
            }
        }
    }

    /// Uma olhada: confere as gemas já achadas e procura algumas das que faltam, só as que podem
    /// estar na tela e só onde podem estar. As da loja, pelo que se sabe da `loja` (com a compra
    /// aberta, só dentro dela). As da recompensa, só dentro da janela dela, quando ela é
    /// reconhecida; quando não, na foto inteira, uma olhada a cada `OLHADAS_SEM_A_JANELA`.
    pub fn olhar(foto: &Foto, alvos: &[Alvo], vistos: &mut [Visto], olhadas: &mut Olhadas, loja: Loja) {
        let mut a_procurar: Vec<usize> = Vec::new();
        for (i, alvo) in alvos.iter().enumerate() {
            if let Some(antes) = vistos[i].achado {
                match conferir(foto, &alvo.icone, antes, alvo.lugar()) {
                    Some(agora) => vistos[i] = Visto { achado: Some(agora), faltas: 0 },
                    None => {
                        vistos[i].faltas += 1;
                        if vistos[i].faltas >= FALTAS_ATE_SUMIR {
                            vistos[i] = Visto::default();
                        }
                    }
                }
            } else if loja.procura(alvo.na_loja) {
                a_procurar.push(i);
            }
        }
        // A janela de recompensa só é procurada se falta achar alguma gema dela.
        let recompensa = if a_procurar.iter().any(|&i| !alvos[i].na_loja) {
            crate::paineis::nota_da_recompensa(foto).1
        } else {
            None
        };
        let com_recompensa = recompensa.is_some() || olhadas.conta % OLHADAS_SEM_A_JANELA == 0;
        olhadas.conta = olhadas.conta.wrapping_add(1);
        if !com_recompensa {
            a_procurar.retain(|&i| alvos[i].na_loja);
        }

        // As duas primeiras são as do passo de agora: sempre. As outras se revezam.
        let fixas = a_procurar.len().min(2);
        let resto = a_procurar.split_off(fixas);
        let mut desta_vez = a_procurar;
        if !resto.is_empty() {
            let vez = &mut olhadas.vez[com_recompensa as usize];
            for k in 0..resto.len().min(PROCURAS_POR_OLHADA) {
                desta_vez.push(resto[(*vez + k) % resto.len()]);
            }
            *vez = vez.wrapping_add(PROCURAS_POR_OLHADA);
        }

        // Cada gema no pedaço da foto em que pode estar (nenhum: a foto inteira). Gemas com o
        // mesmo pedaço são procuradas juntas, aproveitando as fotos reduzidas.
        let da_loja = match loja {
            Loja::Aberta(janela) => Some(janela),
            _ => None,
        };
        let mut grupos: Vec<(Option<[usize; 4]>, Vec<usize>)> = Vec::new();
        for i in desta_vez {
            let onde = if alvos[i].na_loja { da_loja } else { recompensa };
            match grupos.iter_mut().find(|grupo| grupo.0 == onde) {
                Some(grupo) => grupo.1.push(i),
                None => grupos.push((onde, vec![i])),
            }
        }
        for ((onde, gemas), pedaco) in grupos.into_iter().zip(olhadas.pedacos.iter_mut()) {
            procurar_em(foto, onde, pedaco, &gemas, alvos, vistos);
        }
    }

    /// Procura estas gemas no pedaço `onde` da foto (ou na foto inteira), recortado em `pedaco`.
    fn procurar_em(
        foto: &Foto,
        onde: Option<[usize; 4]>,
        pedaco: &mut Foto,
        gemas: &[usize],
        alvos: &[Alvo],
        vistos: &mut [Visto],
    ) {
        // O tamanho da gema continua vindo da altura da tela, não da do pedaço.
        let altura_da_tela = foto.altura;
        let (foto, dx, dy) = match onde {
            Some(janela) => {
                recortar(foto, janela, pedaco);
                (&*pedaco, janela[0], janela[1])
            }
            None => (foto, 0, 0),
        };
        let mut grossas: Vec<FotoGrossa> = Vec::new();
        for &i in gemas {
            let lado = alvos[i].lado_na_tela(altura_da_tela);
            let fator = fator_pro_lado(lado);
            let posicao = match grossas.iter().position(|g| g.fator == fator) {
                Some(p) => p,
                None => {
                    grossas.push(FotoGrossa::nova(foto, fator));
                    grossas.len() - 1
                }
            };
            if let Some(achado) = procurar(foto, &grossas[posicao], &alvos[i].icone, lado, alvos[i].lugar()) {
                let achado = Achado { x: achado.x + dx, y: achado.y + dy, ..achado };
                vistos[i] = Visto { achado: Some(achado), faltas: 0 };
            }
        }
    }

    /// As janelinhas das molduras: uma por gema, criadas quando precisa.
    pub struct Molduras {
        janelas: Vec<(HWND, Option<(i32, i32, i32)>)>,
        classe: Vec<u16>,
        /// Fora da foto da tela (senão a própria moldura atrapalharia a próxima olhada).
        fora_da_foto: bool,
    }

    impl Molduras {
        pub fn novas(fora_da_foto: bool) -> Molduras {
            let classe: Vec<u16> = "GuiaLevelingMoldura\0".encode_utf16().collect();
            // SAFETY: registra uma classe de janela com o procedimento padrão do Windows; `classe`
            // vive enquanto as janelas existirem (fica guardada na estrutura).
            unsafe {
                let mut wc: WNDCLASSW = std::mem::zeroed();
                wc.lpfnWndProc = Some(DefWindowProcW);
                wc.hInstance = GetModuleHandleW(null());
                wc.lpszClassName = classe.as_ptr();
                wc.hbrBackground = CreateSolidBrush(COR);
                RegisterClassW(&wc);
            }
            Molduras { janelas: Vec::new(), classe, fora_da_foto }
        }

        fn criar(&self) -> HWND {
            // SAFETY: cria uma janela sem dono, invisível até `mostrar`. Os estilos fazem o clique
            // atravessar (TRANSPARENT), não pegar o foco (NOACTIVATE) e não aparecer na barra (TOOLWINDOW).
            unsafe {
                let janela = CreateWindowExW(
                    WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                    self.classe.as_ptr(),
                    null(),
                    WS_POPUP,
                    0,
                    0,
                    10,
                    10,
                    null_mut(),
                    null_mut(),
                    GetModuleHandleW(null()),
                    null(),
                );
                if !janela.is_null() {
                    SetLayeredWindowAttributes(janela, 0, 255, LWA_ALPHA);
                    if self.fora_da_foto {
                        SetWindowDisplayAffinity(janela, WDA_EXCLUDEFROMCAPTURE);
                    }
                }
                janela
            }
        }

        /// Põe a moldura `i` em volta do quadrado (x, y, lado), em pontos da tela.
        pub fn mostrar(&mut self, i: usize, x: i32, y: i32, lado: i32) {
            while self.janelas.len() <= i {
                let nova = self.criar();
                self.janelas.push((nova, None));
            }
            let (janela, onde) = self.janelas[i];
            if janela.is_null() || onde == Some((x, y, lado)) {
                return;
            }
            let espessura = (lado / 16).max(3);
            let borda = FOLGA + espessura;
            let tamanho = lado + 2 * borda;
            // SAFETY: a janela é nossa. A região passa a ser do Windows depois de `SetWindowRgn`.
            unsafe {
                let regiao = CreateRectRgn(0, 0, tamanho, tamanho);
                let furo = CreateRectRgn(espessura, espessura, tamanho - espessura, tamanho - espessura);
                CombineRgn(regiao, regiao, furo, RGN_DIFF);
                DeleteObject(furo);
                SetWindowRgn(janela, regiao, 1);
                SetWindowPos(
                    janela,
                    HWND_TOPMOST,
                    x - borda,
                    y - borda,
                    tamanho,
                    tamanho,
                    SWP_NOACTIVATE | SWP_SHOWWINDOW,
                );
            }
            self.janelas[i].1 = Some((x, y, lado));
        }

        pub fn esconder(&mut self, i: usize) {
            if let Some((janela, onde)) = self.janelas.get_mut(i) {
                if onde.take().is_some() && !janela.is_null() {
                    // SAFETY: a janela é nossa.
                    unsafe { ShowWindow(*janela, SW_HIDE) };
                }
            }
        }

        pub fn esconder_todas(&mut self) {
            for i in 0..self.janelas.len() {
                self.esconder(i);
            }
        }

        pub fn alguma_na_tela(&self) -> bool {
            self.janelas.iter().any(|(_, onde)| onde.is_some())
        }

        /// Faz as molduras piscarem (a opacidade vai e volta) e atende os recados do Windows.
        pub fn piscar(&mut self, milissegundos: u128) {
            let fase = (milissegundos % PISCA_MS) as f32 / PISCA_MS as f32;
            let onda = 0.5 - 0.5 * (fase * std::f32::consts::TAU).cos();
            let opacidade = (70.0 + 185.0 * onda) as u8;
            // SAFETY: as janelas são nossas; a fila de mensagens é desta thread.
            unsafe {
                for (janela, onde) in &self.janelas {
                    if onde.is_some() && !janela.is_null() {
                        SetLayeredWindowAttributes(*janela, 0, opacidade, LWA_ALPHA);
                    }
                }
                let mut recado: MSG = std::mem::zeroed();
                while PeekMessageW(&mut recado, null_mut(), 0, 0, PM_REMOVE) != 0 {
                    TranslateMessage(&recado);
                    DispatchMessageW(&recado);
                }
            }
        }
    }

    pub fn laco() {
        let mut molduras = Molduras::novas(true);
        let mut foto = Foto { largura: 0, altura: 0, rgb: Vec::new() };
        let mut bruto: Vec<u8> = Vec::new();
        let mut vistos: Vec<Visto> = Vec::new();
        let mut lista: Option<Arc<Vec<Alvo>>> = None;
        let mut olhadas = Olhadas::novas();
        let inicio = Instant::now();
        let mut ultima_olhada = inicio;

        loop {
            molduras.piscar(inicio.elapsed().as_millis());
            sleep(if molduras.alguma_na_tela() { VOLTA_PISCANDO } else { VOLTA_PARADA });
            if ultima_olhada.elapsed() < ENTRE_OLHADAS {
                continue;
            }
            ultima_olhada = Instant::now();

            let agora = alvos_de_agora();
            let mesma = match (&lista, &agora) {
                (Some(a), Some(b)) => Arc::ptr_eq(a, b),
                (None, None) => true,
                _ => false,
            };
            if !mesma {
                vistos = vec![Visto::default(); agora.as_ref().map_or(0, |a| a.len())];
                molduras.esconder_todas();
                olhadas.recomecar();
                lista = agora;
            }
            let Some(alvos) = &lista else {
                // Sem nada pra procurar: solta a memória da foto.
                if foto.rgb.capacity() > 0 {
                    foto.rgb = Vec::new();
                    olhadas.soltar();
                    bruto = Vec::new();
                }
                continue;
            };

            let na_frente = jogo::janela_na_frente();
            let no_jogo = na_frente != 0 && jogo::classe_da_janela(na_frente) == jogo::CLASSE_DO_JOGO;
            let canto = if no_jogo { fotografar(na_frente, &mut foto, &mut bruto, false) } else { None };
            let Some((canto_x, canto_y)) = canto else {
                vistos.iter_mut().for_each(|v| *v = Visto::default());
                molduras.esconder_todas();
                olhadas.recomecar();
                continue;
            };

            let loja = loja_agora((canto_x, canto_y), foto.largura, foto.altura);
            olhar(&foto, alvos, &mut vistos, &mut olhadas, loja);
            for (i, visto) in vistos.iter().enumerate() {
                match visto.achado {
                    Some(a) => molduras.mostrar(i, canto_x + a.x as i32, canto_y + a.y as i32, a.lado as i32),
                    None => molduras.esconder(i),
                }
            }
        }
    }

    /// Prova de ponta a ponta fora do jogo: uma janela nossa mostra um print, e o mesmo caminho
    /// do app (foto da tela, procura, moldura) tem que achar a gema e desenhar a moldura no lugar.
    /// Só roda com `GUIA_PROVA_VISAO` (ver `casar::testes::prova_com_print_de_verdade`).
    #[cfg(test)]
    mod testes {
        use super::*;
        use crate::casar::Icone;
        use windows_sys::Win32::Graphics::Gdi::{
            BeginPaint, EndPaint, SetDIBitsToDevice, UpdateWindow, PAINTSTRUCT,
        };
        use windows_sys::Win32::UI::HiDpi::{
            SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::{DestroyWindow, SW_SHOWNOACTIVATE, WM_PAINT};

        /// Com a compra aberta, a gema da loja é procurada só no pedaço da janela, no tamanho da
        /// tela inteira, e o lugar achado volta pra foto inteira; com a compra fechada, nem é procurada.
        /// Sorteio de bytes, sempre igual pra mesma semente.
        fn sorteador(mut semente: u64) -> impl FnMut() -> u8 {
            move || {
                semente = semente.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                (semente >> 33) as u8
            }
        }

        /// Ícone redondo de manchas grandes (pra sobreviver à redução), 78 por 78.
        fn icone_de_manchas(sorteio: &mut impl FnMut() -> u8) -> Icone {
            let blocos: Vec<[u8; 3]> = (0..13 * 13).map(|_| [sorteio(), sorteio(), sorteio()]).collect();
            let mut rgba = vec![0u8; 78 * 78 * 4];
            for y in 0..78 {
                for x in 0..78 {
                    let (dx, dy) = (x as f32 - 38.5, y as f32 - 38.5);
                    if (dx * dx + dy * dy).sqrt() <= 34.0 {
                        let cor = blocos[(y / 6) * 13 + x / 6];
                        rgba[(y * 78 + x) * 4..][..4].copy_from_slice(&[cor[0], cor[1], cor[2], 255]);
                    }
                }
            }
            Icone::novo(78, rgba).unwrap()
        }

        /// Cola o ícone da gema na foto, no tamanho da tela, com o canto em (gx, gy).
        fn colar(foto: &mut Foto, alvo: &Alvo, (gx, gy): (usize, usize)) {
            let lado = alvo.lado_na_tela(foto.altura);
            let colada = alvo.icone.redimensionado(lado);
            for iy in 0..lado {
                for ix in 0..lado {
                    let p = &colada.rgba[(iy * lado + ix) * 4..][..4];
                    if p[3] > 128 {
                        let i = ((gy + iy) * foto.largura + gx + ix) * 3;
                        foto.rgb[i..i + 3].copy_from_slice(&p[..3]);
                    }
                }
            }
        }

        /// Com a compra aberta, a gema da loja é procurada só no pedaço da janela, no tamanho da
        /// tela inteira, e o lugar achado volta pra foto inteira; com a compra fechada, nem é procurada.
        #[test]
        fn com_a_compra_aberta_procura_so_no_pedaco() {
            let mut sorteio = sorteador(3);
            let alvo = Alvo { id: "loja".into(), na_loja: true, icone: icone_de_manchas(&mut sorteio) };
            let (largura, altura) = (1280, 1080);
            let lado = alvo.lado_na_tela(altura);
            let mut foto = Foto { largura, altura, rgb: (0..largura * altura * 3).map(|_| sorteio() / 3 + 20).collect() };
            let (gx, gy) = (700, 500);
            colar(&mut foto, &alvo, (gx, gy));
            let alvos = [alvo];
            let mut olhadas = Olhadas::novas();

            let mut vistos = [Visto::default()];
            olhar(&foto, &alvos, &mut vistos, &mut olhadas, Loja::Fechada);
            assert!(vistos[0].achado.is_none());

            olhar(&foto, &alvos, &mut vistos, &mut olhadas, Loja::Aberta([400, 200, 1100, 950]));
            assert_eq!((olhadas.pedacos[0].largura, olhadas.pedacos[0].altura), (700, 750));
            let achado = vistos[0].achado.expect("devia achar a gema no pedaço");
            assert!(achado.x.abs_diff(gx) <= 1 && achado.y.abs_diff(gy) <= 1, "{achado:?}");
            assert_eq!(achado.lado, lado);

            // Fora do pedaço, não é achada.
            let mut vistos = [Visto::default()];
            olhar(&foto, &alvos, &mut vistos, &mut olhadas, Loja::Aberta([0, 0, 600, 1080]));
            assert!(vistos[0].achado.is_none());
        }

        /// Com a janela de recompensa reconhecida, a gema dela é procurada a cada olhada, só dentro
        /// da janela; sem ela, na foto inteira, uma olhada a cada `OLHADAS_SEM_A_JANELA`.
        #[test]
        fn a_janela_de_recompensa_decide_quando_e_onde_procurar() {
            let mut sorteio = sorteador(5);
            let alvo = Alvo { id: "recompensa".into(), na_loja: false, icone: icone_de_manchas(&mut sorteio) };
            let (largura, altura) = (1280, 1080);
            // Cabeçalho com o canto em (324, 324): a janela vai de 313 a 993 na largura e de 313 a
            // 864 na altura.
            let canto = (0.30 * altura as f64, 0.30 * altura as f64);
            let com_janela = crate::paineis::testes::foto_com_recompensa(largura, altura, Some(canto));
            let sem_janela = crate::paineis::testes::foto_com_recompensa(largura, altura, None);
            let alvos = [alvo];
            let olhadas_ate_achar = |foto: &Foto, olhadas: &mut Olhadas| {
                (1..=OLHADAS_SEM_A_JANELA * 2).find(|_| {
                    let mut vistos = [Visto::default()];
                    olhar(foto, &alvos, &mut vistos, olhadas, Loja::Fechada);
                    vistos[0].achado.is_some()
                })
            };

            // Com a janela, achada em toda olhada, e procurada só no pedaço dela.
            let mut foto = com_janela;
            colar(&mut foto, &alvos[0], (500, 600));
            let mut olhadas = Olhadas::novas();
            for _ in 0..OLHADAS_SEM_A_JANELA + 1 {
                assert_eq!(olhadas_ate_achar(&foto, &mut olhadas), Some(1));
            }
            let pedaco = &olhadas.pedacos[0];
            assert!(pedaco.largura.abs_diff(680) <= 3 && pedaco.altura.abs_diff(551) <= 3);

            // Com a janela, fora dela a gema não é procurada.
            let mut foto = crate::paineis::testes::foto_com_recompensa(largura, altura, Some(canto));
            colar(&mut foto, &alvos[0], (1100, 600));
            let mut olhadas = Olhadas::novas();
            assert_eq!(olhadas_ate_achar(&foto, &mut olhadas), None);

            // Sem a janela, achada na primeira olhada (procura tudo) e depois só a cada tantas.
            let mut foto = sem_janela;
            colar(&mut foto, &alvos[0], (1100, 600));
            let mut olhadas = Olhadas::novas();
            assert_eq!(olhadas_ate_achar(&foto, &mut olhadas), Some(1));
            assert_eq!(olhadas_ate_achar(&foto, &mut olhadas), Some(OLHADAS_SEM_A_JANELA));
            assert_eq!(olhadas_ate_achar(&foto, &mut olhadas), Some(OLHADAS_SEM_A_JANELA));
            olhadas.recomecar();
            assert_eq!(olhadas_ate_achar(&foto, &mut olhadas), Some(1));
        }

        /// Sem a janela de recompensa, só uma olhada a cada tantas procura as gemas dela; o
        /// revezamento anda só nessas olhadas, senão voltaria sempre às mesmas gemas.
        #[test]
        fn o_revezamento_da_recompensa_passa_por_todas_as_gemas() {
            let mut sorteio = sorteador(7);
            let (largura, altura) = (1280, 1080);
            let mut foto = Foto { largura, altura, rgb: (0..largura * altura * 3).map(|_| sorteio() / 3 + 20).collect() };
            // Duas fixas e quatro que se revezam; só a última está na tela.
            let alvos: Vec<Alvo> =
                (0..6).map(|i| Alvo { id: i.to_string(), na_loja: false, icone: icone_de_manchas(&mut sorteio) }).collect();
            colar(&mut foto, &alvos[5], (600, 500));
            let mut vistos = vec![Visto::default(); alvos.len()];
            let mut olhadas = Olhadas::novas();
            let achada = (1..=OLHADAS_SEM_A_JANELA * 3).find(|_| {
                olhar(&foto, &alvos, &mut vistos, &mut olhadas, Loja::Fechada);
                vistos[5].achado.is_some()
            });
            // Na segunda olhada com a recompensa: a primeira procura as gemas 2 e 3; a segunda, 4 e 5.
            assert_eq!(achada, Some(OLHADAS_SEM_A_JANELA + 1));
            assert!(vistos[..5].iter().all(|v| v.achado.is_none()));
        }

        static mut TELA: (usize, usize, Vec<u8>) = (0, 0, Vec::new());

        unsafe extern "system" fn desenhar(janela: HWND, recado: u32, w: usize, l: isize) -> isize {
            if recado != WM_PAINT {
                return DefWindowProcW(janela, recado, w, l);
            }
            let mut pintura: PAINTSTRUCT = std::mem::zeroed();
            let dc = BeginPaint(janela, &mut pintura);
            let tela = &*std::ptr::addr_of!(TELA);
            let mut info: BITMAPINFO = std::mem::zeroed();
            info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
            info.bmiHeader.biWidth = tela.0 as i32;
            info.bmiHeader.biHeight = -(tela.1 as i32);
            info.bmiHeader.biPlanes = 1;
            info.bmiHeader.biBitCount = 32;
            SetDIBitsToDevice(
                dc, 0, 0, tela.0 as u32, tela.1 as u32, 0, 0, 0, tela.1 as u32,
                tela.2.as_ptr().cast(), &info, DIB_RGB_COLORS,
            );
            EndPaint(janela, &pintura);
            0
        }

        fn atender_recados() {
            unsafe {
                let mut recado: MSG = std::mem::zeroed();
                while PeekMessageW(&mut recado, null_mut(), 0, 0, PM_REMOVE) != 0 {
                    DispatchMessageW(&recado);
                }
            }
        }

        #[test]
        fn foto_procura_e_moldura_numa_janela_de_teste() {
            let Ok(pasta) = std::env::var("GUIA_PROVA_VISAO") else { return };
            let pasta = std::path::Path::new(&pasta);
            let texto = std::fs::read_to_string(pasta.join("tela.txt")).unwrap();
            let n: Vec<usize> = texto.split_whitespace().map(|v| v.parse().unwrap()).collect();
            let (largura, altura) = (n[0], n[1]);
            let rgb = std::fs::read(pasta.join("tela.rgb")).unwrap();
            let bgra: Vec<u8> = rgb.chunks_exact(3).flat_map(|p| [p[2], p[1], p[0], 255]).collect();
            let alvo = Alvo {
                id: "volley".into(),
                na_loja: false,
                icone: Icone::novo(78, std::fs::read(pasta.join("ParallelProjectile.rgba")).unwrap()).unwrap(),
            };
            // O print é reduzido: o ícone tem uns 63 pontos em 1130 de altura, a mesma fração do jogo.
            assert_eq!(alvo.lado_na_tela(altura), 64);

            unsafe {
                SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
                TELA = (largura, altura, bgra);
                let classe: Vec<u16> = "GuiaLevelingProva\0".encode_utf16().collect();
                let mut wc: WNDCLASSW = std::mem::zeroed();
                wc.lpfnWndProc = Some(desenhar);
                wc.hInstance = GetModuleHandleW(null());
                wc.lpszClassName = classe.as_ptr();
                RegisterClassW(&wc);
                let (onde_x, onde_y) = (40, 30);
                let janela = CreateWindowExW(
                    WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                    classe.as_ptr(), null(), WS_POPUP,
                    onde_x, onde_y, largura as i32, altura as i32,
                    null_mut(), null_mut(), GetModuleHandleW(null()), null(),
                );
                assert!(!janela.is_null());
                ShowWindow(janela, SW_SHOWNOACTIVATE);
                UpdateWindow(janela);
                atender_recados();
                sleep(Duration::from_millis(400));

                let mut foto = Foto { largura: 0, altura: 0, rgb: Vec::new() };
                let mut bruto = Vec::new();
                let canto = fotografar(janela as isize, &mut foto, &mut bruto, false).expect("foto da tela");
                assert_eq!(canto, (onde_x, onde_y));
                let alvos = [alvo];
                let mut vistos = [Visto::default()];
                let mut olhadas = Olhadas::novas();
                let inicio = Instant::now();
                olhar(&foto, &alvos, &mut vistos, &mut olhadas, Loja::NaoSei);
                println!("primeira olhada: {:?} em {:?}", vistos[0].achado, inicio.elapsed());
                let achado = vistos[0].achado.expect("devia achar a Volley na foto da tela");
                assert!(achado.x.abs_diff(784) <= 3 && achado.y.abs_diff(518) <= 3, "{achado:?}");
                let inicio = Instant::now();
                olhar(&foto, &alvos, &mut vistos, &mut olhadas, Loja::NaoSei);
                println!("olhada seguinte (só conferir): {:?}", inicio.elapsed());
                assert!(vistos[0].achado.is_some());

                // A moldura, visível pra foto só neste teste, tem que aparecer em volta do ícone.
                let mut molduras = Molduras::novas(false);
                let (x, y, lado) = (canto.0 + achado.x as i32, canto.1 + achado.y as i32, achado.lado as i32);
                molduras.mostrar(0, x, y, lado);
                atender_recados();
                sleep(Duration::from_millis(400));
                fotografar(janela as isize, &mut foto, &mut bruto, false).expect("segunda foto");
                let ponto = |px: usize, py: usize| -> [u8; 3] {
                    let i = (py * foto.largura + px) * 3;
                    [foto.rgb[i], foto.rgb[i + 1], foto.rgb[i + 2]]
                };
                let verde = [0x60, 0xFF, 0x50];
                // Um ponto da borda de cima e um da esquerda são da cor da moldura…
                assert_eq!(ponto(achado.x + 30, achado.y - FOLGA as usize - 2), verde);
                assert_eq!(ponto(achado.x - FOLGA as usize - 2, achado.y + 30), verde);
                // …e o miolo do ícone continua descoberto: a gema ainda é reconhecida.
                assert!(conferir(&foto, &alvos[0].icone, achado, alvos[0].lugar()).is_some());

                // Com a moldura fora da foto (como no app), ela não aparece na foto da tela.
                molduras.esconder_todas();
                let mut escondidas = Molduras::novas(true);
                escondidas.mostrar(0, x, y, lado);
                atender_recados();
                sleep(Duration::from_millis(400));
                fotografar(janela as isize, &mut foto, &mut bruto, false).expect("terceira foto");
                let i = ((achado.y - FOLGA as usize - 2) * foto.largura + achado.x + 30) * 3;
                assert_ne!([foto.rgb[i], foto.rgb[i + 1], foto.rgb[i + 2]], verde);

                escondidas.esconder_todas();
                DestroyWindow(janela);
            }
        }
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    fn recebido(id: &str, tipo: &str, bytes: usize) -> AlvoRecebido {
        AlvoRecebido { id: id.into(), tipo: tipo.into(), lado: 78, rgba: vec![0; bytes] }
    }

    #[test]
    fn lista_de_alvos_troca_e_esvazia() {
        let certo = 78 * 78 * 4;
        assert_eq!(definir_alvos(vec![recebido("a", "quest", certo), recebido("b", "vendedor", 10)]), 1);
        let alvos = alvos_de_agora().unwrap();
        assert_eq!(alvos[0].id, "a");
        assert!(!alvos[0].na_loja);
        assert_eq!(definir_alvos(Vec::new()), 0);
        assert!(alvos_de_agora().is_none());
    }

    #[test]
    fn tamanho_esperado_do_icone_acompanha_a_altura_da_tela() {
        let na_recompensa = Alvo { id: String::new(), na_loja: false, icone: Icone::novo(78, vec![0; 78 * 78 * 4]).unwrap() };
        assert_eq!(na_recompensa.lado_na_tela(1440), 81);
        assert_eq!(na_recompensa.lado_na_tela(1080), 61);
        let na_loja = Alvo { na_loja: true, ..na_recompensa };
        assert_eq!(na_loja.lado_na_tela(1440), 70);
    }

    #[test]
    fn olha_o_espaco_livre_a_esquerda_do_inventario() {
        // 16:9: a tela menos o inventário (0,6133 alturas) e a folga.
        assert_eq!(largura_olhada(1920, 1080), 1280);
        assert_eq!(largura_olhada(2560, 1440), 1706);
        // 4:3, 21:9 e 32:9: o espaço livre cresce com a largura.
        assert_eq!(largura_olhada(1024, 768), 569);
        assert_eq!(largura_olhada(3440, 1440), 2586);
        assert_eq!(largura_olhada(5120, 1440), 4266);
        // Janela em pé, mais estreita que o inventário: nunca zero.
        assert_eq!(largura_olhada(500, 1440), 1);
    }

    #[test]
    fn a_janela_de_compra_decide_o_que_procurar() {
        let agora = Instant::now();
        let canto = (100, 50);
        let (largura, altura) = (1280, 1080);
        let loja = |anotado| loja_de(anotado, false, agora, canto, largura, altura);

        // Nada anotado ainda, leitura velha ou jogo em outro idioma: procura tudo.
        assert_eq!(loja(None), Loja::NaoSei);
        let velho = agora - Duration::from_secs(3);
        assert_eq!(loja(Some((velho, None))), Loja::NaoSei);
        assert_eq!(loja_de(Some((agora, None)), true, agora, canto, largura, altura), Loja::NaoSei);

        // Fechada: só a recompensa.
        assert_eq!(loja(Some((agora, None))), Loja::Fechada);
        assert!(Loja::Fechada.procura(false) && !Loja::Fechada.procura(true));

        // Aberta (Purchase em 1080: x 280 a 976 da área de jogo): pedaço da foto, com 11 de folga.
        let janela = [100 + 280, 50 + 170, 100 + 976, 50 + 896];
        assert_eq!(loja(Some((agora, Some(janela)))), Loja::Aberta([269, 159, 987, 907]));
        let aberta = Loja::Aberta([0, 0, 1, 1]);
        assert!(aberta.procura(true) && !aberta.procura(false));

        // Passando da foto, corta na borda; fora dela, procura tudo.
        assert_eq!(loja(Some((agora, Some([90, 40, 2000, 2000])))), Loja::Aberta([0, 0, 1280, 1080]));
        assert_eq!(loja(Some((agora, Some([1500, 40, 1800, 900])))), Loja::NaoSei);
    }

    #[test]
    fn recorta_um_pedaco_da_foto() {
        let (largura, altura) = (5, 4);
        let rgb = (0..largura * altura).flat_map(|i| [i as u8, 0, 0]).collect();
        let foto = Foto { largura, altura, rgb };
        let mut pedaco = Foto { largura: 0, altura: 0, rgb: Vec::new() };
        recortar(&foto, [1, 2, 4, 9], &mut pedaco);
        assert_eq!((pedaco.largura, pedaco.altura), (3, 2));
        let vermelhos: Vec<u8> = pedaco.rgb.chunks(3).map(|p| p[0]).collect();
        assert_eq!(vermelhos, [11, 12, 13, 16, 17, 18]);
    }
}
