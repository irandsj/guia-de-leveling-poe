//! Guia da árvore de passivas: reconhece a árvore do jogo na tela e desenha por cima os próximos nós.
//!
//! O que isto faz, e só isto: tira fotos da tela, faz contas e desenha numa janela NOSSA, que
//! não pega foco e deixa o clique passar. Não lê a memória do jogo, não lê teclado nem mouse e
//! não manda nada pro jogo.
//!
//! Este arquivo é a ponte com `lib.rs`: os tipos que o painel manda e recebe, a conferência do
//! que chega e o estado combinado (árvore + guia) que o fio de `laco` consulta. As partes:
//! - `estado`: memória do que já se leu de cada nó, com votação no tempo (só contas);
//! - `desenho`: o que riscar e o rasterizador (só contas);
//! - `dica`: vê na foto a dica do jogo aberta por cima da árvore (só contas);
//! - `janela`: a janela em camadas e os buffers do Windows;
//! - `laco`: o fio que tira as fotos e decide quando procurar, seguir e parar.

mod desenho;
mod dica;
mod estado;
mod janela;
mod laco;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use arvore_visao::Arvore;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// Se a árvore de passivas está aberta no jogo agora, pelo que o fio de `laco` viu na última volta.
/// (Quem liga as setas do teclado olha isto; sem guia ou com o jogo atrás, fica `false`.)
static ABERTA: AtomicBool = AtomicBool::new(false);

/// A árvore está aberta no jogo agora?
pub fn aberta() -> bool {
    ABERTA.load(Ordering::SeqCst)
}

/// O fio de `laco` anota aqui, a cada volta, se a árvore está aberta.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn anotar_aberta(aberta: bool) {
    ABERTA.store(aberta, Ordering::SeqCst);
}

/// No máximo quantos nós a árvore pode ter. A de verdade tem 2321 (3.29.1 e 3.30.0); o resto é folga.
const MAXIMO_DE_NOS: usize = 6000;
/// No máximo quantos passos o guia pode ter. Uma build inteira gasta uns 120 pontos.
const MAXIMO_DE_PASSOS: usize = 3000;
/// No máximo quantas letras tem cada texto que vem do painel (nome de nó, efeito de maestria…).
const MAXIMO_DE_LETRAS: usize = 400;
/// Quantos próximos levam número quando o painel não diz (o desenho combinado: 8).
const NUMERADOS_PADRAO: u32 = 8;
/// No máximo quantos próximos levam número (mais que isso vira poluição na tela).
const MAXIMO_DE_NUMERADOS: u32 = 20;

/// As posições dos nós, como o painel manda (uma vez por versão da árvore).
#[derive(Clone, Debug, Deserialize)]
pub struct ArvoreRecebida {
    pub versao: String,
    pub ids: Vec<u32>,
    pub xs: Vec<f32>,
    pub ys: Vec<f32>,
    pub tipos: Vec<u8>,
    /// Pares de posições, achatados.
    pub ligacoes: Vec<u32>,
}

/// Um passo da ordem da build.
#[derive(Clone, Debug, Deserialize)]
pub struct PassoRecebido {
    pub no: u32,
    /// Posição do passo de onde se chega neste; -1 = início da classe.
    pub pai: i32,
    pub nome: String,
    #[serde(default)]
    pub rotulo: Option<String>,
    #[serde(default)]
    pub solto: bool,
}

/// O guia montado pelo painel a partir do PoB.
#[derive(Clone, Debug, Deserialize)]
pub struct GuiaRecebido {
    pub build: String,
    pub inicio: u32,
    pub ordem: Vec<PassoRecebido>,
    pub ate_alvo: u32,
    #[serde(default)]
    pub manter: Vec<u32>,
    #[serde(default)]
    pub devolver: Vec<u32>,
    #[serde(default)]
    pub texto: String,
    #[serde(default)]
    pub numerados: u32,
}

/// O que o painel fica sabendo (evento "arvore").
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct SituacaoDaArvore {
    /// De qual guia é esta situação: o `build`, o `ate_alvo` e o tamanho da `ordem` do guia aceito
    /// (já dentro dos limites de `ajustar_guia`). Sem guia: "", 0 e 0. O painel só usa a situação
    /// se os três baterem com o guia que ele está mostrando.
    pub build: String,
    pub ate_alvo: u32,
    pub passos: u32,
    pub aberta: bool,
    pub vista: bool,
    pub zoom: u32,
    pub feitos: u32,
    pub total: u32,
    /// Posições em `ordem` dos próximos passos (o primeiro é o número 1 do desenho).
    pub proximos: Vec<u32>,
    pub devolver: Vec<u32>,
    pub aviso: Option<String>,
    pub diag: Option<String>,
}

