//! Comportamento da janela do overlay.
//!
//! Dois modos:
//! - passivo (o normal): o clique atravessa a janela e ela nunca pega o foco do jogo;
//! - edição: a janela aceita clique e teclado, pra colar o link, arrastar e ajustar.
//!
//! "Esconder" não fecha nem minimiza a janela: a interface só deixa de desenhar.
//! A janela continua transparente, por cima e deixando o clique passar.

use std::sync::atomic::Ordering;

use tauri::{AppHandle, Emitter, LogicalSize, Manager, Monitor, PhysicalPosition, PhysicalSize, Size, WebviewWindow};

use crate::config::{self, Geometria};
use crate::estado::{Estado, Forma};
use crate::jogo;

pub const ROTULO: &str = "principal";

const LARGURA_MINIMA: u32 = 260;
const ALTURA_MINIMA: u32 = 140;
/// Tamanho padrão do balão detalhado (pixels lógicos), igual ao tauri.conf.json.
const LARGURA_PADRAO: f64 = 400.0;
const ALTURA_PADRAO: f64 = 640.0;
/// Lado da janela da bolinha (pixels lógicos): a bolinha e uma folga pra borda.
const LADO_DA_BOLINHA: f64 = 52.0;
/// A janela da bolinha com os botões de busca embaixo não passa disto (pixels lógicos).
const ALTURA_MAXIMA_DA_BOLINHA: f64 = 160.0;
/// Menor altura do balão resumido e do expandido (pixels lógicos).
const ALTURA_MINIMA_RESUMIDA: f64 = 36.0;

pub fn principal(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(ROTULO)
}

/// Avisa a interface do estado atual (modo, visível ou não, jogo aberto).
pub fn emitir_estado(app: &AppHandle) {
    let estado = app.state::<Estado>();
    let _ = app.emit("estado", estado.retrato());
}

/// Deixa a janela no modo passivo ou de edição.
fn aplicar_modo(janela: &WebviewWindow, edicao: bool) {
    if edicao {
        let _ = janela.set_focusable(true);
        let _ = janela.set_ignore_cursor_events(false);
        let _ = janela.set_always_on_top(true);
        // De propósito NÃO chamamos `janela.set_focus()`: quando o Windows recusa a troca
        // de janela ativa, a biblioteca de janelas (tao) simula um toque na tecla Alt
        // pra forçar, e essa tecla cairia na janela ativa, que pode ser o jogo.
        // Aqui só pedimos a troca. Se o Windows recusar, a janela pega o teclado no
        // primeiro clique do usuário nela.
        if let Ok(hwnd) = janela.hwnd() {
            jogo::trazer_pra_frente(hwnd.0 as isize);
        }
    } else {
        let _ = janela.set_ignore_cursor_events(true);
        let _ = janela.set_focusable(false);
        let _ = janela.set_always_on_top(true);
    }
}

pub fn definir_edicao(app: &AppHandle, ligar: bool) {
    let estado = app.state::<Estado>();
    let antes = estado.edicao.swap(ligar, Ordering::SeqCst);
    if let Some(janela) = principal(app) {
        if ligar {
            // Entrar em edição também desfaz o "esconder".
            estado.escondido.store(false, Ordering::SeqCst);
            if !antes {
                lembrar_janela_da_frente(&estado, &janela);
            }
        }
        if ligar && !antes {
            aplicar_forma(app);
        }
        aplicar_modo(&janela, ligar);
        if antes && !ligar {
            voltar_do_centro(&estado, &janela);
            guardar_geometria(app, &janela);
            devolver_foco(&estado);
        }
    }
    emitir_estado(app);
}

/// Boas-vindas (sem build): abre a edição no centro da tela onde está o jogo (ou na da janela), na
/// frente. Ao sair da edição, a janela volta pro canto onde o jogador deixou o balão. Se a edição
/// já está aberta (a build acabou de ser removida, por exemplo), a janela também vai pro centro,
/// mas só uma vez: se ela já foi pro centro, não mexe (o jogador pode ter arrastado), só vem pra frente.
pub fn abrir_no_centro(app: &AppHandle) {
    let estado = app.state::<Estado>();
    let Some(janela) = principal(app) else { return };
    if estado.edicao.load(Ordering::SeqCst) && estado.no_centro.load(Ordering::SeqCst) {
        if let Ok(hwnd) = janela.hwnd() {
            jogo::trazer_pra_frente(hwnd.0 as isize);
        }
        return;
    }
    if estado.edicao.load(Ordering::SeqCst) {
        if let Ok(hwnd) = janela.hwnd() {
            jogo::trazer_pra_frente(hwnd.0 as isize);
        }
    } else {
        definir_edicao(app, true);
    }
    let Ok(tamanho) = janela.outer_size() else { return };
    // O monitor do jogo (se aberto); senão o da janela; senão o principal.
    let Some(tela) = tela_do_jogo(&janela).or_else(|| tela_da_janela(&janela)) else { return };
    let (x, y) = no_centro((tamanho.width, tamanho.height), tela.area);
    // Guarda o lugar escolhido antes de mover (pra não achar que o jogador arrastou pro centro).
    notar_o_lugar(&estado, geometria_atual(&janela));
    let _ = janela.set_position(PhysicalPosition::new(x, y));
    let posta = janela.outer_position().ok().map(|p| (p.x, p.y)).or(Some((x, y)));
    estado.lugar.lock().unwrap().posta = posta;
    estado.no_centro.store(true, Ordering::SeqCst);
}

