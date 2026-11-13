//! O filtro de itens da build: cria na pasta do jogo (`Documentos\My Games\Path of Exile`) um
//! arquivo NOVO, com o nome da build ("Elementalist Leveling.filter"), que tem os destaques da build
//! em cima e, embaixo, o filtro que o jogador já usa, inteiro e sem mudança. O jogo não troca de
//! filtro sozinho: o jogador escolhe o arquivo novo nas opções.
//!
//! O filtro base pode ser um arquivo `.filter` da pasta ou um filtro online (os que o jogador segue
//! no site do jogo, que o jogo baixa em `OnlineFilters\<id>`). Os filtros do jogador e o arquivo
//! de opções do jogo são só lidos: o guia só grava arquivos que ele mesmo criou (os que começam com
//! a `MARCA_DA_BASE`) e nunca por cima de um filtro do jogador.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;

/// Primeira linha dos arquivos que o guia cria: de qual filtro base ele saiu (pra sugerir o mesmo
/// da próxima vez). É também por ela que o guia reconhece os arquivos dele.
const MARCA_DA_BASE: &str = "# Guia de leveling - filtro base: ";
const SEM_BASE: &str = "nenhum";
/// A linha dos destaques que diz de qual build eles são. Quem escreve é a tela (`filtroDaBuild`,
/// em `nucleo/filtro.ts`): `# Guia de leveling: destaques da build "<título>".`
const MARCA_DA_BUILD: &str = "# Guia de leveling: destaques da build \"";
/// A subpasta onde o jogo guarda os filtros online.
const PASTA_ONLINE: &str = "OnlineFilters";
/// Os destaques são uns poucos blocos; 256 KB sobra.
const LIMITE_DOS_DESTAQUES: usize = 256 * 1024;
/// O NeverSink tem uns 500 KB.
const LIMITE_DA_BASE: u64 = 8 * 1024 * 1024;
/// Nome do filtro novo, em letras (sem o `.filter`).
const LIMITE_DO_NOME: usize = 60;

/// `Documentos\My Games\Path of Exile`.
pub fn pasta(documentos: &Path) -> PathBuf {
    documentos.join("My Games").join("Path of Exile")
}

/// Um filtro que pode servir de base.
#[derive(Serialize, Debug, PartialEq, Clone)]
pub struct Filtro {
    /// Como o guia pede ele de volta: o nome do arquivo (`NeverSink.filter`) ou
    /// `OnlineFilters/<id>` pros online.
    pub arquivo: String,
    /// Como aparece no jogo: o nome do arquivo sem `.filter`, ou o `#name:` do filtro online.
    pub nome: String,
    pub online: bool,
}

/// Os filtros que estão na pasta do jogo.
#[derive(Serialize, Debug, PartialEq)]
pub struct Filtros {
    pub pasta: String,
    /// A pasta do jogo existe (o jogo já foi aberto alguma vez).
    pub existe: bool,
    /// O filtro escolhido nas opções do jogo (`item_filter=`), se é um arquivo.
    pub escolhido: Option<String>,
    /// O filtro base pra sugerir (`arquivo` de um dos `filtros`).
    pub base_sugerida: Option<String>,
    /// Os filtros do jogador: os online primeiro, depois os arquivos (sem os que o guia criou).
    pub filtros: Vec<Filtro>,
    /// Os arquivos que o guia já criou.
    pub do_guia: Vec<String>,
}

/// Um filtro que o guia criou e de qual build ele é.
#[derive(Serialize, Debug, PartialEq)]
pub struct DoGuia {
    /// O arquivo (`Ranger Leveling.filter`).
    pub arquivo: String,
    /// Como aparece no jogo (`Ranger Leveling`).
    pub nome: String,
    /// O título da build dos destaques (`None` se o arquivo não diz).
    pub build: Option<String>,
}