/// O que o painel mandou por último. `versao` sobe a cada troca, pra o fio saber que mudou sem
/// comparar o conteúdo.
struct Combinado {
    arvore: Option<Arc<Arvore>>,
    guia: Option<Arc<GuiaRecebido>>,
    versao: u64,
}

static COMBINADO: Mutex<Combinado> = Mutex::new(Combinado { arvore: None, guia: None, versao: 0 });

/// O cadeado do estado combinado. Se alguém morreu com ele na mão, segue com o que ficou lá:
/// são só dois ponteiros e um número, não há meio-termo que estrague.
fn combinado() -> MutexGuard<'static, Combinado> {
    COMBINADO.lock().unwrap_or_else(|envenenado| envenenado.into_inner())
}

/// A versão de agora do estado combinado (barato: o fio pergunta a cada volta).
#[cfg_attr(not(windows), allow(dead_code))]
fn versao_de_agora() -> u64 {
    combinado().versao
}

/// A árvore e o guia de agora, com a versão deles.
#[cfg_attr(not(windows), allow(dead_code))]
fn combinado_de_agora() -> (u64, Option<Arc<Arvore>>, Option<Arc<GuiaRecebido>>) {
    let combinado = combinado();
    (combinado.versao, combinado.arvore.clone(), combinado.guia.clone())
}

/// Liga o fio que olha a tela. Chamado uma vez, no começo.
pub fn iniciar(app: AppHandle) {
    #[cfg(windows)]
    {
        let resultado = std::thread::Builder::new().name("arvore".into()).spawn(move || laco::laco(app));
        if let Err(erro) = resultado {
            eprintln!("não consegui criar a thread do guia da árvore: {erro}");
        }
    }
    #[cfg(not(windows))]
    {
        let _ = app;
    }
}

/// Guarda as posições dos nós. Devolve quantos nós valeram.
pub fn definir_arvore(arvore: ArvoreRecebida) -> Result<usize, String> {
    let arvore = conferir_arvore(arvore)?;
    let quantos = arvore.ids.len();
    let mut combinado = combinado();
    combinado.arvore = Some(Arc::new(arvore));
    combinado.versao = combinado.versao.wrapping_add(1);
    Ok(quantos)
}

/// Troca o guia (`None` desliga). Devolve quantos passos valeram.
pub fn definir_guia(guia: Option<GuiaRecebido>) -> usize {
    let guia = guia.map(ajustar_guia);
    let quantos = guia.as_ref().map_or(0, |g| g.ordem.len());
    let mut combinado = combinado();
    combinado.guia = guia.map(Arc::new);
    combinado.versao = combinado.versao.wrapping_add(1);
    quantos
}

/// Confere o que o painel mandou e monta a árvore das contas. O que vem do painel é dado: nada
/// aqui confia em tamanho, faixa ou número.
fn conferir_arvore(recebida: ArvoreRecebida) -> Result<Arvore, String> {
    let quantos = recebida.ids.len();
    if quantos == 0 {
        return Err("A árvore veio vazia.".into());
    }
    if quantos > MAXIMO_DE_NOS {
        return Err(format!("A árvore veio com {quantos} nós; o máximo é {MAXIMO_DE_NOS}."));
    }
    if recebida.versao.chars().count() > MAXIMO_DE_LETRAS {
        return Err("A versão da árvore veio comprida demais.".into());
    }
    if recebida.xs.len() != quantos || recebida.ys.len() != quantos || recebida.tipos.len() != quantos {
        return Err("A árvore veio com listas de tamanhos diferentes.".into());
    }
    if !recebida.ligacoes.len().is_multiple_of(2) {
        return Err("As ligações da árvore vieram sem par.".into());
    }
    if recebida.xs.iter().chain(recebida.ys.iter()).any(|v| !v.is_finite()) {
        return Err("A árvore veio com posição que não é número.".into());
    }
    if recebida.ligacoes.iter().any(|&posicao| posicao as usize >= quantos) {
        return Err("A árvore veio com ligação pra um nó que não existe.".into());
    }
    Arvore::nova(recebida.ids, recebida.xs, recebida.ys, recebida.tipos, &recebida.ligacoes)
        .ok_or_else(|| "A árvore veio com ligação inválida.".to_string())
}