/// Saindo da edição que abriu no centro: a janela volta pro lugar escolhido. Se o jogador arrastou
/// a janela durante a edição, o lugar novo é onde ela está (e ela fica ali).
fn voltar_do_centro(estado: &Estado, janela: &WebviewWindow) {
    if !estado.no_centro.swap(false, Ordering::SeqCst) {
        return;
    }
    let Some(escolhido) = notar_o_lugar(estado, geometria_atual(janela)) else { return };
    let Ok(tamanho) = janela.outer_size() else { return };
    let Some(monitor) = monitor_do_lugar(janela, retangulo(escolhido)) else { return };
    por_no_lugar(estado, janela, escolhido, monitor, tamanho, false);
}

/// Canto de cima à esquerda pra uma janela de tamanho `tamanho` ficar no meio do monitor.
fn no_centro(tamanho: (u32, u32), monitor: Retangulo) -> (i32, i32) {
    let eixo = |inicio: i32, lado: u32, tela: u32| inicio + (tela.saturating_sub(lado) / 2) as i32;
    (eixo(monitor.0, tamanho.0, monitor.2), eixo(monitor.1, tamanho.1, monitor.3))
}

/// Guarda quem estava com o teclado antes de a edição começar (o jogo, normalmente).
fn lembrar_janela_da_frente(estado: &Estado, janela: &WebviewWindow) {
    let nossa = janela.hwnd().map(|hwnd| hwnd.0 as isize).unwrap_or(0);
    let na_frente = jogo::janela_na_frente();
    let lembrar = if na_frente == nossa { 0 } else { na_frente };
    estado.janela_antes_da_edicao.store(lembrar, Ordering::SeqCst);
}

/// Ao sair da edição, o teclado volta pra janela onde estava. Se ela sumiu, vai pro
/// jogo (quando aberto). Só troca a janela ativa: nada é enviado a ela.
fn devolver_foco(estado: &Estado) {
    let anterior = estado.janela_antes_da_edicao.swap(0, Ordering::SeqCst);
    if !jogo::trazer_pra_frente(anterior) {
        jogo::trazer_pra_frente(jogo::janela_do_jogo());
    }
}

pub fn alternar_edicao(app: &AppHandle) {
    let ligado = app.state::<Estado>().edicao.load(Ordering::SeqCst);
    definir_edicao(app, !ligado);
}

pub fn alternar_escondido(app: &AppHandle) {
    let estado = app.state::<Estado>();
    if estado.edicao.load(Ordering::SeqCst) {
        // Em edição, "esconder" sai da edição e esconde.
        estado.escondido.store(true, Ordering::SeqCst);
        estado.edicao.store(false, Ordering::SeqCst);
        if let Some(janela) = principal(app) {
            aplicar_modo(&janela, false);
            voltar_do_centro(&estado, &janela);
            guardar_geometria(app, &janela);
            devolver_foco(&estado);
        }
    } else {
        estado.escondido.fetch_xor(true, Ordering::SeqCst);
    }
    emitir_estado(app);
}

/// A interface escolheu a forma do balão (e, no resumido e no expandido, mediu a altura do conteúdo).
pub fn definir_forma(app: &AppHandle, forma: Forma, altura_medida: Option<f64>) {
    let estado = app.state::<Estado>();
    estado.forma.store(forma as u8, Ordering::SeqCst);
    let altura = altura_medida.filter(|a| a.is_finite() && *a > 0.0).map(|a| a.round() as u32);
    if forma == Forma::Bolinha {
        // Na bolinha, a altura é a da janela inteira (bolinha e botões de busca embaixo).
        estado.altura_da_bolinha.store(altura.unwrap_or(0), Ordering::SeqCst);
    } else if let Some(altura) = altura {
        estado.altura_medida.store(altura, Ordering::SeqCst);
    }
    aplicar_forma(app);
}