/// O filtro que o jogo está usando e os que o guia criou, do mais novo pro mais velho: com isso a
/// tela vê se o jogo ficou num filtro de outra build.
#[derive(Serialize, Debug, PartialEq)]
pub struct NoJogo {
    /// O arquivo escolhido nas opções do jogo (`None` num filtro online ou sem filtro).
    pub escolhido: Option<String>,
    pub do_guia: Vec<DoGuia>,
}

/// O que foi gravado.
#[derive(Serialize, Debug, PartialEq)]
pub struct Gravado {
    /// O arquivo novo (`Elementalist Leveling.filter`).
    pub arquivo: String,
    /// Como ele aparece na lista do jogo (`Elementalist Leveling`).
    pub nome: String,
    pub pasta: String,
    /// O nome do filtro base, como aparece no jogo.
    pub base: Option<String>,
    /// Já havia um arquivo do guia com esse nome (foi trocado pelo novo).
    pub trocou: bool,
    /// O jogo já está com esse filtro escolhido (aí basta recarregar).
    pub ja_escolhido: bool,
}

pub fn listar(documentos: &Path) -> Filtros {
    let pasta = pasta(documentos);
    let mut locais = Vec::new();
    let mut do_guia: Vec<(String, SystemTime)> = Vec::new();
    for (nome, quando) in arquivos(&pasta) {
        if !nome_de_filtro_local(&nome) {
            continue;
        }
        if base_do_guia(&pasta.join(&nome)).is_some() {
            do_guia.push((nome, quando));
        } else {
            locais.push(Filtro { nome: sem_extensao(&nome).to_string(), arquivo: nome, online: false });
        }
    }
    let mut online: Vec<(Filtro, SystemTime)> = arquivos(&pasta.join(PASTA_ONLINE))
        .into_iter()
        .filter(|(id, _)| id_online_valido(id))
        .map(|(id, quando)| {
            let nome = nome_do_online(&pasta.join(PASTA_ONLINE).join(&id)).unwrap_or_else(|| id.clone());
            (Filtro { arquivo: format!("{PASTA_ONLINE}/{id}"), nome: format!("{nome} (online)"), online: true }, quando)
        })
        .collect();
    locais.sort_by_key(|f| f.nome.to_lowercase());
    online.sort_by_key(|(f, _)| f.nome.to_lowercase());
    do_guia.sort_by_key(|(nome, _)| nome.to_lowercase());

    let escolhido = escolhido_no_jogo(&pasta);
    let existe = |arquivo: &str| locais.iter().chain(online.iter().map(|(f, _)| f)).any(|f| f.arquivo == arquivo);
    // 1. O que está escolhido no jogo (se é um arquivo do guia, a base dele).
    let do_escolhido = escolhido.as_deref().and_then(|escolhido| {
        if do_guia.iter().any(|(nome, _)| nome == escolhido) {
            base_do_guia(&pasta.join(escolhido))
        } else {
            Some(escolhido.to_string())
        }
    });
    // 2. O filtro online baixado por último. Com um filtro online em uso o jogo grava
    //    `item_filter=None`, então sem arquivo escolhido o jogo está, quase sempre, num online.
    let do_online = online.iter().max_by_key(|(_, quando)| *quando).map(|(f, _)| f.arquivo.clone());
    // 3. A base do último filtro que o guia criou. Vem depois do online porque o guia antigo não
    //    via os filtros online e criava em cima de outro arquivo.
    let do_ultimo_do_guia =
        do_guia.iter().max_by_key(|(_, quando)| *quando).and_then(|(nome, _)| base_do_guia(&pasta.join(nome)));
    let base_sugerida = [do_escolhido, do_online, do_ultimo_do_guia]
        .into_iter()
        .flatten()
        .find(|base| existe(base));

    let mut filtros: Vec<Filtro> = online.into_iter().map(|(f, _)| f).collect();
    filtros.extend(locais);
    Filtros {
        pasta: pasta.display().to_string(),
        existe: pasta.is_dir(),
        escolhido,
        base_sugerida,
        filtros,
        do_guia: do_guia.into_iter().map(|(nome, _)| nome).collect(),
    }
}

