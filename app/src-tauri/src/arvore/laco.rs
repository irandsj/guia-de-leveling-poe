//! O fio "arvore": tira fotos da tela do jogo, acha a árvore de passivas e manda desenhar.
//!
//! O que isto faz, e só isto:
//! - pergunta ao Windows qual janela está na frente e onde fica a área do jogo (só leitura);
//! - tira foto dessa área da tela (a mesma coisa que um print) e passa pras contas de `arvore_visao`;
//! - guarda o que leu em `estado` e manda `janela` desenhar por cima, numa janela nossa;
//! - avisa o painel pelo evento "arvore", só quando algo muda.
//!
//! Nada é lido da memória do jogo, nada é enviado a ele (nem tecla, nem clique, nem recado de
//! janela), a janela dele nunca é movida e nem teclado nem mouse são lidos. Só roda com o jogo
//! na frente e com um guia pra seguir; as memórias grandes só existem com a árvore aberta.

use std::time::Duration;

use arvore_visao::Tapume;

#[cfg(windows)]
pub use sistema::laco;

/// Quanto esperar até a próxima foto: `vezes` o tempo que a última levou, com um piso e um teto.
/// O piso e as `vezes` seguram o gasto de processador num PC lento (a foto nunca passa de
/// 1/`vezes` do tempo); o teto não deixa uma foto engasgada parar o fio por muito tempo.
#[cfg_attr(not(windows), allow(dead_code))]
fn espera(piso: Duration, vezes: u32, medido: Duration, teto: Duration) -> Duration {
    piso.max(medido.saturating_mul(vezes)).min(teto)
}

/// Dorme `total` em fatias de até `fatia`. Entre uma fatia e outra pergunta a `segue`; se ela
/// disser que não, para de dormir na hora. (`dormir` vem de fora pra dar pra testar sem esperar.)
#[cfg_attr(not(windows), allow(dead_code))]
fn dormir_em_fatias(
    total: Duration,
    fatia: Duration,
    mut dormir: impl FnMut(Duration),
    mut segue: impl FnMut() -> bool,
) {
    let mut resta = total;
    while !resta.is_zero() {
        let agora = if fatia.is_zero() { resta } else { resta.min(fatia) };
        dormir(agora);
        resta = resta.saturating_sub(agora);
        if !resta.is_zero() && !segue() {
            return;
        }
    }
}

/// Como a procura começa quando a porta vê algo que parece a árvore.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ComoProcura {
    /// Com ficha: tenta o zoom de antes e, se não der, todos os zooms.
    ComFicha,
    /// Sem ficha: só o zoom de antes, que é barato.
    DeGraca,
}

/// A porta viu algo que parece a árvore: entra na procura? Com ficha, sempre. Sem ficha, só se há
/// um zoom de antes pra tentar (é barato e quase sempre acerta quando a árvore reabre), e no máximo
/// uma vez a cada `entre`. Uma cena escura do jogo engana a porta e esvazia o balde; sem isto, a
/// árvore aberta numa área escura esperava até uma ficha voltar pra ser vista.
#[cfg_attr(not(windows), allow(dead_code))]
fn como_procurar(
    tem_ficha: bool,
    tem_zoom_de_antes: bool,
    desde_a_ultima_de_graca: Option<Duration>,
    entre: Duration,
) -> Option<ComoProcura> {
    if tem_ficha {
        Some(ComoProcura::ComFicha)
    } else if tem_zoom_de_antes && desde_a_ultima_de_graca.is_none_or(|desde| desde >= entre) {
        Some(ComoProcura::DeGraca)
    } else {
        None
    }
}

/// O pedaço do retângulo `painel` (esquerda, cima, direita, baixo, em pontos da tela) que cai
/// dentro da foto da área do jogo, em pontos da foto. `None` se não encosta nela.
#[cfg_attr(not(windows), allow(dead_code))]
fn tapume_na_foto(painel: (i32, i32, i32, i32), canto: (i32, i32), largura: i32, altura: i32) -> Option<Tapume> {
    let x0 = painel.0.saturating_sub(canto.0).max(0);
    let y0 = painel.1.saturating_sub(canto.1).max(0);
    let x1 = painel.2.saturating_sub(canto.0).min(largura);
    let y1 = painel.3.saturating_sub(canto.1).min(altura);
    (x0 < x1 && y0 < y1).then_some(Tapume { x0: x0 as f32, y0: y0 as f32, x1: x1 as f32, y1: y1 as f32 })
}

#[cfg(windows)]
mod sistema {
    use std::ptr::null_mut;
    use std::sync::Arc;
    use std::thread::sleep;
    use std::time::{Duration, Instant};

    use arvore_visao::{
        conferir, fracao_que_mudou, ler, parece_arvore, raio_de_fora, registrar, zona_fixa, Arvore, Encaixe, Foto,
        Leitura, Registro, Tapume, MAESTRIA,
    };
    use tauri::{AppHandle, Emitter, Manager};
    use windows_sys::Win32::Foundation::{HWND, POINT, RECT};
    use windows_sys::Win32::Graphics::Gdi::{
        BitBlt, ClientToScreen, GetDC, ReleaseDC, SetStretchBltMode, StretchBlt, COLORONCOLOR, SRCCOPY,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetClientRect, GetWindowRect};

    use super::{como_procurar, dormir_em_fatias, espera, tapume_na_foto, ComoProcura};
    use crate::arvore::desenho::{montar_cena, Cena, Entrada, Lugar};
    use crate::arvore::dica::dica_no_retangulo;
    use crate::arvore::estado::{resumir, Balde, Memoria, Resumo, Roteiro, Sabido};
    use crate::arvore::janela::{atender_recados, Imagem, JanelaDoDesenho};
    use crate::arvore::{combinado_de_agora, versao_de_agora, GuiaRecebido, SituacaoDaArvore};
    use crate::estado::Estado;
    use crate::jogo;

    /// PARADO (sem guia ou sem o jogo na frente): de quanto em quanto tempo olha se há o que fazer.
    const VOLTA_PARADA: Duration = Duration::from_millis(1000);
    /// Tique curto: PROCURA, PARANDO e o piso de SEGUINDO.
    const VOLTA_CURTA: Duration = Duration::from_millis(150);
    /// Entre a foto do registro vindo da porta e a segunda, que confirma o encaixe (e já desenha).
    const ENTRE_AS_DUAS_FOTOS: Duration = Duration::from_millis(100);
    /// PORTA: piso entre duas fotos pequenas, e quantas vezes o tempo da foto se espera. É o que a
    /// árvore aberta leva pra ser notada. A foto pequena custa quase o mesmo que a cheia (o Windows
    /// copia a área toda e só depois reduz): medida, 12 ms em 1080p e 18 ms em 1440p.
    const PISO_DA_PORTA: Duration = Duration::from_millis(250);
    const VEZES_DA_PORTA: u32 = 15;
    /// PORTA: o máximo que se espera, por mais lenta que a última foto tenha sido (um engasgo só
    /// de 2 s daria 40 s sem olhar).
    const TETO_DA_PORTA: Duration = Duration::from_secs(2);
    /// SEGUINDO: quantas vezes o tempo da foto cheia se espera (o piso é `VOLTA_CURTA`).
    const VEZES_DE_SEGUIR: u32 = 12;
    /// SEGUINDO: o máximo que se espera. É o tempo que o desenho pode ficar na tela depois de a
    /// árvore fechar ou andar (só a foto vê isso); o jogo sair da frente é visto antes, nas fatias.
    const TETO_DE_SEGUIR: Duration = Duration::from_secs(1);
    /// A foto pequena tem 1 ponto a cada tantos da área do jogo (referência da visão: 8).
    const REDUCAO: i32 = 8;
    /// Menor área de jogo que vale fotografar (a mesma de `visao::fotografar`).
    const LARGURA_MINIMA: i32 = 640;
    const ALTURA_MINIMA: i32 = 480;
    /// Balde das procuras caras (todos os zooms, ~40 ms em 1080p): 3 fichas, volta 1 a cada 4 s.
    const FICHAS: u32 = 3;
    const REPOSICAO: Duration = Duration::from_secs(4);
    /// Sem ficha, a tentativa de graça (só o zoom de antes, ~12 ms) vale no máximo uma vez a cada tanto.
    const ENTRE_TENTATIVAS_DE_GRACA: Duration = Duration::from_secs(1);
    /// Quantas procuras falhadas seguidas até soltar os buffers e voltar pra PORTA.
    const PROCURAS_FALHADAS: u32 = 3;
    /// Na conferência depois do registro, quanto da base precisa continuar bom. A base são os nós
    /// bons contados por `conferir` na própria foto do registro, com os mesmos tapumes do SEGUINDO
    /// (o `bons` do registro conta também os nós debaixo das partes fixas: não dá pra comparar).
    const FRACAO_PRA_CONFIRMAR: f32 = 0.8;
    /// Seguindo: o encaixe vale com pelo menos esta fração da base, e nunca menos de 8.
    const FRACAO_PRA_VALER: f32 = 0.5;
    const MINIMO_DE_BONS: u32 = 8;
    /// PARANDO: a imagem parou quando menos que esta fração dos pontos mudou entre duas fotos seguidas.
    const FRACAO_PARADA: f32 = 0.02;
    /// PARANDO: quanto tempo se espera a imagem parar. Passou disso (cena escura do jogo que parece
    /// a árvore e não para nunca), solta as memórias grandes e volta pra PORTA.
    const PRAZO_DE_PARANDO: Duration = Duration::from_secs(3);
    /// Quanto tempo o jogo pode ficar fora da frente (o Windows passa um instante sem janela
    /// nenhuma na troca) antes de soltar tudo. O desenho some na hora, de qualquer jeito.
    const TOLERANCIA_FORA: Duration = Duration::from_millis(500);
    /// Menor tempo entre dois avisos pro painel (no máximo ~4 por segundo).
    const ENTRE_AVISOS: Duration = Duration::from_millis(250);
    /// Folga, em pontos, além do raio de fora do nó (o risco fica fora de onde a leitura amostra).
    const FOLGA_DO_RISCO: f32 = 3.0;