/// Deixa a janela do tamanho da forma atual, sempre no lugar onde o jogador deixou o balão
/// (canto de cima à esquerda): o resumido e o expandido têm a largura do detalhado e só mudam
/// de altura (crescem pra baixo). Na edição é sempre o detalhado, pra caber as opções.
///
/// Quando a forma maior não cabe na tela, a janela é puxada pra dentro, mas o lugar escolhido
/// fica guardado: virar bolinha e voltar (Baú, Mundo, U, C...) sempre volta pro mesmo canto.
pub fn aplicar_forma(app: &AppHandle) {
    let Some(janela) = principal(app) else { return };
    let estado = app.state::<Estado>();
    let escolhido = notar_o_lugar(&estado, geometria_atual(&janela));
    let forma = if estado.edicao.load(Ordering::SeqCst) {
        Forma::Detalhado
    } else {
        Forma::do_numero(estado.forma.load(Ordering::SeqCst))
    };
    let monitor = escolhido.and_then(|e| monitor_do_lugar(&janela, retangulo(e)));
    let escala = janela.scale_factor().unwrap_or(1.0);
    let (salva, escala_salva) = {
        let config = estado.config.lock().unwrap();
        (config.janela, config.escala_da_janela)
    };
    // Nunca maior que a área útil do monitor (a tela sem a barra de tarefas).
    let (largura, altura) = caber(tamanho_detalhado(salva, escala_salva, escala), monitor);
    let medida = estado.altura_medida.load(Ordering::SeqCst) as f64;
    let tamanho = match forma {
        Forma::Detalhado => {
            // Já está no tamanho detalhado: não mexe (pode ter sido redimensionada agora).
            if estado.tamanho_detalhado_na_tela.swap(true, Ordering::SeqCst) {
                return;
            }
            let _ = janela.set_min_size(Some(Size::Logical(LogicalSize::new(
                LARGURA_MINIMA as f64,
                ALTURA_MINIMA as f64,
            ))));
            PhysicalSize::new(largura, altura)
        }
        Forma::Expandido | Forma::Resumido | Forma::Bolinha => {
            estado.tamanho_detalhado_na_tela.store(false, Ordering::SeqCst);
            // Mínimo pequeno, mas dito: sem nenhum, o Windows usa o dele (~136 px de largura)
            // e a bolinha não encolhe.
            let _ = janela.set_min_size(Some(Size::Logical(LogicalSize::new(32.0, 32.0))));
            match forma {
                Forma::Bolinha => {
                    let lado = (LADO_DA_BOLINHA * escala).round() as u32;
                    let pedida = estado.altura_da_bolinha.load(Ordering::SeqCst) as f64;
                    let alto = (pedida.clamp(LADO_DA_BOLINHA, ALTURA_MAXIMA_DA_BOLINHA) * escala).round() as u32;
                    PhysicalSize::new(lado, alto)
                }
                _ => {
                    let altura_do_monitor =
                        monitor.map(|m| m.3).or_else(|| tela_da_janela(&janela).map(|t| t.area.3));
                    tamanho_medido(largura, medida, escala, altura_do_monitor)
                }
            }
        }
    };
    let _ = janela.set_size(tamanho);
    if let (Some(escolhido), Some(monitor)) = (escolhido, monitor) {
        por_no_lugar(&estado, &janela, escolhido, monitor, tamanho, forma == Forma::Bolinha);
    }
}

/// Vê se o jogador arrastou a janela desde a última vez que o programa pôs ela no lugar (Alt +
/// arrastar, ou na edição). Se arrastou, ali é o lugar novo. Devolve o lugar escolhido.
fn notar_o_lugar(estado: &Estado, atual: Option<Geometria>) -> Option<Geometria> {
    let mut lugar = estado.lugar.lock().unwrap();
    if let Some(g) = atual {
        if lugar.escolhido.is_none() || jogador_mexeu(lugar.posta, (g.x, g.y)) {
            lugar.escolhido = Some(g);
            lugar.posta = Some((g.x, g.y));
        }
    }
    lugar.escolhido
}

/// A janela está em outro canto que não o que o programa pôs?
fn jogador_mexeu(posta: Option<(i32, i32)>, agora: (i32, i32)) -> bool {
    posta != Some(agora)
}

/// Põe a janela (já no tamanho novo) no lugar escolhido, puxando pra dentro da tela se precisar,
/// e anota onde ela ficou.
fn por_no_lugar(
    estado: &Estado,
    janela: &WebviewWindow,
    escolhido: Geometria,
    monitor: Retangulo,
    tamanho: PhysicalSize<u32>,
    bolinha: bool,
) {
    let (x, y) = encaixar_no_lugar(retangulo(escolhido), (tamanho.width, tamanho.height), monitor, bolinha);
    let antes = janela.outer_position().ok().map(|p| (p.x, p.y));
    if antes != Some((x, y)) {
        let _ = janela.set_position(PhysicalPosition::new(x, y));
    }
    let posta = janela.outer_position().ok().map(|p| (p.x, p.y)).or(Some((x, y)));
    estado.lugar.lock().unwrap().posta = posta;
}

/// (x, y, largura, altura) em pixels físicos.
type Retangulo = (i32, i32, u32, u32);