/// Corta o texto em `MAXIMO_DE_LETRAS` letras (sem partir uma letra no meio).
fn encurtar(texto: String) -> String {
    match texto.char_indices().nth(MAXIMO_DE_LETRAS) {
        Some((corte, _)) => texto.get(..corte).unwrap_or_default().to_string(),
        None => texto,
    }
}

/// Põe o guia dentro dos limites: quantidade de passos, tamanho dos textos, `pai` sempre antes
/// do passo (ou -1) e `ate_alvo` dentro da ordem. Nada aqui recusa: o que não cabe é cortado.
fn ajustar_guia(mut guia: GuiaRecebido) -> GuiaRecebido {
    guia.ordem.truncate(MAXIMO_DE_PASSOS);
    guia.manter.truncate(MAXIMO_DE_NOS);
    guia.devolver.truncate(MAXIMO_DE_NOS);
    guia.build = encurtar(std::mem::take(&mut guia.build));
    guia.texto = encurtar(std::mem::take(&mut guia.texto));
    for (posicao, passo) in guia.ordem.iter_mut().enumerate() {
        passo.nome = encurtar(std::mem::take(&mut passo.nome));
        passo.rotulo = passo.rotulo.take().map(encurtar);
        let pai_vale = passo.pai >= 0 && (passo.pai as usize) < posicao;
        if !pai_vale {
            passo.pai = -1;
        }
    }
    guia.ate_alvo = guia.ate_alvo.min(guia.ordem.len() as u32);
    guia.numerados = match guia.numerados {
        0 => NUMERADOS_PADRAO,
        n => n.min(MAXIMO_DE_NUMERADOS),
    };
    guia
}

#[cfg(test)]
mod testes {
    use super::*;

    fn arvore_de_tres() -> ArvoreRecebida {
        ArvoreRecebida {
            versao: "teste".into(),
            ids: vec![10, 20, 30],
            xs: vec![0.0, 100.0, 200.0],
            ys: vec![0.0, 0.0, 0.0],
            tipos: vec![5, 0, 1],
            ligacoes: vec![0, 1, 1, 2],
        }
    }

    fn passo(no: u32, pai: i32) -> PassoRecebido {
        PassoRecebido { no, pai, nome: format!("nó {no}"), rotulo: None, solto: false }
    }

    fn guia(ordem: Vec<PassoRecebido>) -> GuiaRecebido {
        GuiaRecebido {
            build: "abc".into(),
            inicio: 10,
            ate_alvo: ordem.len() as u32,
            ordem,
            manter: Vec::new(),
            devolver: Vec::new(),
            texto: "Árvore até Act 3".into(),
            numerados: 8,
        }
    }

    #[test]
    fn arvore_boa_passa_com_os_vizinhos_montados() {
        let arvore = conferir_arvore(arvore_de_tres()).unwrap();
        assert_eq!(arvore.ids, vec![10, 20, 30]);
        assert_eq!(arvore.vizinhos[1], vec![0, 2]);
    }

    #[test]
    fn arvore_ruim_e_recusada_com_frase() {
        let mut vazia = arvore_de_tres();
        vazia.ids.clear();
        assert!(conferir_arvore(vazia).is_err());

        let mut torta = arvore_de_tres();
        torta.xs.pop();
        assert!(conferir_arvore(torta).unwrap_err().contains("tamanhos"));

        let mut sem_par = arvore_de_tres();
        sem_par.ligacoes.push(0);
        assert!(conferir_arvore(sem_par).unwrap_err().contains("par"));

        let mut infinita = arvore_de_tres();
        infinita.ys[1] = f32::NAN;
        assert!(conferir_arvore(infinita).unwrap_err().contains("número"));

        let mut fora = arvore_de_tres();
        fora.ligacoes = vec![0, 3];
        assert!(conferir_arvore(fora).unwrap_err().contains("não existe"));

        let mut grande = arvore_de_tres();
        grande.ids = vec![1; MAXIMO_DE_NOS + 1];
        assert!(conferir_arvore(grande).unwrap_err().contains("máximo"));
    }