/// Cria o filtro `nome` (sem `.filter`): os destaques (`destaques`, texto de filtro pronto) em cima
/// do filtro `base` (o `arquivo` de um dos filtros da lista).
pub fn gravar(documentos: &Path, nome: &str, destaques: &str, base: Option<&str>) -> Result<Gravado, String> {
    let pasta = pasta(documentos);
    if !pasta.is_dir() {
        return Err("Não achei a pasta do jogo (Documentos\\My Games\\Path of Exile). Abra o jogo uma vez e tente de novo.".into());
    }
    if destaques.trim().is_empty() {
        return Err("A build não tem nada pra destacar no filtro.".into());
    }
    if destaques.len() > LIMITE_DOS_DESTAQUES || destaques.contains('\0') {
        return Err("Os destaques do filtro vieram estragados.".into());
    }
    let nome = nome_do_filtro_novo(nome)?;
    let arquivo = format!("{nome}.filter");
    let destino = pasta.join(&arquivo);
    let trocou = destino.exists();
    if trocou && base_do_guia(&destino).is_none() {
        return Err(format!(
            "Já existe um filtro seu chamado \"{nome}\". O guia não grava por cima dos seus filtros: escolha outro nome."
        ));
    }
    let base = match base {
        Some(base) => Some(ler_base(&pasta, base)?),
        None => None,
    };

    let mut saida = format!("{MARCA_DA_BASE}{}\r\n", base.as_ref().map_or(SEM_BASE, |b| b.arquivo.as_str()));
    saida.push_str(&com_crlf(destaques.trim_end()));
    saida.push_str("\r\n\r\n");
    if let Some(base) = &base {
        saida.push_str(&format!("# ===== Daqui pra baixo: o filtro \"{}\", sem mudança =====\r\n\r\n", base.nome));
        saida.push_str(&com_crlf(base.texto.trim_start_matches('\u{feff}')));
    }

    // Grava num arquivo ao lado e troca de uma vez, pra o jogo nunca ler um arquivo pela metade.
    let provisorio = pasta.join(format!("{arquivo}.novo"));
    fs::write(&provisorio, saida.as_bytes()).map_err(|erro| format!("Não consegui gravar o filtro: {erro}"))?;
    // O OneDrive (ou o antivírus) às vezes segura o arquivo por um instante: tenta de novo antes de desistir.
    let mut trocado = fs::rename(&provisorio, &destino);
    for _ in 0..3 {
        if trocado.is_ok() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
        trocado = fs::rename(&provisorio, &destino);
    }
    if let Err(erro) = trocado {
        let _ = fs::remove_file(&provisorio);
        return Err(format!("Não consegui gravar o filtro: {erro}"));
    }
    Ok(Gravado {
        ja_escolhido: escolhido_no_jogo(&pasta).is_some_and(|e| e.eq_ignore_ascii_case(&arquivo)),
        arquivo,
        nome,
        pasta: pasta.display().to_string(),
        base: base.map(|b| b.nome),
        trocou,
    })
}

/// Qual filtro o jogo está usando e os filtros que o guia criou. Lê só o `production_Config.ini`
/// (que o jogo grava assim que o jogador troca de filtro) e o começo de cada `.filter`.
pub fn no_jogo(documentos: &Path) -> NoJogo {
    let pasta = pasta(documentos);
    let mut do_guia: Vec<(DoGuia, SystemTime)> = arquivos(&pasta)
        .into_iter()
        .filter(|(nome, _)| nome_de_filtro_local(nome))
        .filter_map(|(nome, quando)| {
            let (_, build) = cabecalho_do_guia(&pasta.join(&nome))?;
            Some((DoGuia { nome: sem_extensao(&nome).to_string(), arquivo: nome, build }, quando))
        })
        .collect();
    do_guia.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.arquivo.cmp(&b.0.arquivo)));
    NoJogo { escolhido: escolhido_no_jogo(&pasta), do_guia: do_guia.into_iter().map(|(f, _)| f).collect() }
}