fn retangulo(g: Geometria) -> Retangulo {
    (g.x, g.y, g.largura, g.altura)
}

/// Área útil (sem a barra de tarefas) do monitor onde está a maior parte do lugar escolhido (ou
/// a do monitor da janela, se ele sumiu).
fn monitor_do_lugar(janela: &WebviewWindow, lugar: Retangulo) -> Option<Retangulo> {
    melhor_tela(lugar, &telas(janela)).or_else(|| tela_da_janela(janela)).map(|t| t.area)
}

/// Um monitor como o guia usa: a área útil (a tela menos a barra de tarefas), em pixels físicos,
/// e a escala do Windows nele (1.0 = 100%).
#[derive(Debug, Clone, Copy, PartialEq)]
struct Tela {
    area: Retangulo,
    escala: f64,
}

fn tela_de(monitor: &Monitor) -> Tela {
    let util = monitor.work_area();
    let area = if util.size.width > 0 && util.size.height > 0 {
        (util.position.x, util.position.y, util.size.width, util.size.height)
    } else {
        let (p, t) = (monitor.position(), monitor.size());
        (p.x, p.y, t.width, t.height)
    };
    Tela { area, escala: monitor.scale_factor() }
}

fn telas(janela: &WebviewWindow) -> Vec<Tela> {
    janela.available_monitors().unwrap_or_default().iter().map(tela_de).collect()
}

/// O monitor onde a janela está agora (ou o principal).
fn tela_da_janela(janela: &WebviewWindow) -> Option<Tela> {
    let monitor = janela.current_monitor().ok().flatten().or_else(|| janela.primary_monitor().ok().flatten())?;
    Some(tela_de(&monitor))
}

/// O monitor onde está o jogo, se ele está aberto.
fn tela_do_jogo(janela: &WebviewWindow) -> Option<Tela> {
    let jogo = jogo::retangulo_da_janela(jogo::janela_do_jogo())
        .map(|(e, c, d, b)| (e, c, (d - e).max(0) as u32, (b - c).max(0) as u32))?;
    melhor_tela(jogo, &telas(janela))
}

fn melhor_tela(lugar: Retangulo, telas: &[Tela]) -> Option<Tela> {
    let areas: Vec<Retangulo> = telas.iter().map(|t| t.area).collect();
    let area = melhor_monitor(lugar, &areas)?;
    telas.iter().copied().find(|t| t.area == area)
}

/// O tamanho cortado pra caber na área (se tiver área).
fn caber(tamanho: (u32, u32), area: Option<Retangulo>) -> (u32, u32) {
    match area {
        Some(a) => (tamanho.0.min(a.2), tamanho.1.min(a.3)),
        None => tamanho,
    }
}

/// Tamanho do balão detalhado em pixels físicos, na escala `escala`: o guardado (convertido, se
/// foi guardado com outra escala do Windows) ou o padrão.
fn tamanho_detalhado(salva: Option<Geometria>, escala_salva: Option<f64>, escala: f64) -> (u32, u32) {
    match salva {
        Some(g) => {
            let fator = escala_salva.filter(|e| e.is_finite() && *e > 0.0).map_or(1.0, |e| escala / e);
            ((g.largura as f64 * fator).round() as u32, (g.altura as f64 * fator).round() as u32)
        }
        None => ((LARGURA_PADRAO * escala).round() as u32, (ALTURA_PADRAO * escala).round() as u32),
    }
}

/// Lugar e tamanho padrão do balão numa tela: perto do canto de cima à esquerda (como no
/// tauri.conf.json), no tamanho padrão, sem passar da área útil.
fn geometria_padrao(tela: Tela) -> Geometria {
    let (largura, altura) = caber(tamanho_detalhado(None, None, tela.escala), Some(tela.area));
    let canto = (
        tela.area.0 + (16.0 * tela.escala).round() as i32,
        tela.area.1 + (150.0 * tela.escala).round() as i32,
    );
    let (x, y) = encaixar(canto, (largura, altura), tela.area);
    Geometria { x, y, largura, altura }
}

/// Bandeja, "Recolocar o guia": o balão volta pro canto padrão (no monitor do jogo, ou no principal),
/// no tamanho padrão e à mostra. Pra quando ele se perdeu fora da tela ou ficou grande demais.
pub fn recolocar(app: &AppHandle) {
    let Some(janela) = principal(app) else { return };
    let estado = app.state::<Estado>();
    let tela_principal = janela.primary_monitor().ok().flatten().map(|m| tela_de(&m));
    let Some(tela) = tela_do_jogo(&janela).or(tela_principal).or_else(|| tela_da_janela(&janela)) else { return };
    let g = geometria_padrao(tela);
    estado.escondido.store(false, Ordering::SeqCst);
    estado.no_centro.store(false, Ordering::SeqCst);
    // A posição primeiro: indo pra um monitor de outra escala, o Windows muda o tamanho na troca.
    let _ = janela.set_position(PhysicalPosition::new(g.x, g.y));
    let _ = janela.set_size(PhysicalSize::new(g.largura, g.altura));
    {
        let mut config = estado.config.lock().unwrap();
        config.janela = Some(g);
        config.escala_da_janela = Some(tela.escala);
        let _ = config::salvar(&estado.pasta_dados, &config);
    }
    {
        let mut lugar = estado.lugar.lock().unwrap();
        lugar.escolhido = Some(g);
        lugar.posta = janela.outer_position().ok().map(|p| (p.x, p.y)).or(Some((g.x, g.y)));
    }
    // Refaz a forma atual (bolinha, resumido...) a partir do lugar novo.
    estado.tamanho_detalhado_na_tela.store(false, Ordering::SeqCst);
    aplicar_forma(app);
    emitir_estado(app);
}