    /// A área do cliente da janela do jogo, em pontos da tela.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    struct Area {
        x: i32,
        y: i32,
        largura: i32,
        altura: i32,
    }

    /// Onde o fio está.
    #[derive(Clone, Copy, Debug)]
    enum Fase {
        /// Sem árvore/guia, ou o jogo não está na frente.
        Parado,
        /// Foto pequena de vez em quando, até parecer a tela da árvore.
        Porta,
        /// Foto cheia e procura do encaixe. `direto`: veio de imagem parada, não precisa confirmar.
        Procura { falhas: u32, tentou_zoom: bool, direto: bool },
        /// A árvore está no encaixe: confere, lê e desenha. `referencia` é a base do registro.
        /// `confirmado` falso: registro vindo da porta, que ainda precisa da segunda foto. A primeira
        /// conferência é a confirmação (ver `FRACAO_PRA_CONFIRMAR`) e, se passar, já desenha.
        Seguindo { encaixe: Encaixe, referencia: u32, area: Area, confirmado: bool },
        /// O encaixe deixou de valer (arrasto, zoom, fechou): espera a imagem parar, até um prazo.
        Parando { desde: Instant },
    }

    /// A base serve pra seguir? Com menos que o mínimo o SEGUINDO cairia na primeira conferência.
    fn base_serve(base: u32) -> bool {
        base >= MINIMO_DE_BONS
    }

    /// A segunda foto confirma o encaixe? `base` e `bons` são contados do mesmo jeito (`conferir`).
    fn confirma(base: u32, bons: u32) -> bool {
        bons > 0 && bons as f32 >= FRACAO_PRA_CONFIRMAR * base as f32
    }

    /// Seguindo: o encaixe continua valendo com estes nós bons?
    fn vale(referencia: u32, bons: u32) -> bool {
        bons >= MINIMO_DE_BONS.max((FRACAO_PRA_VALER * referencia as f32).ceil() as u32)
    }

    /// O nó está na tela mas nenhuma foto conseguiu ler: nem esta, nem as de antes. Tem algo por
    /// cima (o disco da ascendência, uma dica do jogo) ou ele não está onde os dados dizem (árvore
    /// de outra versão). Riscar ali seria riscar no escuro. Quem já foi lido alguma vez continua
    /// desenhado mesmo que esta foto não leia (o cursor em cima do nó, na hora de clicar).
    fn nunca_lido(leitura: Option<&Leitura>, sabido: Sabido) -> bool {
        leitura == Some(&Leitura::NaoSei) && sabido == Sabido::Nunca
    }

    /// O que o painel fica sabendo da fase: a árvore está aberta, e em que zoom. Arrastar ou dar
    /// zoom passa por PARANDO e pela procura direta com a árvore ainda na tela (a porta confirma a
    /// cada tique): continua "aberta", com o último zoom, pro painel não pular de lugar.
    fn aberta_e_zoom(fase: &Fase, zoom_anterior: Option<u32>) -> (bool, u32) {
        match *fase {
            Fase::Seguindo { encaixe, confirmado: true, .. } => (true, encaixe.n),
            Fase::Parando { .. } | Fase::Procura { direto: true, .. } => (true, zoom_anterior.unwrap_or(0)),
            Fase::Parado | Fase::Porta | Fase::Procura { .. } | Fase::Seguindo { confirmado: false, .. } => (false, 0),
        }
    }

    /// O jogo é a janela da frente? (Só pergunta ao Windows; duas consultas baratas.)
    fn jogo_na_frente() -> bool {
        let na_frente = jogo::janela_na_frente();
        na_frente != 0 && jogo::classe_da_janela(na_frente) == jogo::CLASSE_DO_JOGO
    }

    /// Tempos medidos por último, pro `diag`.
    #[derive(Clone, Copy, Default)]
    struct Tempos {
        pequena: Duration,
        cheia: Duration,
        registro: Duration,
        leitura: Duration,
    }

    impl Tempos {
        fn diag(&self) -> String {
            format!(
                "porta {} ms · foto {} ms · registro {} ms · leitura {} ms",
                self.pequena.as_millis(),
                self.cheia.as_millis(),
                self.registro.as_millis(),
                self.leitura.as_millis()
            )
        }
    }

    /// Só lê onde está a área do cliente do jogo. Nada é mudado na janela.
    fn area_do_jogo(janela: jogo::Janela) -> Option<Area> {
        let janela = janela as HWND;
        // SAFETY: consultas simples; os ponteiros apontam pra variáveis locais vivas.
        unsafe {
            let mut cliente: RECT = std::mem::zeroed();
            if GetClientRect(janela, &mut cliente) == 0 {
                return None;
            }
            if cliente.right < LARGURA_MINIMA || cliente.bottom < ALTURA_MINIMA {
                return None;
            }
            let mut canto = POINT { x: 0, y: 0 };
            if ClientToScreen(janela, &mut canto) == 0 {
                return None;
            }
            Some(Area { x: canto.x, y: canto.y, largura: cliente.right, altura: cliente.bottom })
        }
    }

    /// Foto da tela composta, na área do jogo, direto pra `imagem` (já em BGRX, sem converter).
    /// Imagem do tamanho da área: cópia ponto a ponto. Menor: 1 ponto a cada `REDUCAO`.
    fn fotografar(area: Area, imagem: &Imagem) -> bool {
        // SAFETY: o contexto da tela é pedido e devolvido aqui; o da imagem é nosso e está vivo.
        unsafe {
            let tela = GetDC(null_mut());
            if tela.is_null() {
                return false;
            }
            let (largura, altura) = (imagem.largura(), imagem.altura());
            let copiou = if largura == area.largura && altura == area.altura {
                BitBlt(imagem.dc(), 0, 0, largura, altura, tela, area.x, area.y, SRCCOPY)
            } else {
                // Sem média entre pontos: pega um a cada tantos, que é barato e é o que a porta espera.
                SetStretchBltMode(imagem.dc(), COLORONCOLOR);
                StretchBlt(
                    imagem.dc(),
                    0,
                    0,
                    largura,
                    altura,
                    tela,
                    area.x,
                    area.y,
                    largura * REDUCAO,
                    altura * REDUCAO,
                    SRCCOPY,
                )
            };
            ReleaseDC(null_mut(), tela);
            copiou != 0
        }
    }

    fn foto_de(imagem: &Imagem) -> Foto<'_> {
        Foto { largura: imagem.largura() as usize, altura: imagem.altura() as usize, bgrx: imagem.pontos() }
    }

    /// Onde o painel do guia está na tela (só leitura de uma janela nossa).
    fn retangulo_da_janela(janela: jogo::Janela) -> Option<(i32, i32, i32, i32)> {
        if janela == 0 {
            return None;
        }
        // SAFETY: consulta simples; o ponteiro aponta pra uma variável local viva.
        unsafe {
            let mut r: RECT = std::mem::zeroed();
            (GetWindowRect(janela as HWND, &mut r) != 0).then_some((r.left, r.top, r.right, r.bottom))
        }
    }

    /// A árvore, o guia e o roteiro com que o fio está trabalhando nesta volta.
    struct Dados {
        arvore: Arc<Arvore>,
        guia: Arc<GuiaRecebido>,
        roteiro: Arc<Roteiro>,
    }

    /// O que foi pra tela por último (pra só redesenhar quando muda).
    #[derive(PartialEq)]
    struct Desenhado {
        area: Area,
        tapumes: Vec<Tapume>,
        cena: Cena,
    }

    struct Fio {
        app: AppHandle,
        /// A janela do painel do guia (0 enquanto não foi achada).
        painel: jogo::Janela,
        versao: Option<u64>,
        arvore: Option<Arc<Arvore>>,
        guia: Option<Arc<GuiaRecebido>>,
        roteiro: Option<Arc<Roteiro>>,
        memoria: Memoria,
        resumo: Resumo,
        fase: Fase,
        /// Foto 1/8 (pequena: fica enquanto o jogo está na frente).
        pequena: Option<Imagem>,
        /// Cópia da foto pequena anterior, pra saber se a imagem parou.
        anterior: Vec<u8>,
        /// Foto cheia (grande: só existe com a árvore aberta).
        cheia: Option<Imagem>,
        desenho: Option<JanelaDoDesenho>,
        desenhado: Option<Desenhado>,
        leituras: Vec<Leitura>,
        /// Frase pro painel quando a janela do desenho não pôde ser criada. Com ela não se desenha,
        /// até a árvore fechar (`soltar`): na próxima vez que abrir, tenta-se criar de novo.
        aviso: Option<String>,
        balde: Balde,
        /// Quando a porta entrou na procura sem ficha pela última vez.
        ultima_de_graca: Option<Instant>,
        ultima_volta: Instant,
        fora_desde: Option<Instant>,
        zoom_anterior: Option<u32>,
        /// A última espera do SEGUINDO foi a curta, por nó em dúvida (ver `espera_de_seguir`).
        ultima_foi_rapida: bool,
        tempos: Tempos,
        /// O último aviso mandado pro painel (sem o `diag`, que muda a cada foto).
        publicada: SituacaoDaArvore,
        publicada_em: Option<Instant>,
        /// O guia ou a árvore trocaram: manda o aviso mesmo que o conteúdo seja igual.
        avisar_de_novo: bool,
    }

    impl Fio {
        fn novo(app: AppHandle) -> Fio {
            Fio {
                app,
                painel: 0,
                versao: None,
                arvore: None,
                guia: None,
                roteiro: None,
                memoria: Memoria::nova(),
                resumo: Resumo::default(),
                fase: Fase::Parado,
                pequena: None,
                anterior: Vec::new(),
                cheia: None,
                desenho: None,
                desenhado: None,
                leituras: Vec::new(),
                aviso: None,
                balde: Balde::novo(FICHAS, REPOSICAO),
                ultima_de_graca: None,
                ultima_volta: Instant::now(),
                fora_desde: None,
                zoom_anterior: None,
                ultima_foi_rapida: false,
                tempos: Tempos::default(),
                publicada: SituacaoDaArvore::default(),
                publicada_em: None,
                avisar_de_novo: false,
            }
        }

        /// Uma volta do laço. Devolve quanto dormir até a próxima.
        fn volta(&mut self) -> Duration {
            atender_recados();
            let agora = Instant::now();
            self.balde.passar(agora.saturating_duration_since(self.ultima_volta));
            self.ultima_volta = agora;
            self.atualizar();
            let dormir = self.andar();
            self.publicar();
            dormir
        }

        /// Pega a árvore e o guia novos, se o painel trocou algum.
        fn atualizar(&mut self) {
            if self.versao == Some(versao_de_agora()) {
                return;
            }
            let (versao, arvore, guia) = combinado_de_agora();
            let mesma_arvore = match (&self.arvore, &arvore) {
                (Some(antiga), Some(nova)) => Arc::ptr_eq(antiga, nova),
                (None, None) => true,
                _ => false,
            };
            if !mesma_arvore {
                // O encaixe e as leituras eram da árvore antiga.
                self.parar();
            }
            self.roteiro = match (&arvore, &guia) {
                (Some(arvore), Some(guia)) => {
                    self.memoria.preparar(&guia.build, arvore.ids.len());
                    Some(Arc::new(Roteiro::novo(arvore, guia)))
                }
                _ => None,
            };
            self.resumo = self.roteiro.as_ref().map(|roteiro| resumir(&self.memoria, roteiro)).unwrap_or_default();
            self.arvore = arvore;
            self.guia = guia;
            self.versao = Some(versao);
            self.desenhado = None;
            self.avisar_de_novo = true;
        }

        fn andar(&mut self) -> Duration {
            let (Some(arvore), Some(guia), Some(roteiro)) = (self.arvore.clone(), self.guia.clone(), self.roteiro.clone())
            else {
                self.parar();
                return VOLTA_PARADA;
            };
            let dados = Dados { arvore, guia, roteiro };
            let na_frente = jogo::janela_na_frente();
            let no_jogo = na_frente != 0 && jogo::classe_da_janela(na_frente) == jogo::CLASSE_DO_JOGO;
            if !no_jogo {
                // O desenho some na hora; os buffers esperam um pouco, pro alt-tab rápido não custar uma procura.
                self.esconder();
                let desde = *self.fora_desde.get_or_insert_with(Instant::now);
                if matches!(self.fase, Fase::Parado) || desde.elapsed() >= TOLERANCIA_FORA {
                    self.parar();
                    return VOLTA_PARADA;
                }
                return VOLTA_CURTA;
            }
            self.fora_desde = None;
            let Some(area) = area_do_jogo(na_frente) else {
                self.parar();
                return VOLTA_PARADA;
            };
            if matches!(self.fase, Fase::Parado) {
                self.fase = Fase::Porta;
            }
            match self.fase {
                Fase::Parado | Fase::Porta => self.porta(area, &dados),
                Fase::Procura { falhas, tentou_zoom, direto } => {
                    self.procurar(area, &dados, falhas, tentou_zoom, direto, false)
                }
                Fase::Seguindo { encaixe, referencia, area: area_do_encaixe, confirmado } => {
                    self.seguir(area, area_do_encaixe, encaixe, referencia, confirmado, &dados)
                }
                Fase::Parando { desde } => self.parando(area, desde, &dados),
            }
        }

        fn espera_da_porta(&self) -> Duration {
            espera(PISO_DA_PORTA, VEZES_DA_PORTA, self.tempos.pequena, TETO_DA_PORTA)
        }

        /// Tira a foto pequena e diz se ela parece a tela da árvore. `None` se a foto falhou.
        fn olhar_pela_porta(&mut self, area: Area) -> Option<bool> {
            let (largura, altura) = (area.largura / REDUCAO, area.altura / REDUCAO);
            let serve = self.pequena.as_ref().is_some_and(|p| p.largura() == largura && p.altura() == altura);
            if !serve {
                self.pequena = None;
                self.pequena = Imagem::nova(largura, altura);
            }
            let pequena = self.pequena.as_ref()?;
            let inicio = Instant::now();
            let tirou = fotografar(area, pequena);
            self.tempos.pequena = inicio.elapsed();
            tirou.then(|| parece_arvore(&foto_de(pequena)))
        }

        /// Tira a foto cheia (criando o buffer se preciso). `false` se não deu.
        fn fotografar_cheia(&mut self, area: Area) -> bool {
            let serve = self.cheia.as_ref().is_some_and(|c| c.largura() == area.largura && c.altura() == area.altura);
            if !serve {
                self.cheia = None;
                self.cheia = Imagem::nova(area.largura, area.altura);
            }
            let Some(cheia) = self.cheia.as_ref() else { return false };
            let inicio = Instant::now();
            let tirou = fotografar(area, cheia);
            self.tempos.cheia = inicio.elapsed();
            tirou
        }

        fn porta(&mut self, area: Area, dados: &Dados) -> Duration {
            match self.olhar_pela_porta(area) {
                None => VOLTA_PARADA,
                Some(true) => {
                    // Sem ficha e sem zoom de antes, os buffers grandes ficariam à toa: espera.
                    let desde = self.ultima_de_graca.map(|quando| quando.elapsed());
                    let como = como_procurar(
                        self.balde.tem(),
                        self.zoom_anterior.is_some(),
                        desde,
                        ENTRE_TENTATIVAS_DE_GRACA,
                    );
                    match como {
                        None => self.espera_da_porta(),
                        Some(como) => {
                            if como == ComoProcura::DeGraca {
                                self.ultima_de_graca = Some(Instant::now());
                            }
                            // Já nesta volta: a foto pequena acabou de ver a árvore.
                            self.procurar(area, dados, 0, false, false, true)
                        }
                    }
                }
                Some(false) => self.espera_da_porta(),
            }
        }

        /// Solta os buffers grandes e volta pra PORTA.
        fn voltar_pra_porta(&mut self) -> Duration {
            self.soltar();
            self.fase = Fase::Porta;
            self.espera_da_porta()
        }

        /// `ja_olhou`: a foto pequena desta mesma volta já viu a árvore (vindo da PORTA ou do
        /// PARANDO); sem isso, a porta olha de novo antes da foto cheia.
        fn procurar(
            &mut self,
            area: Area,
            dados: &Dados,
            mut falhas: u32,
            mut tentou_zoom: bool,
            direto: bool,
            ja_olhou: bool,
        ) -> Duration {
            let viu = ja_olhou || self.olhar_pela_porta(area) == Some(true);
            if !viu || !self.fotografar_cheia(area) {
                return self.voltar_pra_porta();
            }
            let arvore = &*dados.arvore;
            // Os mesmos tapumes do SEGUINDO: a base, a confirmação e o seguir contam os mesmos nós.
            let tapumes = self.tapumes(area);
            let mut achado: Option<(Encaixe, u32)> = None;
            let mut sem_ficha = false;
            {
                let Some(cheia) = self.cheia.as_ref() else { return VOLTA_CURTA };
                let foto = foto_de(cheia);
                let inicio = Instant::now();
                // A base do registro: os nós bons na mesma foto, contados como o SEGUINDO conta.
                // Base pequena demais é registro que não serve (conta como procura falhada).
                let com_base = |registro: Registro| -> Option<(Encaixe, u32)> {
                    let base = conferir(&foto, arvore, &registro.encaixe, &tapumes).bons;
                    base_serve(base).then_some((registro.encaixe, base))
                };
                if !tentou_zoom {
                    // Primeiro o zoom em que a árvore estava da última vez: é barato e quase sempre acerta.
                    tentou_zoom = true;
                    if let Some(zoom) = self.zoom_anterior {
                        achado = registrar(&foto, arvore, Some(zoom)).filter(|registro| registro.aceito).and_then(com_base);
                    }
                }
                if achado.is_none() {
                    if self.balde.gastar() {
                        achado = registrar(&foto, arvore, None).filter(|registro| registro.aceito).and_then(com_base);
                        if achado.is_none() {
                            falhas += 1;
                        }
                    } else {
                        sem_ficha = true;
                    }
                }
                self.tempos.registro = inicio.elapsed();
                if let Some((encaixe, _)) = achado {
                    // A primeira leitura sai desta mesma foto. Vinda da porta, ela fica guardada em
                    // `leituras` e só vai pra memória quando a segunda foto confirmar o encaixe.
                    let inicio = Instant::now();
                    ler(&foto, arvore, &encaixe, &tapumes, &mut self.leituras);
                    self.tempos.leitura = inicio.elapsed();
                }
            }
            match achado {
                Some((encaixe, base)) if direto => {
                    // Imagem parada: o registro já vale. Anota e desenha com esta mesma foto.
                    self.fase = Fase::Seguindo { encaixe, referencia: base, area, confirmado: true };
                    self.zoom_anterior = Some(encaixe.n);
                    self.desenhado = None;
                    self.anotar_e_desenhar(area, encaixe, dados, tapumes);
                    self.espera_de_seguir()
                }
                Some((encaixe, base)) => {
                    self.fase = Fase::Seguindo { encaixe, referencia: base, area, confirmado: false };
                    self.desenhado = None;
                    ENTRE_AS_DUAS_FOTOS
                }
                None if sem_ficha || falhas >= PROCURAS_FALHADAS => self.voltar_pra_porta(),
                None => {
                    self.fase = Fase::Procura { falhas, tentou_zoom, direto };
                    VOLTA_CURTA
                }
            }
        }

        /// O encaixe deixou de valer: o desenho some na hora e espera-se a imagem parar.
        fn perder_o_encaixe(&mut self) -> Duration {
            self.esconder();
            self.anterior.clear();
            self.fase = Fase::Parando { desde: Instant::now() };
            VOLTA_CURTA
        }

        fn seguir(
            &mut self,
            area: Area,
            area_do_encaixe: Area,
            encaixe: Encaixe,
            referencia: u32,
            confirmado: bool,
            dados: &Dados,
        ) -> Duration {
            // A janela do jogo mudou de tamanho: o encaixe era de outra foto. (Só mudar de lugar não estraga.)
            let mesmo_tamanho = area.largura == area_do_encaixe.largura && area.altura == area_do_encaixe.altura;
            if !mesmo_tamanho || !self.fotografar_cheia(area) {
                return self.perder_o_encaixe();
            }
            let arvore = &*dados.arvore;
            let tapumes = self.tapumes(area);
            let bons = {
                let Some(cheia) = self.cheia.as_ref() else { return self.perder_o_encaixe() };
                conferir(&foto_de(cheia), arvore, &encaixe, &tapumes).bons
            };
            if !confirmado {
                // Segunda foto depois do registro vindo da porta: a árvore continua no mesmo lugar?
                if !confirma(referencia, bons) {
                    // Não (arrastando, ou não era a árvore): nada foi desenhado; procura de novo.
                    self.fase = Fase::Procura { falhas: 1, tentou_zoom: true, direto: false };
                    return VOLTA_CURTA;
                }
                // Confirmado: a leitura da foto do registro (ainda em `leituras`) entra na memória
                // antes da desta, e a árvore vista pela primeira vez já tem as duas.
                self.memoria.anotar(arvore, dados.roteiro.inicio.map(|posicao| posicao as usize), &self.leituras);
                self.zoom_anterior = Some(encaixe.n);
                self.fase = Fase::Seguindo { encaixe, referencia, area: area_do_encaixe, confirmado: true };
            } else if !vale(referencia, bons) {
                return self.perder_o_encaixe();
            }
            {
                let Some(cheia) = self.cheia.as_ref() else { return self.perder_o_encaixe() };
                let inicio = Instant::now();
                ler(&foto_de(cheia), arvore, &encaixe, &tapumes, &mut self.leituras);
                self.tempos.leitura = inicio.elapsed();
            }
            self.anotar_e_desenhar(area, encaixe, dados, tapumes);
            self.espera_de_seguir()
        }

        /// Junta a leitura que está em `leituras` à memória e, com a árvore já vista nesta build,
        /// desenha.
        fn anotar_e_desenhar(&mut self, area: Area, encaixe: Encaixe, dados: &Dados, tapumes: Vec<Tapume>) {
            let roteiro = &*dados.roteiro;
            self.memoria.anotar(&dados.arvore, roteiro.inicio.map(|posicao| posicao as usize), &self.leituras);
            // Na primeira vez que a build vê a árvore, com uma foto só nenhum nó é sabido (são
            // precisas `LEITURAS_PRA_SABER`): o resumo sairia da memória vazia e o desenho poria os
            // números em nós já alocados. Espera-se a segunda (que vem logo: ver `espera_de_seguir`).
            // Depois disso a memória já conhece os nós, e a árvore reaberta (ou arrastada) é
            // desenhada logo na primeira foto do encaixe; um nó pego com a árvore fechada é
            // corrigido na foto seguinte.
            if self.memoria.vista() {
                self.resumo = resumir(&self.memoria, roteiro);
                self.desenhar(area, encaixe, &dados.arvore, &dados.guia, roteiro, tapumes);
            }
        }

        /// Quanto esperar até a próxima foto do SEGUINDO. Com nó em dúvida (uma foto viu mudança e
        /// falta a que confirma), a próxima vem no tique curto: o ponto pego aparece sem esperar a
        /// volta inteira. Duas curtas seguidas não: um nó que pisca sem parar (reflexo, cursor) não
        /// prende o fio no ritmo curto.
        fn espera_de_seguir(&mut self) -> Duration {
            let rapida = !self.ultima_foi_rapida && self.memoria.em_duvida();
            self.ultima_foi_rapida = rapida;
            if rapida {
                VOLTA_CURTA
            } else {
                espera(VOLTA_CURTA, VEZES_DE_SEGUIR, self.tempos.cheia, TETO_DE_SEGUIR)
            }
        }

        fn parando(&mut self, area: Area, desde: Instant, dados: &Dados) -> Duration {
            // Fechou a árvore (ou a foto falhou): a imagem do jogo nunca para; quem decide é a porta.
            if self.olhar_pela_porta(area) != Some(true) {
                return self.voltar_pra_porta();
            }
            // A porta só vê "tela escura": uma cena escura do jogo passa por ela e não para nunca.
            // Sem prazo, as memórias grandes ficariam presas com a árvore fechada.
            if desde.elapsed() >= PRAZO_DE_PARANDO {
                return self.voltar_pra_porta();
            }
            let Some(pequena) = self.pequena.as_ref() else { return self.voltar_pra_porta() };
            let foto = foto_de(pequena);
            let parou = self.anterior.len() == foto.bgrx.len() && {
                let antes = Foto { largura: foto.largura, altura: foto.altura, bgrx: &self.anterior };
                fracao_que_mudou(&antes, &foto) < FRACAO_PARADA
            };
            self.anterior.clear();
            self.anterior.extend_from_slice(foto.bgrx);
            if parou {
                // Imagem parada: procura já, nesta volta, e o primeiro registro aceito mostra o
                // desenho (mesmo zoom primeiro).
                return self.procurar(area, dados, 0, false, true, true);
            }
            VOLTA_CURTA
        }

        /// O que tapa a árvore na foto: o painel do guia, quando está à vista. (As partes fixas da
        /// interface do jogo a visão já conhece.)
        fn tapumes(&mut self, area: Area) -> Vec<Tapume> {
            let mut tapumes = Vec::new();
            let Some(estado) = self.app.try_state::<Estado>() else { return tapumes };
            if !estado.visivel() {
                return tapumes;
            }
            if self.painel == 0 {
                self.painel = crate::janela::principal(&self.app)
                    .and_then(|janela| janela.hwnd().ok())
                    .map(|hwnd| hwnd.0 as isize)
                    .unwrap_or(0);
            }
            if let Some(painel) = retangulo_da_janela(self.painel) {
                tapumes.extend(tapume_na_foto(painel, (area.x, area.y), area.largura, area.altura));
            }
            tapumes
        }

        /// Monta a cena e manda pra janela, só se mudou.
        fn desenhar(
            &mut self,
            area: Area,
            encaixe: Encaixe,
            arvore: &Arvore,
            guia: &GuiaRecebido,
            roteiro: &Roteiro,
            tapumes: Vec<Tapume>,
        ) {
            // Sem a janela fora das fotos, nunca se desenha: o guia leria o próprio desenho.
            if self.aviso.is_some() {
                return;
            }
            let (largura, altura) = (area.largura as f32, area.altura as f32);
            let proibido = |x: f32, y: f32| -> bool {
                zona_fixa(x, y, largura, altura, 0.0)
                    || tapumes.iter().any(|t| x >= t.x0 && x < t.x1 && y >= t.y0 && y < t.y1)
            };
            let cena = {
                let leituras = &self.leituras;
                let memoria = &self.memoria;
                // `so_lido`: o nó só é desenhado se alguma foto já o leu (vale pros passos e pros
                // nós a devolver; o início da classe nunca é lido e só serve de ponta de linha).
                let lugar = |posicao: u32, so_lido: bool| -> Option<Lugar> {
                    let posicao = posicao as usize;
                    let (x, y) = (*arvore.xs.get(posicao)?, *arvore.ys.get(posicao)?);
                    let tipo = *arvore.tipos.get(posicao)?;
                    let leitura = leituras.get(posicao);
                    Some(Lugar {
                        x: encaixe.s * x + encaixe.tx,
                        y: encaixe.s * y + encaixe.ty,
                        raio: raio_de_fora(tipo) * encaixe.s + FOLGA_DO_RISCO,
                        tapado: leitura == Some(&Leitura::Tapado)
                            || (so_lido && nunca_lido(leitura, memoria.sabido(posicao))),
                        maestria: tipo == MAESTRIA,
                    })
                };
                let lugares: Vec<Option<Lugar>> =
                    roteiro.passos.iter().map(|passo| passo.and_then(|posicao| lugar(posicao, true))).collect();
                let devolver: Vec<Lugar> = roteiro
                    .devolver
                    .iter()
                    .filter(|(id, _)| self.resumo.devolver.contains(id))
                    .filter_map(|(_, posicao)| lugar(*posicao, true))
                    .collect();
                // A foto cheia ainda é a desta volta, a mesma que acabou de ser lida.
                let foto = self.cheia.as_ref().map(foto_de);
                let dica_do_jogo =
                    |retangulo| foto.as_ref().is_some_and(|foto| dica_no_retangulo(foto, retangulo, &proibido));
                let entrada = Entrada {
                    largura,
                    altura,
                    guia,
                    lugares: &lugares,
                    inicio: roteiro.inicio.and_then(|posicao| lugar(posicao, false)),
                    feito: &self.resumo.feito,
                    proximos: &self.resumo.proximos,
                    faltam: self.resumo.total.saturating_sub(self.resumo.feitos),
                    devolver: &devolver,
                    dica_do_jogo: &dica_do_jogo,
                };
                montar_cena(&entrada, &proibido)
            };
            let na_tela = self.desenho.as_ref().is_some_and(|janela| janela.na_tela());
            let igual = self
                .desenhado
                .as_ref()
                .is_some_and(|antes| antes.area == area && antes.tapumes == tapumes && antes.cena == cena);
            if na_tela && igual {
                return;
            }
            if self.desenho.is_none() {
                match JanelaDoDesenho::criar() {
                    Ok(janela) => self.desenho = Some(janela),
                    Err(frase) => {
                        self.aviso = Some(frase);
                        return;
                    }
                }
            }
            let Some(janela) = self.desenho.as_mut() else { return };
            let mostrou = janela.mostrar(area.x, area.y, area.largura, area.altura, &cena, &proibido);
            if !mostrou {
                janela.esconder();
            }
            self.desenhado = mostrou.then_some(Desenhado { area, tapumes, cena });
        }

        /// Tira o desenho da tela (a janela e os buffers ficam).
        fn esconder(&mut self) {
            if let Some(janela) = self.desenho.as_mut() {
                janela.esconder();
            }
            self.desenhado = None;
        }

        /// O desenho está na tela agora?
        fn desenho_na_tela(&self) -> bool {
            self.desenho.as_ref().is_some_and(|janela| janela.na_tela())
        }

        /// A árvore fechou: destrói a janela do desenho e solta as memórias grandes.
        fn soltar(&mut self) {
            self.desenho = None;
            self.desenhado = None;
            // A falha ao criar a janela pode ter sido passageira: na próxima vez que a árvore abrir,
            // tenta-se de novo (uma vez por abertura; se for de vez, o aviso volta sozinho).
            self.aviso = None;
            self.cheia = None;
            self.leituras = Vec::new();
            self.anterior = Vec::new();
        }

        /// Sem guia ou sem o jogo na frente: solta tudo, até a foto pequena.
        fn parar(&mut self) {
            self.soltar();
            self.pequena = None;
            self.fase = Fase::Parado;
        }

        /// Avisa o painel, só quando o conteúdo muda (o `diag` vai junto, mas não conta como mudança).
        fn publicar(&mut self) {
            let (aberta, zoom) = aberta_e_zoom(&self.fase, self.zoom_anterior);
            crate::arvore::anotar_aberta(aberta);
            // De qual guia é a situação: o resumo e o guia trocam juntos em `atualizar`.
            let (build, ate_alvo, passos) = match &self.guia {
                Some(guia) => (guia.build.clone(), guia.ate_alvo, guia.ordem.len() as u32),
                None => (String::new(), 0, 0),
            };
            let nova = SituacaoDaArvore {
                build,
                ate_alvo,
                passos,
                aberta,
                vista: self.roteiro.is_some() && self.memoria.vista(),
                zoom,
                feitos: self.resumo.feitos,
                total: self.resumo.total,
                proximos: self.resumo.proximos.clone(),
                devolver: self.resumo.devolver.clone(),
                aviso: self.aviso.clone(),
                diag: None,
            };
            if nova == self.publicada && !self.avisar_de_novo {
                return;
            }
            if self.publicada_em.is_some_and(|quando| quando.elapsed() < ENTRE_AVISOS) {
                return;
            }
            let mut enviada = nova.clone();
            enviada.diag = Some(self.tempos.diag());
            let _ = self.app.emit("arvore", enviada);
            self.publicada = nova;
            self.publicada_em = Some(Instant::now());
            self.avisar_de_novo = false;
        }
    }

    pub fn laco(app: AppHandle) {
        let mut fio = Fio::novo(app);
        loop {
            let dormir = fio.volta();
            if fio.desenho_na_tela() {
                // Com o desenho à vista, dorme em fatias: se o jogo sair da frente no meio do sono, o
                // desenho some já (e não só na volta seguinte) e a volta roda em seguida.
                dormir_em_fatias(dormir, VOLTA_CURTA, sleep, || {
                    atender_recados();
                    let segue = jogo_na_frente();
                    if !segue {
                        fio.esconder();
                    }
                    segue
                });
            } else {
                sleep(dormir);
            }
        }
    }

    /// A foto de verdade, sem jogo: a tela inteira do monitor principal vira "área do jogo".
    /// Só lê a tela; não cria janela nenhuma.
    #[cfg(test)]
    mod testes {
        use super::*;

        #[test]
        fn foto_cheia_e_pequena_saem_do_tamanho_certo() {
            let area = Area { x: 0, y: 0, largura: 640, altura: 480 };
            let cheia = Imagem::nova(area.largura, area.altura).unwrap();
            let pequena = Imagem::nova(area.largura / REDUCAO, area.altura / REDUCAO).unwrap();
            // Numa sessão sem tela (serviço, CI) o Windows pode recusar a cópia: aí não há o que provar.
            if !fotografar(area, &cheia) || !fotografar(area, &pequena) {
                return;
            }
            let foto = foto_de(&cheia);
            assert_eq!((foto.largura, foto.altura, foto.bgrx.len()), (640, 480, 640 * 480 * 4));
            let foto = foto_de(&pequena);
            assert_eq!((foto.largura, foto.altura, foto.bgrx.len()), (80, 60, 80 * 60 * 4));
            // Duas fotos pequenas da mesma área têm o mesmo tamanho: dá pra comparar.
            let copia = foto.bgrx.to_vec();
            let antes = Foto { largura: 80, altura: 60, bgrx: &copia };
            assert!((0.0..=1.0).contains(&fracao_que_mudou(&antes, &foto)));
        }

        /// Quanto custam a foto cheia e a pequena da tela de verdade (do canto do monitor principal),
        /// em três tamanhos. Só com a bancada ligada (`GUIA_BANCADA_TELAS`).
        #[test]
        fn bancada_tempo_da_foto_da_tela() {
            if std::env::var_os("GUIA_BANCADA_TELAS").is_none() {
                return;
            }
            for (largura, altura) in [(1920, 1080), (2560, 1440), (1280, 720)] {
                let area = Area { x: 0, y: 0, largura, altura };
                let cheia = Imagem::nova(largura, altura).unwrap();
                let pequena = Imagem::nova(largura / REDUCAO, altura / REDUCAO).unwrap();
                let mut t = [0f64; 2];
                for _ in 0..20 {
                    let i = Instant::now();
                    fotografar(area, &cheia);
                    t[0] += i.elapsed().as_secs_f64() * 50.0;
                    let i = Instant::now();
                    fotografar(area, &pequena);
                    t[1] += i.elapsed().as_secs_f64() * 50.0;
                }
                println!("{largura}x{altura}: cheia {:.1} ms, pequena {:.1} ms", t[0], t[1]);
            }
        }

        /// Um guia inventado a partir da leitura de uma foto, pra bancada do desenho: os alocados
        /// ligados ao início da classe são os passos feitos, e depois vêm caminhos (pelos nós livres
        /// e à vista) até os notáveis livres mais perto, como uma build de verdade.
        fn guia_inventado(arvore: &Arvore, leituras: &[Leitura], encaixe: &Encaixe, largura: f32, altura: f32) -> Option<GuiaRecebido> {
            use crate::arvore::PassoRecebido;
            use arvore_visao::{INICIO, NOTAVEL};
            use std::collections::{HashMap, VecDeque};
            let n = arvore.ids.len();
            let alocado = |p: usize| leituras.get(p) == Some(&Leitura::Alocado);
            let livre = |p: usize| leituras.get(p) == Some(&Leitura::Livre);
            let na_tela = |p: usize| {
                let (x, y) = (encaixe.s * arvore.xs[p] + encaixe.tx, encaixe.s * arvore.ys[p] + encaixe.ty);
                x > 0.0 && y > 0.0 && x < largura && y < altura
            };
            let vizinhos = |p: usize| arvore.vizinhos[p].iter().map(|v| *v as usize);
            let inicios: Vec<usize> = (0..n).filter(|p| arvore.tipos[*p] == INICIO).collect();
            let inicio = inicios.iter().copied().find(|p| vizinhos(*p).any(alocado)).or_else(|| {
                let (cx, cy) = (largura / 2.0, altura / 2.0);
                inicios.iter().copied().filter(|p| na_tela(*p)).min_by(|a, b| {
                    let d = |p: usize| {
                        let (x, y) = (encaixe.s * arvore.xs[p] + encaixe.tx, encaixe.s * arvore.ys[p] + encaixe.ty);
                        (x - cx).powi(2) + (y - cy).powi(2)
                    };
                    d(*a).total_cmp(&d(*b))
                })
            })?;
            let mut ordem: Vec<PassoRecebido> = Vec::new();
            let mut passo_de: HashMap<usize, usize> = HashMap::new();
            let pai_de = |passo_de: &HashMap<usize, usize>, p: usize| passo_de.get(&p).map_or(-1, |passo| *passo as i32);
            let novo_passo = |ordem: &mut Vec<PassoRecebido>, passo_de: &mut HashMap<usize, usize>, p: usize, de: usize| {
                let pai = pai_de(passo_de, de);
                let maestria = arvore.tipos[p] == MAESTRIA;
                passo_de.insert(p, ordem.len());
                ordem.push(PassoRecebido {
                    no: arvore.ids[p],
                    pai,
                    nome: format!("Nó {}", arvore.ids[p]),
                    rotulo: maestria.then(|| "+50 to maximum Life".to_string()),
                    solto: false,
                });
            };
            // Os feitos: a partir do início, pelos alocados.
            let mut fila = VecDeque::from([inicio]);
            let mut visto = vec![false; n];
            visto[inicio] = true;
            while let Some(p) = fila.pop_front() {
                for v in vizinhos(p) {
                    if !visto[v] && alocado(v) {
                        visto[v] = true;
                        novo_passo(&mut ordem, &mut passo_de, v, p);
                        fila.push_back(v);
                    }
                }
            }
            // Os que faltam: até 4 notáveis, no máximo ~30 passos.
            let feitos = ordem.len();
            for _ in 0..4 {
                if ordem.len() - feitos >= 30 {
                    break;
                }
                let mut de = vec![usize::MAX; n];
                // Na ordem dos passos (a do `HashMap` muda a cada vez e o guia sairia outro).
                let mut sementes: Vec<(usize, usize)> = passo_de.iter().map(|(p, passo)| (*passo, *p)).collect();
                sementes.sort_unstable();
                let mut fila: VecDeque<usize> = std::iter::once(inicio).chain(sementes.into_iter().map(|(_, p)| p)).collect();
                for p in &fila {
                    de[*p] = *p;
                }
                let mut alvo = None;
                while let Some(p) = fila.pop_front() {
                    if arvore.tipos[p] == NOTAVEL && !passo_de.contains_key(&p) && p != inicio {
                        alvo = Some(p);
                        break;
                    }
                    for v in vizinhos(p) {
                        if de[v] == usize::MAX && livre(v) && na_tela(v) && arvore.tipos[v] != INICIO {
                            de[v] = p;
                            fila.push_back(v);
                        }
                    }
                }
                let Some(alvo) = alvo else { break };
                let mut caminho = vec![alvo];
                while let Some(&p) = caminho.last() {
                    let antes = de[p];
                    if antes == p || passo_de.contains_key(&antes) || antes == inicio {
                        break;
                    }
                    caminho.push(antes);
                }
                caminho.reverse();
                for p in caminho {
                    let antes = de[p];
                    novo_passo(&mut ordem, &mut passo_de, p, antes);
                }
            }
            (ordem.len() > feitos).then(|| GuiaRecebido {
                build: "bancada".into(),
                inicio: arvore.ids[inicio],
                ate_alvo: ordem.len() as u32,
                ordem,
                manter: Vec::new(),
                devolver: Vec::new(),
                texto: "Árvore até Act 3".into(),
                numerados: 8,
            })
        }

        /// O desenho do guia por cima de fotos reais da árvore, em JPG na pasta de cima da bancada
        /// (`desenho-<rótulo>-<foto>.jpg`; o rótulo vem de `GUIA_BANCADA_DESENHO`, "agora" sem ele).
        /// Só com a bancada ligada (`GUIA_BANCADA_TELAS`). As fotos não vão pro repositório.
        #[test]
        fn bancada_desenho_da_arvore() {
            use crate::arvore::janela::pintar_na_memoria;
            let Some(pasta) = crate::bancada::pasta() else { return };
            let rotulo = std::env::var("GUIA_BANCADA_DESENHO").unwrap_or_else(|_| "agora".into());
            let saida = pasta.parent().unwrap_or(&pasta).to_path_buf();
            let arvore = crate::bancada::arvore_do_app();
            for q in crate::bancada::quadros(&pasta, &["arvore"]) {
                let (largura, altura) = (q.foto.largura, q.foto.altura);
                let bgrx: Vec<u8> = q.foto.rgb.chunks_exact(3).flat_map(|p| [p[2], p[1], p[0], 0]).collect();
                let foto = Foto { largura, altura, bgrx: &bgrx };
                let Some(registro) = registrar(&foto, &arvore, None).filter(|r| r.aceito) else {
                    println!("{}: árvore não achada", q.nome);
                    continue;
                };
                let encaixe = registro.encaixe;
                let mut leituras = Vec::new();
                ler(&foto, &arvore, &encaixe, &[], &mut leituras);
                let (l, a) = (largura as f32, altura as f32);
                let Some(guia) = guia_inventado(&arvore, &leituras, &encaixe, l, a) else {
                    println!("{}: sem caminho pra inventar guia", q.nome);
                    continue;
                };
                let roteiro = Roteiro::novo(&arvore, &guia);
                let mut memoria = Memoria::nova();
                memoria.preparar(&guia.build, arvore.ids.len());
                let inicio = roteiro.inicio.map(|p| p as usize);
                memoria.anotar(&arvore, inicio, &leituras);
                memoria.anotar(&arvore, inicio, &leituras);
                let resumo = resumir(&memoria, &roteiro);
                // Igual a `desenhar`.
                let lugar = |posicao: u32, so_lido: bool| -> Option<Lugar> {
                    let posicao = posicao as usize;
                    let (x, y) = (*arvore.xs.get(posicao)?, *arvore.ys.get(posicao)?);
                    let tipo = *arvore.tipos.get(posicao)?;
                    let leitura = leituras.get(posicao);
                    Some(Lugar {
                        x: encaixe.s * x + encaixe.tx,
                        y: encaixe.s * y + encaixe.ty,
                        raio: raio_de_fora(tipo) * encaixe.s + FOLGA_DO_RISCO,
                        tapado: leitura == Some(&Leitura::Tapado)
                            || (so_lido && nunca_lido(leitura, memoria.sabido(posicao))),
                        maestria: tipo == MAESTRIA,
                    })
                };
                let lugares: Vec<Option<Lugar>> =
                    roteiro.passos.iter().map(|passo| passo.and_then(|posicao| lugar(posicao, true))).collect();
                let proibido = |x: f32, y: f32| zona_fixa(x, y, l, a, 0.0);
                let dica_do_jogo = |retangulo| dica_no_retangulo(&foto, retangulo, &proibido);
                let entrada = Entrada {
                    largura: l,
                    altura: a,
                    guia: &guia,
                    lugares: &lugares,
                    inicio: roteiro.inicio.and_then(|posicao| lugar(posicao, false)),
                    feito: &resumo.feito,
                    proximos: &resumo.proximos,
                    faltam: resumo.total.saturating_sub(resumo.feitos),
                    devolver: &[],
                    dica_do_jogo: &dica_do_jogo,
                };
                let cena = montar_cena(&entrada, &proibido);
                let pintado = pintar_na_memoria(largura as i32, altura as i32, &cena, &proibido).unwrap();
                let rgb: Vec<u8> = q
                    .foto
                    .rgb
                    .chunks_exact(3)
                    .zip(pintado.chunks_exact(4))
                    .flat_map(|(f, d)| {
                        let resto = 255 - d[3] as u32;
                        [2usize, 1, 0].map(|c| (d[c] as u32 + (f[2 - c] as u32 * resto + 127) / 255).min(255) as u8)
                    })
                    .collect();
                let arquivo = saida.join(format!("desenho-{rotulo}-{}.jpg", q.nome));
                jpeg_encoder::Encoder::new_file(&arquivo, 88)
                    .and_then(|j| j.encode(&rgb, largura as u16, altura as u16, jpeg_encoder::ColorType::Rgb))
                    .unwrap();
                println!(
                    "{}: zoom {} s {:.3}, feitos {}/{}, {} formas, {} textos -> {}",
                    q.nome,
                    encaixe.n,
                    encaixe.s,
                    resumo.feitos,
                    resumo.total,
                    cena.formas.len(),
                    cena.textos.len(),
                    arquivo.display()
                );
            }
        }

        #[test]
        fn janela_que_nao_existe_nao_tem_area_nem_retangulo() {
            assert_eq!(area_do_jogo(0), None);
            assert_eq!(retangulo_da_janela(0), None);
        }

        #[test]
        fn base_confirmacao_e_seguir_contam_do_mesmo_jeito() {
            // Caso medido na bancada: o registro diz 22 nós bons (conta os de baixo das partes
            // fixas), `conferir` na MESMA foto diz 14. Comparar um com o outro nunca confirma.
            assert!(!confirma(22, 14));
            // Com a base medida por `conferir`, a mesma imagem parada sempre confirma e sempre vale.
            for base in MINIMO_DE_BONS..=3000 {
                assert!(base_serve(base));
                assert!(confirma(base, base), "base {base}");
                assert!(vale(base, base), "base {base}");
            }
            // Base menor que o mínimo não serve: o SEGUINDO cairia na primeira conferência.
            for base in 0..MINIMO_DE_BONS {
                assert!(!base_serve(base));
                assert!(!vale(base, base));
            }
            // Os limiares em si: 80% pra confirmar, 50% (e nunca menos de 8) pra seguir valendo.
            assert!(confirma(100, 80) && !confirma(100, 79));
            assert!(!confirma(0, 0));
            assert!(vale(100, 50) && !vale(100, 49));
            assert!(vale(10, 8) && !vale(10, 7));
        }

        #[test]
        fn no_que_nenhuma_foto_leu_nao_e_desenhado() {
            // Na tela, sem leitura agora e sem leitura antes: não se risca.
            assert!(nunca_lido(Some(&Leitura::NaoSei), Sabido::Nunca));
            // Já foi lido alguma vez (o cursor está por cima agora): continua desenhado.
            assert!(!nunca_lido(Some(&Leitura::NaoSei), Sabido::Livre));
            assert!(!nunca_lido(Some(&Leitura::NaoSei), Sabido::Alocado));
            // Lido agora, fora da tela (a seta do nº 1 depende disso) ou sem leitura nenhuma: segue.
            for leitura in [Leitura::Livre, Leitura::Alocado, Leitura::ForaDaTela, Leitura::Tapado] {
                assert!(!nunca_lido(Some(&leitura), Sabido::Nunca), "{leitura:?}");
            }
            assert!(!nunca_lido(None, Sabido::Nunca));
        }

        #[test]
        fn arrastar_a_arvore_nao_fecha_ela_pro_painel() {
            let encaixe = Encaixe { n: 20, s: 0.27, tx: 0.0, ty: 0.0 };
            let area = Area { x: 0, y: 0, largura: 1920, altura: 1080 };
            let seguindo = Fase::Seguindo { encaixe, referencia: 40, area, confirmado: true };
            assert_eq!(aberta_e_zoom(&seguindo, Some(18)), (true, 20));
            // Arrasto ou zoom: PARANDO e depois a procura direta. Continua aberta, com o último zoom.
            let parando = Fase::Parando { desde: Instant::now() };
            assert_eq!(aberta_e_zoom(&parando, Some(20)), (true, 20));
            let direta = Fase::Procura { falhas: 1, tentou_zoom: true, direto: true };
            assert_eq!(aberta_e_zoom(&direta, Some(20)), (true, 20));
            assert_eq!(aberta_e_zoom(&direta, None), (true, 0));
            // Vindo da porta ainda não se sabe se é a árvore (nem com o registro esperando a segunda
            // foto); parado e na porta, não é.
            let da_porta = Fase::Procura { falhas: 0, tentou_zoom: false, direto: false };
            assert_eq!(aberta_e_zoom(&da_porta, Some(20)), (false, 0));
            let a_confirmar = Fase::Seguindo { encaixe, referencia: 30, area, confirmado: false };
            assert_eq!(aberta_e_zoom(&a_confirmar, Some(20)), (false, 0));
            assert_eq!(aberta_e_zoom(&Fase::Porta, Some(20)), (false, 0));
            assert_eq!(aberta_e_zoom(&Fase::Parado, Some(20)), (false, 0));
        }

        #[test]
        fn diag_tem_os_quatro_tempos() {
            let tempos = Tempos {
                pequena: Duration::from_millis(2),
                cheia: Duration::from_millis(18),
                registro: Duration::from_millis(210),
                leitura: Duration::from_micros(2600),
            };
            assert_eq!(tempos.diag(), "porta 2 ms · foto 18 ms · registro 210 ms · leitura 2 ms");
        }
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn espera_tem_piso_cresce_com_a_foto_lenta_e_para_no_teto() {
        let piso = Duration::from_millis(150);
        let teto = Duration::from_secs(1);
        assert_eq!(espera(piso, 12, Duration::from_millis(5), teto), piso);
        assert_eq!(espera(piso, 12, Duration::from_millis(40), teto), Duration::from_millis(480));
        assert_eq!(espera(piso, 30, Duration::ZERO, teto), piso);
        // Uma foto engasgada (200 ms, 2 s, o que for) não segura o fio além do teto.
        assert_eq!(espera(piso, 12, Duration::from_millis(200), teto), teto);
        assert_eq!(espera(Duration::from_secs(1), 30, Duration::from_secs(2), Duration::from_secs(5)), Duration::from_secs(5));
        assert_eq!(espera(piso, u32::MAX, Duration::MAX, teto), teto);
    }

    #[test]
    fn sem_ficha_so_entra_de_graca_com_zoom_de_antes_e_uma_vez_por_segundo() {
        let s = Duration::from_secs;
        let ms = Duration::from_millis;
        // Com ficha entra sempre, tenha ou não zoom de antes.
        assert_eq!(como_procurar(true, false, None, s(1)), Some(ComoProcura::ComFicha));
        assert_eq!(como_procurar(true, true, Some(ms(10)), s(1)), Some(ComoProcura::ComFicha));
        // Balde vazio (área escura que engana a porta): a árvore reaberta no mesmo zoom ainda é vista.
        assert_eq!(como_procurar(false, true, None, s(1)), Some(ComoProcura::DeGraca));
        assert_eq!(como_procurar(false, true, Some(s(1)), s(1)), Some(ComoProcura::DeGraca));
        // Mas não em toda volta da porta: no máximo uma vez a cada `entre`.
        assert_eq!(como_procurar(false, true, Some(ms(999)), s(1)), None);
        // Sem zoom de antes não há o que tentar de graça.
        assert_eq!(como_procurar(false, false, None, s(1)), None);
    }

    #[test]
    fn sono_em_fatias_para_assim_que_mandam() {
        let ms = Duration::from_millis;
        // Sono inteiro: 480 ms em fatias de 150, perguntando entre uma e outra (não depois da última).
        let (mut dormidas, mut perguntas) = (Vec::new(), 0);
        dormir_em_fatias(ms(480), ms(150), |d| dormidas.push(d), || {
            perguntas += 1;
            true
        });
        assert_eq!(dormidas, vec![ms(150), ms(150), ms(150), ms(30)]);
        assert_eq!(perguntas, 3);
        // O jogo saiu da frente depois da primeira fatia: não dorme o resto.
        let mut dormidas = Vec::new();
        dormir_em_fatias(ms(1000), ms(150), |d| dormidas.push(d), || false);
        assert_eq!(dormidas, vec![ms(150)]);
        // Sono que cabe numa fatia: uma dormida, nenhuma pergunta.
        let (mut dormidas, mut perguntas) = (Vec::new(), 0);
        dormir_em_fatias(ms(150), ms(150), |d| dormidas.push(d), || {
            perguntas += 1;
            true
        });
        assert_eq!((dormidas, perguntas), (vec![ms(150)], 0));
        // Nada pra dormir, e fatia zero (não pode virar laço sem fim).
        let mut dormidas = Vec::new();
        dormir_em_fatias(Duration::ZERO, ms(150), |d| dormidas.push(d), || true);
        assert!(dormidas.is_empty());
        dormir_em_fatias(ms(300), Duration::ZERO, |d| dormidas.push(d), || true);
        assert_eq!(dormidas, vec![ms(300)]);
    }

    #[test]
    fn tapume_do_painel_vira_pontos_da_foto() {
        // Jogo em (100, 50), 1920 × 1080. Painel todo dentro.
        let dentro = tapume_na_foto((116, 200, 516, 840), (100, 50), 1920, 1080);
        assert_eq!(dentro, Some(Tapume { x0: 16.0, y0: 150.0, x1: 416.0, y1: 790.0 }));
        // Meio pra fora, à esquerda e em cima: só o pedaço de dentro.
        let cortado = tapume_na_foto((0, 0, 300, 200), (100, 50), 1920, 1080);
        assert_eq!(cortado, Some(Tapume { x0: 0.0, y0: 0.0, x1: 200.0, y1: 150.0 }));
        // Passando da direita e de baixo.
        let no_fim = tapume_na_foto((1900, 1000, 2500, 1500), (100, 50), 1920, 1080);
        assert_eq!(no_fim, Some(Tapume { x0: 1800.0, y0: 950.0, x1: 1920.0, y1: 1080.0 }));
        // Em outro monitor: não tapa nada.
        assert_eq!(tapume_na_foto((-800, 100, -400, 700), (100, 50), 1920, 1080), None);
        assert_eq!(tapume_na_foto((2100, 100, 2500, 700), (100, 50), 1920, 1080), None);
        // Números absurdos não estouram.
        assert_eq!(tapume_na_foto((i32::MIN, i32::MIN, i32::MAX, i32::MAX), (i32::MAX, i32::MIN), 10, 10), None);
    }
}