/// Os arquivos de uma pasta, com a hora da última mudança.
fn arquivos(pasta: &Path) -> Vec<(String, SystemTime)> {
    let Ok(entradas) = fs::read_dir(pasta) else { return Vec::new() };
    entradas
        .filter_map(|entrada| entrada.ok())
        .filter(|entrada| entrada.file_type().is_ok_and(|tipo| tipo.is_file()))
        .filter_map(|entrada| {
            let quando = entrada.metadata().and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH);
            entrada.file_name().into_string().ok().map(|nome| (nome, quando))
        })
        .collect()
}

/// Um nome de arquivo de filtro da própria pasta (sem caminho).
fn nome_de_filtro_local(nome: &str) -> bool {
    nome.to_lowercase().ends_with(".filter") && !nome.contains(['/', '\\', ':'])
}

/// O id de um filtro online (o nome do arquivo em `OnlineFilters`): só letras e números.
fn id_online_valido(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric())
}

fn sem_extensao(nome: &str) -> &str {
    if nome.to_lowercase().ends_with(".filter") {
        &nome[..nome.len() - ".filter".len()]
    } else {
        nome
    }
}

/// O começo de um arquivo (pra ler o cabeçalho sem carregar 500 KB).
fn comeco(caminho: &Path, bytes: usize) -> Option<String> {
    let mut arquivo = fs::File::open(caminho).ok()?;
    let mut buffer = vec![0u8; bytes];
    let lidos = arquivo.read(&mut buffer).ok()?;
    buffer.truncate(lidos);
    Some(String::from_utf8_lossy(&buffer).into_owned())
}

/// Se o arquivo foi criado pelo guia: de qual base ele saiu (`None` se não é do guia ou não tem base).
/// Um arquivo do guia sem base devolve `Some("")`.
fn base_do_guia(caminho: &Path) -> Option<String> {
    cabecalho_do_guia(caminho).map(|(base, _)| base)
}

/// O cabeçalho de um arquivo do guia: a base (como em `base_do_guia`) e o título da build dos
/// destaques. `None` se o arquivo não é do guia.
fn cabecalho_do_guia(caminho: &Path) -> Option<(String, Option<String>)> {
    let texto = comeco(caminho, 1024)?;
    let mut linhas = texto.trim_start_matches('\u{feff}').lines();
    let base = linhas.next()?.strip_prefix(MARCA_DA_BASE)?.trim();
    let base = if base == SEM_BASE { String::new() } else { base.to_string() };
    let build = linhas
        .take(5)
        .find_map(|linha| linha.trim().strip_prefix(MARCA_DA_BUILD)?.strip_suffix("\".").map(str::to_string));
    Some((base, build))
}

/// O nome que o jogador deu ao filtro online (`#name:` no cabeçalho que o jogo grava).
fn nome_do_online(caminho: &Path) -> Option<String> {
    let texto = comeco(caminho, 4096)?;
    texto
        .lines()
        .take(20)
        .find_map(|linha| linha.trim().strip_prefix("#name:"))
        .map(|nome| nome.trim().to_string())
        .filter(|nome| !nome.is_empty())
}

/// Confere o nome do filtro novo (vira nome de arquivo) e tira o `.filter`, se veio junto.
fn nome_do_filtro_novo(nome: &str) -> Result<String, String> {
    let nome = sem_extensao(nome.trim()).trim();
    if nome.is_empty() {
        return Err("Dê um nome ao filtro.".into());
    }
    if nome.chars().count() > LIMITE_DO_NOME {
        return Err(format!("O nome do filtro pode ter até {LIMITE_DO_NOME} letras."));
    }
    if let Some(ruim) = nome.chars().find(|c| c.is_control() || "\\/:*?\"<>|".contains(*c)) {
        return Err(format!("O nome do filtro não pode ter \"{ruim}\"."));
    }
    if nome.starts_with('.') || nome.ends_with('.') {
        return Err("O nome do filtro não pode começar nem terminar com ponto.".into());
    }
    let maiusculo = nome.to_uppercase();
    let reservado = ["CON", "PRN", "AUX", "NUL"].contains(&maiusculo.as_str())
        || ((maiusculo.starts_with("COM") || maiusculo.starts_with("LPT"))
            && maiusculo.len() == 4
            && maiusculo.as_bytes()[3].is_ascii_digit());
    if reservado {
        return Err(format!("\"{nome}\" é um nome reservado do Windows."));
    }
    Ok(nome.to_string())
}