fn melhor_monitor(lugar: Retangulo, monitores: &[Retangulo]) -> Option<Retangulo> {
    monitores
        .iter()
        .map(|&m| {
            let (largura, altura) = sobreposicao(lugar, m);
            (largura * altura, m)
        })
        .filter(|(area, _)| *area > 0)
        .max_by_key(|(area, _)| *area)
        .map(|(_, m)| m)
}

/// Canto de cima à esquerda da janela de tamanho `tamanho` no lugar escolhido. A bolinha fica
/// sempre inteira na tela. O balão pode sobrar pra fora só até onde o jogador mesmo deixou ele
/// sobrando; o resto é puxado pra dentro do monitor.
fn encaixar_no_lugar(escolhido: Retangulo, tamanho: (u32, u32), monitor: Retangulo, bolinha: bool) -> (i32, i32) {
    let area = if bolinha { monitor } else { uniao(monitor, escolhido) };
    encaixar((escolhido.0, escolhido.1), tamanho, area)
}

/// Menor retângulo que cobre os dois.
fn uniao(a: Retangulo, b: Retangulo) -> Retangulo {
    let x = a.0.min(b.0);
    let y = a.1.min(b.1);
    let fim_x = (a.0 as i64 + a.2 as i64).max(b.0 as i64 + b.2 as i64);
    let fim_y = (a.1 as i64 + a.3 as i64).max(b.1 as i64 + b.3 as i64);
    (x, y, (fim_x - x as i64) as u32, (fim_y - y as i64) as u32)
}

/// Tamanho do resumido e do expandido: a largura do detalhado e a altura do conteúdo, sem
/// passar da altura do monitor.
fn tamanho_medido(
    largura_detalhada: u32,
    altura_medida: f64,
    escala: f64,
    altura_do_monitor: Option<u32>,
) -> PhysicalSize<u32> {
    let mut altura = altura_medida.max(ALTURA_MINIMA_RESUMIDA) * escala;
    if let Some(maxima) = altura_do_monitor {
        altura = altura.min(maxima as f64);
    }
    PhysicalSize::new(largura_detalhada, altura.round() as u32)
}

/// Posição pra uma janela de tamanho `tamanho` caber no monitor (x, y, largura, altura).
fn encaixar(posicao: (i32, i32), tamanho: (u32, u32), monitor: Retangulo) -> (i32, i32) {
    let eixo = |p: i32, t: u32, inicio: i32, medida: u32| -> i32 {
        let fim = inicio as i64 + medida as i64 - t as i64;
        (p as i64).min(fim).max(inicio as i64) as i32
    };
    (
        eixo(posicao.0, tamanho.0, monitor.0, monitor.2),
        eixo(posicao.1, tamanho.1, monitor.1, monitor.3),
    )
}

/// Tira o guia das fotos da tela (ou põe de volta). Fora delas, a leitura de tela vê o jogo que
/// está embaixo do balão: a gema da loja ou da recompensa e o pedaço da árvore que ele tapa.
/// É o mesmo recurso do Windows das molduras e do desenho da árvore (`WDA_EXCLUDEFROMCAPTURE`).
pub fn aplicar_fotos(app: &AppHandle) {
    let fora = app.state::<Estado>().config.lock().unwrap().guia_fora_das_fotos;
    // A janelinha dos botões de busca vai junto com o balão.
    for janela in [principal(app), crate::janela_da_busca::janela(app)].into_iter().flatten() {
        if let Err(erro) = janela.set_content_protected(fora) {
            eprintln!("não consegui mudar o guia nas fotos da tela: {erro}");
        }
    }
}