    #[test]
    fn guia_e_posto_dentro_dos_limites() {
        let mut ordem: Vec<PassoRecebido> =
            (0..MAXIMO_DE_PASSOS as u32 + 50).map(|i| passo(i, i as i32 - 1)).collect();
        ordem[3].pai = 3; // aponta pra si mesmo
        ordem[4].pai = 4000; // aponta pra depois
        ordem[5].pai = -7;
        ordem[6].nome = "é".repeat(MAXIMO_DE_LETRAS + 30);
        ordem[6].rotulo = Some("x".repeat(MAXIMO_DE_LETRAS * 2));
        let mut recebido = guia(ordem);
        recebido.numerados = 0;
        recebido.ate_alvo = u32::MAX;
        let ajustado = ajustar_guia(recebido);
        assert_eq!(ajustado.ordem.len(), MAXIMO_DE_PASSOS);
        assert_eq!(ajustado.ate_alvo as usize, MAXIMO_DE_PASSOS);
        assert_eq!(ajustado.numerados, NUMERADOS_PADRAO);
        assert_eq!(ajustado.ordem[2].pai, 1);
        assert_eq!(ajustado.ordem[3].pai, -1);
        assert_eq!(ajustado.ordem[4].pai, -1);
        assert_eq!(ajustado.ordem[5].pai, -1);
        assert_eq!(ajustado.ordem[6].nome.chars().count(), MAXIMO_DE_LETRAS);
        assert_eq!(ajustado.ordem[6].rotulo.as_ref().map(|r| r.len()), Some(MAXIMO_DE_LETRAS));

        let mut muitos = guia(vec![passo(20, -1)]);
        muitos.numerados = 999;
        assert_eq!(ajustar_guia(muitos).numerados, MAXIMO_DE_NUMERADOS);
    }

    #[test]
    fn situacao_diz_de_qual_guia_e() {
        // Sem guia: "", 0 e 0, com os nomes que o painel espera.
        let vazia = serde_json::to_value(SituacaoDaArvore::default()).unwrap();
        assert_eq!(vazia["build"], "");
        assert_eq!(vazia["ate_alvo"], 0);
        assert_eq!(vazia["passos"], 0);
        let situacao = SituacaoDaArvore { build: "abc".into(), ate_alvo: 87, passos: 120, ..Default::default() };
        let enviada = serde_json::to_value(&situacao).unwrap();
        assert_eq!((enviada["build"].as_str(), enviada["ate_alvo"].as_u64(), enviada["passos"].as_u64()), (Some("abc"), Some(87), Some(120)));
        // Guia diferente é situação diferente (o fio publica de novo).
        assert_ne!(situacao, SituacaoDaArvore { ate_alvo: 88, ..situacao.clone() });
    }

    #[test]
    fn limite_de_texto_conta_letras_e_nao_bytes() {
        // "é" ocupa 2 bytes: no limite exato de letras nada é cortado nem recusado.
        let no_limite = "é".repeat(MAXIMO_DE_LETRAS);
        assert_eq!(encurtar(no_limite.clone()), no_limite);
        assert_eq!(encurtar(format!("{no_limite}é")), no_limite);
        let mut arvore = arvore_de_tres();
        arvore.versao = no_limite;
        assert!(conferir_arvore(arvore).is_ok());
        let mut comprida = arvore_de_tres();
        comprida.versao = "é".repeat(MAXIMO_DE_LETRAS + 1);
        assert!(conferir_arvore(comprida).unwrap_err().contains("comprida"));
    }

    /// O único teste que mexe no estado combinado (os outros usam as funções puras, pra não
    /// brigarem entre si rodando ao mesmo tempo).
    #[test]
    fn trocar_arvore_e_guia_sobe_a_versao() {
        let antes = versao_de_agora();
        assert_eq!(definir_arvore(arvore_de_tres()), Ok(3));
        assert_eq!(definir_guia(Some(guia(vec![passo(20, -1), passo(30, 0)]))), 2);
        let (versao, arvore, guia_de_agora) = combinado_de_agora();
        assert_eq!(versao, antes.wrapping_add(2));
        assert_eq!(arvore.map(|a| a.ids.len()), Some(3));
        assert_eq!(guia_de_agora.map(|g| g.ordem.len()), Some(2));

        let mut ruim = arvore_de_tres();
        ruim.tipos.clear();
        assert!(definir_arvore(ruim).is_err());
        assert_eq!(versao_de_agora(), versao, "árvore recusada não troca nada");

        assert_eq!(definir_guia(None), 0);
        assert!(combinado_de_agora().2.is_none());
    }
}