struct Base {
    arquivo: String,
    nome: String,
    texto: String,
}

fn ler_base(pasta: &Path, arquivo: &str) -> Result<Base, String> {
    let (caminho, nome) = if let Some(id) = arquivo.strip_prefix(&format!("{PASTA_ONLINE}/")) {
        if !id_online_valido(id) {
            return Err(format!("\"{arquivo}\" não serve de filtro base."));
        }
        let caminho = pasta.join(PASTA_ONLINE).join(id);
        let nome = nome_do_online(&caminho).unwrap_or_else(|| id.to_string());
        (caminho, nome)
    } else {
        if !nome_de_filtro_local(arquivo) {
            return Err(format!("\"{arquivo}\" não serve de filtro base."));
        }
        (pasta.join(arquivo), sem_extensao(arquivo).to_string())
    };
    let tamanho = fs::metadata(&caminho)
        .map_err(|_| format!("O filtro \"{nome}\" não está mais na pasta do jogo."))?
        .len();
    if tamanho > LIMITE_DA_BASE {
        return Err(format!("O filtro \"{nome}\" é grande demais."));
    }
    if base_do_guia(&caminho).is_some() {
        return Err(format!("\"{nome}\" foi criado pelo guia: escolha o seu filtro de sempre como base."));
    }
    let bytes = fs::read(&caminho).map_err(|erro| format!("Não consegui ler o filtro \"{nome}\": {erro}"))?;
    Ok(Base { arquivo: arquivo.to_string(), nome, texto: String::from_utf8_lossy(&bytes).into_owned() })
}

/// O filtro escolhido nas opções do jogo (`item_filter=` no `production_Config.ini`).
fn escolhido_no_jogo(pasta: &Path) -> Option<String> {
    let bytes = fs::read(pasta.join("production_Config.ini")).ok()?;
    let texto = String::from_utf8_lossy(&bytes);
    texto
        .lines()
        .find_map(|linha| linha.trim().strip_prefix("item_filter="))
        .map(|valor| valor.trim().to_string())
        .filter(|valor| valor.to_lowercase().ends_with(".filter"))
}

fn com_crlf(texto: &str) -> String {
    texto.replace("\r\n", "\n").replace('\n', "\r\n")
}

#[cfg(test)]
mod testes {
    use super::*;