/// Preparo na abertura: posição salva, modo passivo e fora (ou não) das fotos da tela.
///
/// A janela guardada volta pro lugar dela, com o tamanho convertido se a escala do Windows mudou e
/// cortado pra caber no monitor. Se ela não aparece mais em nenhum monitor (monitor desligado), ou
/// se é a primeira vez, vai pro lugar padrão no monitor principal, sem passar da área útil (num
/// notebook de 768 de altura, ou com 150% de escala, o padrão de 640 não cabe abaixo dos 150).
pub fn preparar(app: &AppHandle) {
    aplicar_fotos(app);
    let Some(janela) = principal(app) else { return };
    let estado = app.state::<Estado>();
    let (salva, escala_salva) = {
        let config = estado.config.lock().unwrap();
        (config.janela, config.escala_da_janela)
    };
    let telas = telas(&janela);
    let guardada = salva
        .filter(|g| cabe_em_alguma_tela(*g, &telas))
        .and_then(|g| Some((g, melhor_tela(retangulo(g), &telas)?)))
        .map(|(g, tela)| {
            let tamanho = caber(tamanho_detalhado(Some(g), escala_salva, tela.escala), Some(tela.area));
            let (x, y) = encaixar_no_lugar(retangulo(g), tamanho, tela.area, false);
            Geometria { x, y, largura: tamanho.0, altura: tamanho.1 }
        });
    let tela_principal = || janela.primary_monitor().ok().flatten().map(|m| tela_de(&m));
    let lugar = guardada.or_else(|| tela_principal().or_else(|| tela_da_janela(&janela)).map(geometria_padrao));
    if let Some(g) = lugar {
        // A posição primeiro: indo pra um monitor de outra escala, o Windows muda o tamanho na troca.
        let _ = janela.set_position(PhysicalPosition::new(g.x, g.y));
        let _ = janela.set_size(PhysicalSize::new(g.largura, g.altura));
    }
    aplicar_modo(&janela, false);
}

fn geometria_atual(janela: &WebviewWindow) -> Option<Geometria> {
    let posicao = janela.outer_position().ok()?;
    let tamanho = janela.inner_size().ok()?;
    Some(Geometria {
        x: posicao.x,
        y: posicao.y,
        largura: tamanho.width,
        altura: tamanho.height,
    })
}

/// Guarda posição e tamanho no config.json (ao sair da edição, ao soltar o Alt e ao fechar).
/// A posição é a do lugar escolhido (não a da janela puxada pra dentro da tela). O tamanho só
/// vale quando a janela está no balão detalhado; nas outras formas fica o salvo.
pub fn guardar_geometria(app: &AppHandle, janela: &WebviewWindow) {
    let atual = geometria_atual(janela);
    let Some(mut geometria) = atual else {
        return;
    };
    let estado = app.state::<Estado>();
    if let Some(escolhido) = notar_o_lugar(&estado, atual) {
        geometria.x = escolhido.x;
        geometria.y = escolhido.y;
    }
    let escala = janela.scale_factor().unwrap_or(1.0);
    let mut config = estado.config.lock().unwrap();
    if !estado.tamanho_detalhado_na_tela.load(Ordering::SeqCst) {
        let Some(salva) = config.janela else { return };
        // Fica o tamanho guardado, na escala de agora.
        let (largura, altura) = tamanho_detalhado(Some(salva), config.escala_da_janela, escala);
        geometria.largura = largura;
        geometria.altura = altura;
    }
    if geometria.largura < LARGURA_MINIMA || geometria.altura < ALTURA_MINIMA {
        return;
    }
    if config.janela == Some(geometria) && config.escala_da_janela == Some(escala) {
        return;
    }
    config.janela = Some(geometria);
    config.escala_da_janela = Some(escala);
    let _ = config::salvar(&estado.pasta_dados, &config);
}

/// A janela salva ainda aparece em algum monitor? (o monitor pode ter sido desligado)
fn cabe_em_alguma_tela(g: Geometria, telas: &[Tela]) -> bool {
    if g.largura < LARGURA_MINIMA || g.altura < ALTURA_MINIMA {
        return false;
    }
    telas
        .iter()
        .any(|tela| aparece_o_bastante(sobreposicao((g.x, g.y, g.largura, g.altura), tela.area)))
}

/// Pedaço mínimo da janela que precisa estar dentro de um monitor pra dar pra achar ela.
fn aparece_o_bastante((largura, altura): (i64, i64)) -> bool {
    largura >= 120 && altura >= 80
}