    /// Uma pasta "Documentos" de mentira, apagada no fim.
    struct Documentos(PathBuf);
    impl Documentos {
        fn novos(nome: &str) -> Self {
            let raiz = std::env::temp_dir().join(format!("guia-filtro-{nome}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&raiz);
            fs::create_dir_all(pasta(&raiz)).unwrap();
            Documentos(raiz)
        }
        fn gravar(&self, nome: &str, texto: &str) {
            let caminho = pasta(&self.0).join(nome);
            fs::create_dir_all(caminho.parent().unwrap()).unwrap();
            fs::write(caminho, texto).unwrap();
        }
        fn ler(&self, nome: &str) -> String {
            fs::read_to_string(pasta(&self.0).join(nome)).unwrap()
        }
    }
    impl Drop for Documentos {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const ONLINE: &str = "#Online Item Filter\n#name:Leveling 3.29 Filter\n#version:3.29.3d\n#errors:\n#===\r\nShow\r\n\tBaseType \"Iron Ring\"\r\n";

    #[test]
    fn cria_um_arquivo_novo_com_os_destaques_em_cima_da_base() {
        let docs = Documentos::novos("gravar");
        docs.gravar("NeverSink.filter", "\u{feff}Show\r\n\tBaseType \"Iron Ring\"\r\n");
        let gravado = gravar(&docs.0, "Witch Leveling", "# destaques\nShow\n\tAreaLevel <= 67\n", Some("NeverSink.filter")).unwrap();
        assert_eq!(gravado.arquivo, "Witch Leveling.filter");
        assert_eq!(gravado.nome, "Witch Leveling");
        assert_eq!(gravado.base.as_deref(), Some("NeverSink"));
        assert!(!gravado.trocou);
        let texto = docs.ler("Witch Leveling.filter");
        assert!(texto.starts_with("# Guia de leveling - filtro base: NeverSink.filter\r\n# destaques\r\nShow\r\n\tAreaLevel <= 67\r\n"));
        assert!(texto.ends_with("=====\r\n\r\nShow\r\n\tBaseType \"Iron Ring\"\r\n"));
        assert!(!texto.contains('\u{feff}'));
        assert!(!pasta(&docs.0).join("Witch Leveling.filter.novo").exists());
        // O filtro do jogador continua igual.
        assert_eq!(docs.ler("NeverSink.filter"), "\u{feff}Show\r\n\tBaseType \"Iron Ring\"\r\n");
    }

    #[test]
    fn usa_um_filtro_online_de_base() {
        let docs = Documentos::novos("online");
        docs.gravar("OnlineFilters/BOo62qFx", ONLINE);
        let filtros = listar(&docs.0);
        assert_eq!(
            filtros.filtros,
            vec![Filtro {
                arquivo: "OnlineFilters/BOo62qFx".into(),
                nome: "Leveling 3.29 Filter (online)".into(),
                online: true
            }]
        );
        // Sem nada escolhido no jogo, sugere o online.
        assert_eq!(filtros.base_sugerida.as_deref(), Some("OnlineFilters/BOo62qFx"));
        let gravado = gravar(&docs.0, "Elementalist Leveling.filter", "Show\n", Some("OnlineFilters/BOo62qFx")).unwrap();
        assert_eq!(gravado.arquivo, "Elementalist Leveling.filter");
        assert_eq!(gravado.base.as_deref(), Some("Leveling 3.29 Filter"));
        let texto = docs.ler("Elementalist Leveling.filter");
        assert!(texto.starts_with("# Guia de leveling - filtro base: OnlineFilters/BOo62qFx\r\nShow\r\n"));
        assert!(texto.contains("o filtro \"Leveling 3.29 Filter\", sem mudança"));
        // As linhas do cabeçalho online (só LF) viram CRLF como o resto.
        assert!(texto.contains("#Online Item Filter\r\n#name:Leveling 3.29 Filter\r\n"));
        assert!(!texto.replace("\r\n", "").contains('\n'));
        assert!(texto.ends_with("Show\r\n\tBaseType \"Iron Ring\"\r\n"));
    }

    #[test]
    fn sem_base_grava_so_os_destaques() {
        let docs = Documentos::novos("sem-base");
        gravar(&docs.0, "Witch Leveling", "Show\n", None).unwrap();
        assert_eq!(docs.ler("Witch Leveling.filter"), "# Guia de leveling - filtro base: nenhum\r\nShow\r\n\r\n");
    }

    #[test]
    fn nunca_grava_por_cima_de_um_filtro_do_jogador() {
        let docs = Documentos::novos("por-cima");
        docs.gravar("Meu.filter", "Show\r\n");
        let erro = gravar(&docs.0, "Meu", "Show\n", None).unwrap_err();
        assert!(erro.contains("Já existe um filtro seu"));
        assert_eq!(docs.ler("Meu.filter"), "Show\r\n");
        // Um arquivo que o próprio guia criou é trocado pelo novo.
        gravar(&docs.0, "Witch Leveling", "Show\n", Some("Meu.filter")).unwrap();
        let de_novo = gravar(&docs.0, "Witch Leveling", "Hide\n", Some("Meu.filter")).unwrap();
        assert!(de_novo.trocou);
        assert!(docs.ler("Witch Leveling.filter").contains("Hide\r\n"));
    }

    #[test]
    fn recusa_nome_ou_base_ruins() {
        let docs = Documentos::novos("recusa");
        docs.gravar("A.filter", "Show\r\n");
        gravar(&docs.0, "Do Guia", "Show\n", None).unwrap();
        for nome in ["", "  ", ".filter", "a/b", "a\\b", "C:x", "x?", "x*", "x\"", "con", "COM1", "lpt9", "fim.", &"x".repeat(61)] {
            assert!(gravar(&docs.0, nome, "Show", None).is_err(), "aceitou o nome {nome:?}");
        }
        assert!(gravar(&docs.0, "Novo", "Show", Some("..\\..\\outro.filter")).is_err());
        assert!(gravar(&docs.0, "Novo", "Show", Some("OnlineFilters/../A.filter")).is_err());
        assert!(gravar(&docs.0, "Novo", "Show", Some("OnlineFilters/nao-existe")).is_err());
        assert!(gravar(&docs.0, "Novo", "Show", Some("nao-existe.filter")).is_err());
        assert!(gravar(&docs.0, "Novo", "Show", Some("production_Config.ini")).is_err());
        // Um filtro do guia não serve de base (o guia não empilha destaque em cima de destaque).
        assert!(gravar(&docs.0, "Novo", "Show", Some("Do Guia.filter")).is_err());
        assert!(gravar(&docs.0, "Novo", "  ", None).is_err());
        assert!(!pasta(&docs.0).join("Novo.filter").exists());
    }

    #[test]
    fn sugere_o_filtro_do_jogo_ou_a_base_do_guia() {
        let docs = Documentos::novos("listar");
        docs.gravar("B.filter", "");
        docs.gravar("a.filter", "");
        docs.gravar("production_Config.ini", "[UI]\nitem_filter_loaded_successfully=B.filter\nitem_filter=B.filter\n");
        let filtros = listar(&docs.0);
        let arquivos: Vec<&str> = filtros.filtros.iter().map(|f| f.arquivo.as_str()).collect();
        assert_eq!(arquivos, vec!["a.filter", "B.filter"]);
        assert_eq!(filtros.filtros[0].nome, "a");
        assert_eq!(filtros.escolhido.as_deref(), Some("B.filter"));
        assert_eq!(filtros.base_sugerida.as_deref(), Some("B.filter"));
        assert!(filtros.existe);

        // Escolhido no jogo o arquivo do guia: sugere a base dele, e ele sai da lista de bases.
        gravar(&docs.0, "Witch Leveling", "Show", Some("a.filter")).unwrap();
        docs.gravar("production_Config.ini", "item_filter=Witch Leveling.filter\r\n");
        let filtros = listar(&docs.0);
        let arquivos: Vec<&str> = filtros.filtros.iter().map(|f| f.arquivo.as_str()).collect();
        assert_eq!(arquivos, vec!["a.filter", "B.filter"]);
        assert_eq!(filtros.do_guia, vec!["Witch Leveling.filter"]);
        assert_eq!(filtros.escolhido.as_deref(), Some("Witch Leveling.filter"));
        assert_eq!(filtros.base_sugerida.as_deref(), Some("a.filter"));
        let de_novo = gravar(&docs.0, "Witch Leveling", "Show", Some("a.filter")).unwrap();
        assert!(de_novo.ja_escolhido);

        // Sem arquivo escolhido e sem filtro online: a base do último filtro que o guia criou.
        docs.gravar("production_Config.ini", "item_filter=None\r\n");
        assert_eq!(listar(&docs.0).base_sugerida.as_deref(), Some("a.filter"));
        // Com um filtro online baixado, "None" quer dizer que o jogo está nele: vale mais que a base
        // de um filtro antigo do guia (o guia antigo não via os filtros online).
        docs.gravar("OnlineFilters/X1", ONLINE);
        assert_eq!(listar(&docs.0).base_sugerida.as_deref(), Some("OnlineFilters/X1"));
        // O arquivo antigo "Guia de leveling.filter" (de antes do nome da build) também é do guia.
        docs.gravar("Guia de leveling.filter", "# Guia de leveling - filtro base: nenhum\r\nShow\r\n");
        let filtros = listar(&docs.0);
        assert!(filtros.do_guia.contains(&"Guia de leveling.filter".to_string()));
        assert!(!filtros.filtros.iter().any(|f| f.arquivo == "Guia de leveling.filter"));
        assert_eq!(filtros.filtros[0].arquivo, "OnlineFilters/X1");
    }

    #[test]
    fn diz_o_filtro_do_jogo_e_de_qual_build_sao_os_do_guia() {
        let docs = Documentos::novos("no-jogo");
        docs.gravar("NeverSink.filter", "Show\r\n");
        let destaques = |titulo: &str| format!("# ====\n# Guia de leveling: destaques da build \"{titulo}\".\n# Valem só na campanha\nShow\n");
        gravar(&docs.0, "Hierophant Leveling", &destaques("Shock Nova Hierophant"), None).unwrap();
        gravar(&docs.0, "Ranger Leveling", &destaques("Poisonous \"Concoction\" Ranger"), Some("NeverSink.filter")).unwrap();
        gravar(&docs.0, "Sem Titulo", "Show\n", None).unwrap();
        // O mais novo primeiro (a hora de gravar fica de propósito fora de ordem).
        let hora = |nome: &str, segundos: u64| {
            let arquivo = fs::OpenOptions::new().write(true).open(pasta(&docs.0).join(nome)).unwrap();
            arquivo.set_modified(SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(segundos)).unwrap();
        };
        hora("Hierophant Leveling.filter", 2_000_000_000);
        hora("Ranger Leveling.filter", 1_900_000_000);
        hora("Sem Titulo.filter", 1_800_000_000);
        docs.gravar("production_Config.ini", "[UI]\r\nitem_filter=Hierophant Leveling.filter\r\n");

        let agora = no_jogo(&docs.0);
        assert_eq!(agora.escolhido.as_deref(), Some("Hierophant Leveling.filter"));
        assert_eq!(
            agora.do_guia,
            vec![
                DoGuia {
                    arquivo: "Hierophant Leveling.filter".into(),
                    nome: "Hierophant Leveling".into(),
                    build: Some("Shock Nova Hierophant".into())
                },
                DoGuia {
                    arquivo: "Ranger Leveling.filter".into(),
                    nome: "Ranger Leveling".into(),
                    build: Some("Poisonous \"Concoction\" Ranger".into())
                },
                DoGuia { arquivo: "Sem Titulo.filter".into(), nome: "Sem Titulo".into(), build: None },
            ]
        );
        // O NeverSink não é do guia; com um filtro online o jogo grava "None".
        docs.gravar("production_Config.ini", "item_filter=None\r\n");
        assert_eq!(no_jogo(&docs.0).escolhido, None);
        // Sem a pasta do jogo: nada.
        let raiz = std::env::temp_dir().join(format!("guia-filtro-no-jogo-nada-{}", std::process::id()));
        assert_eq!(no_jogo(&raiz), NoJogo { escolhido: None, do_guia: Vec::new() });
    }

    #[test]
    fn sem_pasta_do_jogo() {
        let raiz = std::env::temp_dir().join(format!("guia-filtro-nada-{}", std::process::id()));
        let filtros = listar(&raiz);
        assert!(!filtros.existe);
        assert!(filtros.filtros.is_empty());
        assert!(gravar(&raiz, "Witch Leveling", "Show", None).is_err());
    }
}