/// Largura e altura do pedaço em comum entre dois retângulos (x, y, largura, altura).
fn sobreposicao(a: (i32, i32, u32, u32), b: (i32, i32, u32, u32)) -> (i64, i64) {
    let (ax, ay, al, aa) = (a.0 as i64, a.1 as i64, a.2 as i64, a.3 as i64);
    let (bx, by, bl, ba) = (b.0 as i64, b.1 as i64, b.2 as i64, b.3 as i64);
    let largura = (ax + al).min(bx + bl) - ax.max(bx);
    let altura = (ay + aa).min(by + ba) - ay.max(by);
    (largura.max(0), altura.max(0))
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn encaixar_puxa_pra_dentro_da_tela() {
        let tela = (0, 0, 1920, 1080);
        // Cabe: não mexe.
        assert_eq!(encaixar((100, 100), (400, 640), tela), (100, 100));
        // Bolinha no canto de baixo à direita, aberta: volta pra dentro.
        assert_eq!(encaixar((1860, 1020), (400, 640), tela), (1520, 440));
        // Segundo monitor à esquerda (x negativo).
        assert_eq!(encaixar((-50, 10), (400, 640), (-1920, 0, 1920, 1080)), (-400, 10));
        // Maior que a tela: fica grudada no começo.
        assert_eq!(encaixar((10, 10), (400, 2000), tela), (10, 0));
    }

    #[test]
    fn a_janela_volta_pro_lugar_escolhido() {
        let tela = (0, 0, 2560, 1440);
        let escolhido = (1800, 600, 416, 500);
        // Bolinha: no mesmo canto de cima à esquerda.
        assert_eq!(encaixar_no_lugar(escolhido, (52, 52), tela, true), (1800, 600));
        // Expandido de volta, mesmo que a primeira medida venha gigante e puxe pra cima...
        assert_eq!(encaixar_no_lugar(escolhido, (416, 1440), tela, false), (1800, 0));
        // ...a medida certa devolve pro lugar, e não fica grudado no topo.
        assert_eq!(encaixar_no_lugar(escolhido, (416, 520), tela, false), (1800, 600));
    }

    #[test]
    fn o_balao_sobra_pra_fora_so_onde_o_jogador_deixou() {
        let tela = (0, 0, 2560, 1440);
        // Jogador deixou o balão passando da borda de baixo: fica assim.
        let sobrando = (100, 1200, 416, 500);
        assert_eq!(encaixar_no_lugar(sobrando, (416, 500), tela, false), (100, 1200));
        // A bolinha nesse lugar fica inteira na tela.
        assert_eq!(encaixar_no_lugar(sobrando, (52, 52), tela, true), (100, 1200));
        // Bolinha arrastada pro canto e aberta: o balão entra na tela.
        let bolinha = (2500, 1380, 52, 52);
        assert_eq!(encaixar_no_lugar(bolinha, (416, 640), tela, false), (2144, 800));
        // E a bolinha volta pro canto dela.
        assert_eq!(encaixar_no_lugar(bolinha, (52, 52), tela, true), (2500, 1380));
    }

    #[test]
    fn so_conta_como_arrastada_se_saiu_de_onde_o_programa_pos() {
        assert!(!jogador_mexeu(Some((10, 20)), (10, 20)));
        assert!(jogador_mexeu(Some((10, 20)), (11, 20)));
        assert!(jogador_mexeu(None, (10, 20)));
    }

    #[test]
    fn monitor_com_mais_pedaco_do_lugar() {
        let esquerda = (-2560, 0, 2560, 1440);
        let principal = (0, 0, 2560, 1440);
        let monitores = [esquerda, principal];
        assert_eq!(melhor_monitor((-300, 100, 416, 640), &monitores), Some(esquerda));
        assert_eq!(melhor_monitor((-100, 100, 416, 640), &monitores), Some(principal));
        // Monitor desligado: nenhum.
        assert_eq!(melhor_monitor((-6000, 100, 416, 640), &monitores), None);
        assert_eq!(uniao((0, 0, 100, 100), (50, -20, 100, 100)), (0, -20, 150, 120));
    }

    #[test]
    fn expandido_tem_a_largura_do_detalhado_e_cresce_pra_baixo() {
        // A largura é sempre a do detalhado; a altura é a medida, na escala da tela.
        assert_eq!(tamanho_medido(400, 900.0, 1.0, Some(1080)), PhysicalSize::new(400, 900));
        assert_eq!(tamanho_medido(600, 400.0, 1.5, None), PhysicalSize::new(600, 600));
        // Conteúdo mais alto que o monitor: para no monitor.
        assert_eq!(tamanho_medido(400, 1500.0, 1.0, Some(1024)), PhysicalSize::new(400, 1024));
        // Sem medida ainda: a altura mínima.
        assert_eq!(tamanho_medido(400, 0.0, 1.0, None).height, ALTURA_MINIMA_RESUMIDA as u32);
    }

    #[test]
    fn as_quatro_formas_pelo_nome_e_pelo_numero() {
        for forma in [Forma::Detalhado, Forma::Resumido, Forma::Bolinha, Forma::Expandido] {
            assert_eq!(Forma::do_numero(forma as u8), forma);
        }
        assert_eq!(Forma::do_nome("expandido"), Some(Forma::Expandido));
        assert_eq!(Forma::do_nome("gigante"), None);
        assert_eq!(Forma::do_numero(200), Forma::Detalhado);
    }

    #[test]
    fn boas_vindas_no_meio_do_monitor() {
        assert_eq!(no_centro((400, 640), (0, 0, 1920, 1080)), (760, 220));
        // Segundo monitor à esquerda.
        assert_eq!(no_centro((400, 640), (-1920, 0, 1920, 1080)), (-1160, 220));
        // Janela maior que o monitor: encosta no canto de cima.
        assert_eq!(no_centro((400, 2000), (0, 0, 1920, 1080)), (760, 0));
    }

    #[test]
    fn janela_dentro_do_monitor() {
        assert_eq!(
            sobreposicao((16, 150, 400, 640), (0, 0, 1920, 1080)),
            (400, 640)
        );
    }

    #[test]
    fn janela_meio_fora() {
        let pedaco = sobreposicao((1800, 1000, 400, 640), (0, 0, 1920, 1080));
        assert_eq!(pedaco, (120, 80));
        assert!(aparece_o_bastante(pedaco));
    }

    #[test]
    fn janela_em_monitor_que_sumiu() {
        // Monitor à esquerda desligado: a janela salva ficou toda fora.
        let pedaco = sobreposicao((-1900, 20, 420, 700), (0, 0, 1920, 1080));
        assert_eq!(pedaco, (0, 700));
        assert!(!aparece_o_bastante(pedaco));
    }

    #[test]
    fn o_padrao_cabe_em_tela_pequena_e_com_escala() {
        // 1920x1080 a 100%, barra de tarefas de 40: como no tauri.conf.json.
        let tela = Tela { area: (0, 0, 1920, 1040), escala: 1.0 };
        assert_eq!(geometria_padrao(tela), Geometria { x: 16, y: 150, largura: 400, altura: 640 });
        // 1366x768 (notebook): 150 + 640 passaria da barra; sobe pra caber.
        let notebook = Tela { area: (0, 0, 1366, 728), escala: 1.0 };
        assert_eq!(geometria_padrao(notebook), Geometria { x: 16, y: 88, largura: 400, altura: 640 });
        // 1920x1080 a 150%: 600x960 físicos, cabe só encostando em cima.
        let escala = Tela { area: (0, 0, 1920, 1032), escala: 1.5 };
        assert_eq!(geometria_padrao(escala), Geometria { x: 24, y: 72, largura: 600, altura: 960 });
        // 1280x720 a 150%: mais alto que a área útil, corta na altura dela.
        let pequena = Tela { area: (0, 0, 1280, 672), escala: 1.5 };
        assert_eq!(geometria_padrao(pequena), Geometria { x: 24, y: 0, largura: 600, altura: 672 });
        // Monitor principal com a barra em cima e outro monitor à esquerda.
        let barra_em_cima = Tela { area: (-1920, 40, 1920, 1040), escala: 1.0 };
        assert_eq!(geometria_padrao(barra_em_cima), Geometria { x: -1904, y: 190, largura: 400, altura: 640 });
    }

    #[test]
    fn o_tamanho_guardado_segue_a_escala_do_windows() {
        let g = Geometria { x: 10, y: 10, largura: 400, altura: 640 };
        // Mesma escala, ou config antiga sem a escala: como está.
        assert_eq!(tamanho_detalhado(Some(g), Some(1.0), 1.0), (400, 640));
        assert_eq!(tamanho_detalhado(Some(g), None, 1.5), (400, 640));
        // Guardado a 100%, aberto a 150% (e o contrário).
        assert_eq!(tamanho_detalhado(Some(g), Some(1.0), 1.5), (600, 960));
        assert_eq!(tamanho_detalhado(Some(Geometria { largura: 600, altura: 960, ..g }), Some(1.5), 1.0), (400, 640));
        // Nada guardado: o padrão na escala.
        assert_eq!(tamanho_detalhado(None, None, 1.25), (500, 800));
        // E nunca maior que a área útil.
        assert_eq!(caber((600, 960), Some((0, 0, 1366, 728))), (600, 728));
        assert_eq!(caber((600, 960), None), (600, 960));
    }

    #[test]
    fn janela_guardada_some_quando_o_monitor_sai() {
        let principal = Tela { area: (0, 0, 1920, 1040), escala: 1.0 };
        let esquerda = Tela { area: (-1920, 0, 1920, 1040), escala: 1.25 };
        let g = Geometria { x: -1900, y: 20, largura: 420, altura: 700 };
        assert!(cabe_em_alguma_tela(g, &[esquerda, principal]));
        assert_eq!(melhor_tela(retangulo(g), &[principal, esquerda]), Some(esquerda));
        // O monitor da esquerda foi desligado.
        assert!(!cabe_em_alguma_tela(g, &[principal]));
        assert_eq!(melhor_tela(retangulo(g), &[principal]), None);
    }

    #[test]
    fn so_uma_tirinha_aparecendo_nao_basta() {
        // Larga o bastante, mas só 10 px de altura dentro da tela.
        let pedaco = sobreposicao((100, 1070, 400, 640), (0, 0, 1920, 1080));
        assert_eq!(pedaco, (400, 10));
        assert!(!aparece_o_bastante(pedaco));
    }
}
