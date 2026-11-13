# Guia de Leveling

Overlay leve pra campanha do Path of Exile 1 (atos 1 a 10). Você cola o link de uma build e o guia mostra, por cima do jogo, o passo da rota, as gemas pra pegar ou comprar, os itens da build, o layout da zona e, na árvore de passivas, os próximos pontos. Ele avança sozinho lendo o `Client.txt`.

## O que ele faz com o jogo

- Lê o `Client.txt` e a posição da janela do jogo.
- Tira fotos da tela do jogo, só com o jogo na frente, pra três coisas. Cada uma tem a sua opção pra desligar:
  - na cidade, achar o ícone das gemas da build e piscar uma moldura verde em volta, e marcar sozinha a gema que está no inventário (veja "Gema certa piscando na tela");
  - em qualquer lugar, reconhecer a árvore de passivas quando você abre e desenhar por cima os próximos nós (veja "Guia da árvore de passivas");
  - em qualquer lugar, ver se o Mundo, o Baú ou o vendedor está aberto, pra o balão virar bolinha quando está por cima e pros botões de busca aparecerem (veja "Bolinha com o Mundo ou o Baú aberto" e "Busca da loja").
- Essas fotos ficam só na memória do guia: não são gravadas nem enviadas a lugar nenhum. Só o gravador de estudo, que começa desligado, grava fotos no disco.
- Não lê a memória do jogo, não injeta nada no processo dele e não mexe na rede. Não lê o mouse. Do teclado, só recebe as teclas globais da tabela abaixo.
- Só manda teclas pro jogo num caso: quando você segura Alt e clica num botão de busca da loja. Aí ele manda `Ctrl+F`, `Ctrl+V` e `Enter`, uma vez, igual o Awakened PoE Trade faz (veja "Busca da loja"). Fora isso, nenhuma tecla nem clique vai pro jogo.
- Cada tecla global faz uma ação no próprio guia.
- Na pasta do jogo (`Documentos\My Games\Path of Exile`), só lê a lista de filtros e o filtro escolhido no `production_Config.ini`, e só grava o arquivo `Guia de leveling.filter`, quando você clica em "Aplicar filtro da build" (veja "Filtro da build").

## Instalar

`npm run tauri build` gera os dois arquivos abaixo. Eles não ficam no repositório.

| Arquivo | Tamanho | Pra quê |
|---|---|---|
| `src-tauri/target/release/bundle/nsis/Guia de Leveling_0.1.3_x64-setup.exe` | 17 MB | Instalador. Instala só pro seu usuário, sem pedir administrador. |
| `src-tauri/target/release/guia-leveling.exe` | 19 MB | O programa solto. Abre sem instalar. |

Precisa do WebView2, que já vem no Windows 11 e no Windows 10 atualizado.

### Mandar pra outra pessoa

```
node scripts/pacote.mjs
```

Gera `src-tauri/target/pacote/Guia de Leveling <versão>.zip` com o instalador (em português), o `LEIA-ME.txt` (passo a passo pra quem recebe) e o `LICENCAS.txt`. Os dois textos ficam em `distribuir/`, com `{versao}` no lugar da versão.

- Compila em `src-tauri/target/pacote`, separado do build normal, e não mexe no guia aberto. A primeira vez compila tudo do zero.
- O exe sai sem a pasta do usuário: o Rust guardaria nele o caminho das bibliotecas (`C:\Users\<nome>\.cargo\...`), e o script troca esse começo por `~`.
- Antes de fazer o zip, procura no exe, no instalador e na tela embutida o nome do usuário, a pasta dele, o nome do PC e o e-mail do git. Se achar algum, para sem gerar o zip.
- `--sem-compilar` só monta o zip de novo, depois de mexer nos textos.
- O instalador não tem assinatura digital: o Windows mostra "O Windows protegeu o computador" (o LEIA-ME explica o "Executar assim mesmo").

### Repositório público

O código fica aberto em [github.com/irandsj/guia-de-leveling-poe](https://github.com/irandsj/guia-de-leveling-poe). Ele é um espelho da pasta `leveling` só com o que é do programa: o README da vitrine, a licença, as prints (`docs/prints`), o `app` e as licenças de terceiros (`terceiros`). Os estudos, os prompts e as notas do patch não vão.

```
node scripts/publicar.mjs
```

- Copia o que está no git pro clone do público, em `guia-de-leveling-poe` do lado da pasta `POE` (ou na pasta que você passar). Para se tiver mudança sem commit.
- Apaga do clone o que saiu daqui. Antes de copiar, procura nos arquivos os mesmos dados pessoais que o `pacote.mjs`.
- O commit e o push são feitos no clone, à mão. Lá o git usa o e-mail `noreply` do GitHub, pra não mostrar o e-mail de verdade.
- Cada versão nova vai como Release, com o zip do `pacote.mjs`. Use hífen no nome do zip: o GitHub troca espaço por ponto.

## Usar

1. No jogo, escolha "Windowed Fullscreen" (tela cheia em janela) nas opções de vídeo. Em tela cheia exclusiva nenhum overlay aparece, e o guia avisa.
2. Abra o guia, segure `Alt` e clique na engrenagem ⚙ no canto de cima do balão (ou aperte `Ctrl+F2`). Cole o link ou o código da build e clique em **Importar**.
3. Clique em **Pronto**. A partir daí o clique atravessa o guia e vai pro jogo.
4. Jogue. O guia troca de passo quando você entra na zona certa e troca o conjunto de gemas quando o personagem chega no nível do próximo conjunto. O relógio começa na Twilight Strand (veja "Relógio, recordes e XP").

Aceita o código do Path of Building e links do pobb.in, poe.ninja, Maxroll (o link do PoB, o do planner ou a página de um guia), pastebin, rentry, poedb e pob.codes.

O guia sabe quando trocar cada conjunto (gemas, árvore e itens) pelo título que o autor deu no PoB:
- nível ou faixa: `Level 12`, `Level 4 - 12`, `Level 38 - Maps` ou só o número, como `50`;
- ato: `Act 3`, `Act 6+`, `Acts 1-4`;
- parte da campanha: `Early Acts` (do ato 1), `Middle Acts` (do ato 4) e `Late Acts` (do ato 6);
- lab e mapas: `Cruel Lab`, `Maps`, `Early Maps`;
- pontos de passiva da árvore: `30 points` vale como nível 23 mais ou menos;
- `Endgame`, `Ubers`, `Late Maps` e parecidos não entram sozinhos: você escolhe à mão.

Começando no meio da campanha: abra o modo de edição e, em **Corrida**, use "Ir pro ato" ou "Achar pela zona". O nível aparece como estimativa (`nv ~12`) até o personagem subir de nível uma vez.

### Relógio, recordes e XP

- **Relógio:** começa quando você entra na Twilight Strand. Se você aperta "Novo personagem" já dentro dela (até 10 minutos depois de entrar), ou se o guia percebe sozinho a corrida nova, o relógio conta desde a entrada na Twilight Strand, e não desde a próxima zona.
- **Recorde por ato:** quando você passa de um ato pro seguinte, o guia guarda o tempo do ato que acabou e avisa se bateu o recorde (`Ato 2 em 14:05: recorde! Era 15:20.`). Do lado do relógio aparece o recorde do ato atual, e o tempo do ato fica verde enquanto está dentro do recorde e vermelho quando passa.
  - Só conta ato cronometrado do começo ao fim: ato começado no meio, com o guia fechado enquanto o relógio contava ou pulado com "Ir pro ato" não entra.
  - Ato com menos de 2 minutos não conta.
  - No modo de edição, em **Corrida**, a tabela mostra o tempo de cada ato nesta corrida, o recorde e as mortes do ato.
- **Aviso de XP:** mostra quanto de experiência você perde pela diferença entre o seu nível e o nível da zona, pela conta da GGG (faixa segura de 3 + nível/16; acima disso a perda cresce rápido).
  - Verde (`XP 100%`): dentro da faixa, sem perda.
  - Amarelo: perda pequena, até −14%.
  - Vermelho: −15% ou pior. No nível 30, 1 nível além da faixa já dá −4% e 2 níveis dão −20%.
  - O nível da zona vem do `Client.txt`. Na cidade e no hideout o aviso some.

### Teclas

| Tecla | O que faz |
|---|---|
| `Ctrl+F2` | Abre e fecha o modo de edição (o guia passa a aceitar clique e dá pra arrastar e redimensionar). O mesmo que segurar `Alt` e clicar na engrenagem ⚙ do balão |
| `F2` | Esconde e mostra o guia |
| `F3` e `F4` | Volta e avança um passo |
| `F6` | Layout da zona: abre as opções, passa por cada uma e fecha |
| `F7` | Acha o passo pela zona em que você está |
| `Ctrl+F3` | Troca o tamanho do balão: bolinha, normal e expandido, em ciclo |
| `←` `↓` e `→` `↑` | Com a árvore de passivas aberta: etapa anterior e próxima etapa da árvore |

- `Ctrl+F2` vale sempre. As outras só valem com o jogo ou o guia na frente, pra não tirar essas teclas dos outros programas. Dá pra mudar isso em **Opções**.
- As setas só são do guia com o jogo na frente, a árvore de passivas aberta nele e o modo de edição fechado. Fechou a árvore, as setas voltam pro jogo. Elas não mudam no `config.json`, e seta que você puser em outra tecla do guia fica com essa outra ação.
- Pra trocar as teclas, feche o guia e edite `atalhos` no `config.json`. Use teclas F, sozinhas ou com Ctrl ou Alt (por exemplo `"Alt+F8"`). Nunca use uma tecla que o jogo usa: o guia não confere isso.
- O ícone perto do relógio do Windows tem "Mostrar / esconder", "Configurar (modo de edição)" e "Sair".

### Onde ficam os dados

Em `%APPDATA%\br.guialeveling.overlay\`:

- `config.json`: teclas, posição da janela e caminho do `Client.txt`.
- `plano.json`: a build importada.
- `progresso.json`: passo, nível, tempo e mortes (por ato também). O guia retoma de onde parou.
- `recordes.json`: o melhor tempo de cada ato e as mortes daquela corrida.
- `preferencias.json`: o que aparece na tela, o tamanho do texto e as duas leituras de tela (gemas e árvore), ligadas ou não.

O filtro da build fica na pasta do jogo, em `Documentos\My Games\Path of Exile\Guia de leveling.filter`.

O guia acha o `Client.txt` sozinho (Steam ou instalação normal). Se não achar, escreva o caminho em **Opções**.

## Consumo

Medido em 10 e 11/11/2026 com a versão final (0.1.0), no Windows 11, num PC de 32 núcleos. O guia ficou na tela, com uma build importada, por 60 s em cada situação. A memória é só a do guia, como na coluna "Memória" do Gerenciador de Tarefas, somando o programa e os processos do WebView2.

| Situação | Memória | CPU |
|---|---|---|
| Relógio parado | 94 MB | 0,01% do computador (0,3% de um núcleo) |
| Relógio contando | 91 a 93 MB | 0,01% do computador (0,3% de um núcleo) |
| Relógio contando, com o layout da zona aberto (7 imagens) | 101 a 102 MB | 0,02% do computador (0,5% a 0,6% de um núcleo) |
| Logo depois de passar pelas 138 zonas com o layout aberto (uma por segundo) | 120 MB | 0,01% a 0,05% do computador (0,4% a 1,7% de um núcleo) |
| Com a árvore de passivas do jogo aberta (guia da árvore) | ainda não medido | ainda não medido |

- Estes números são de antes do guia da árvore e foram medidos com o jogo fechado, ou seja, sem nenhuma leitura de tela. Com o jogo na frente e o guia da árvore ligado, o guia tira uma foto pequena por segundo pra saber se a árvore abriu. Com a árvore aberta, guarda uma foto inteira da área do jogo e o desenho do mesmo tamanho, e solta os dois quando ela fecha. Quanto isso gasta ainda não foi medido.
- A meta era menos de 100 MB. O guia fica dentro dela com o painel de layout fechado. Com o painel aberto numa zona de 7 imagens, passa 1 a 2 MB.
- Sessão longa com o layout aberto: depois de passar por todas as zonas a memória sobe pra 120 MB e, um minuto parado depois, desce pra 107 a 108 MB. Ou seja, o painel aberto a campanha inteira deixa o guia uns 7 a 20 MB acima da meta. O que cresce é a parte de imagens do WebView2 (placa de vídeo e página).
- Quase tudo é do WebView2: navegador 28 MB, placa de vídeo 26 MB, página 18 MB e rede 9 MB. O programa em si usa 5 MB.
- As duas primeiras linhas foram medidas três vezes. As duas do layout, duas vezes.

Pra medir de novo, com o jogo fechado (leva uns 10 minutos):

```
node scripts/e2e.mjs --exe src-tauri/target/release/guia-leveling.exe --sem-teclas --medir 60
```

## Gema certa piscando na tela

Com o personagem na cidade, o guia procura na tela as gemas que a build ainda vai pegar ou comprar neste ato (do passo atual pra frente, até 12) e pisca uma moldura verde em volta de cada uma que achar:

- na janela de recompensa da quest ("Reward"), a gema que a build escolhe;
- na loja do vendedor, a gema que a build manda comprar.

Como funciona:

- Duas fotos por segundo da parte esquerda da janela do jogo, só com o jogo na frente e só na cidade. Com o inventário aberto, também da grade dele. Fora da cidade não tira foto nenhuma.
- A moldura é uma janela do guia, vazada no meio. O clique passa por ela e nada é enviado ao jogo.
- Liga e desliga no modo de edição: "Piscar na tela a gema certa".
- Os ícones ficam em `public/gemas` (640 gemas). `node scripts/baixar-icones.mjs` baixa de novo.

### Marca sozinha a gema que está no inventário

- Na cidade, com o inventário aberto, o guia confere a grade dele com os ícones de todas as gemas da build. Ele reconhece o inventário aberto pelo cabeçalho, no canto direito da tela.
- Toda gema da build que estiver lá vira marca: a dela que ainda falta na rota, do começo até o fim do ato atual. Com a loja aberta, vale primeiro a compra; com a recompensa aberta, a recompensa. O guia avisa: "Marquei Frostblink: está no inventário." A gema sai da lista e para de piscar.
- Não importa como ela chegou: comprada, pega na recompensa, achada no chão ou trazida de antes. Se não marcou na hora, abrir o inventário (`I`) na cidade resolve.
- Duas cópias da mesma gema só marcam duas vezes se a rota tiver duas (uma de recompensa e uma comprada, por exemplo). Uma gema já marcada não é marcada de novo.
- A gema precisa aparecer em duas fotos seguidas, pra não contar a gema passando no cursor. Mudar a gema de casa não conta de novo.
- A caixinha continua. Gema desmarcada na mão não é mais marcada sozinha; marcar de novo na mão desfaz isso.
- O guia não lê o mouse, o teclado nem a memória do jogo. Só compara a foto da grade com os ícones.
- Prova com prints (`bancada_mochila`): as 38 gemas dos prints de recompensa e loja, contra as 461 gemas do jogo, em 13 formatos de tela (de 1024x768 a 5120x1440, com 16:10, 21:9 e janela). Ficaram todas no lugar, sem gema a mais e sem conta errada.
- A nota mínima depende do tamanho da casa: 0,75 em 720 e 0,70 de 1080 pra cima. Ícone pequeno tem menos detalhe, e em 720 um item chegou a 0,73. Nos prints, a gema certa mais fraca e o item mais parecido ficaram em 0,779 contra 0,730 (720), 0,759 contra 0,683 (1080) e 0,728 contra 0,648 (4K).
- A build vai com no máximo 80 gemas. A primeira olhada confere toda casa ocupada e leva de 0,13 s (720) a 1,1 s (4K). Depois, só a casa que mudou é conferida, em menos de 1 ms.

O que ainda falta:

- Só foi conferido com um print da janela de recompensa. Na loja, o tamanho do ícone foi medido em prints reduzidos e ainda não foi testado no jogo.
- A marcação sozinha ainda não foi testada no jogo, só em prints.
- Gema que vai direto do cursor pra um soquete do equipamento, sem passar pelo inventário, não é vista. Também não dá pra ver a gema que já está no equipamento: o `Client.txt` não conta isso. Marque na mão.
- Uma gema que não é da build, mas tem o desenho parecido com uma que falta, pode ser marcada no lugar dela.
- O inventário precisa estar no lugar de sempre, no canto direito da tela.
- Uma gema procurada que esteja no seu inventário ou no baú também ganha moldura.
- Se o guia estiver atrasado na rota, ele procura as gemas do passo errado. `F7` acerta o passo.
- O consumo com a leitura de tela ligada ainda não foi medido.

## Guia da árvore de passivas

O que faz:

- Lê as árvores do PoB importado e calcula a ordem dos pontos até a árvore da fase em que você está. Cada build dá uma ordem e um desenho diferentes.
- Quando você abre a árvore de passivas no jogo, reconhece a árvore por foto da tela, descobre o zoom e a posição, e lê quais nós da build já estão pegos.
- Desenha por cima, numa janela do guia: anel verde com número nos próximos nós (até 8), uma linha fina ligando cada um ao anterior, anel apagado no resto do trecho e anel vermelho em nó pego que a build não usa mais. Se o nº 1 está fora da tela, uma seta aponta pra ele.
- No painel, a seção "Árvore" mostra quantos pontos faltam e os 3 próximos nós, com os mesmos números do desenho. Antes de ver a árvore do jogo, essa lista é uma estimativa pelo nível e pelo ato (aparece com `~`).

Como usar:

- Abra a árvore de passivas no jogo. Não tem tecla nem botão: o desenho aparece quando o guia reconhece a árvore e some quando ela fecha ou o jogo sai da frente.
- Se você arrasta ou muda o zoom, o desenho some e volta quando a imagem para.
- Liga e desliga no modo de edição: "Desenhar na árvore de passivas do jogo os próximos pontos da build". Começa ligado.

Etapas da árvore:

- Um PoB com várias árvores (por exemplo "Level 30", "Level 60", "Act 5") vira várias etapas. Sozinho, o guia segue a etapa do seu nível e passa pra próxima quando a de agora fica completa ou quando o nível chega na próxima.
- Se você pulou um ponto (uma maestria, por exemplo) e o nível já levou o guia pra etapa seguinte, dá pra voltar: com a árvore aberta, o balão mostra "Árvore até …" com `◀` e `▶` dos lados. Segure Alt e clique nas setas, ou aperte as setas do teclado (`←` `↓` voltam, `→` `↑` avançam).
- Segure Alt e clique no título da etapa pra abrir a lista de todas e escolher uma. A do seu nível aparece marcada "a do nível".
- A etapa escolhida na mão vale até você clicar em "voltar pra do nível" ou até o nível levar o guia pra outra etapa. Enquanto ela vale, o guia não passa sozinho pra próxima. Gemas e itens continuam seguindo o seu nível.

O que ele não faz:

- Não lê a memória do jogo nem o mouse. Do teclado, só as teclas do guia (seção "Teclas"). Tudo o mais vem da foto da tela.
- Não manda nada pro jogo: nem tecla, nem clique. Quem pega o ponto é você.
- A janela do desenho não pega o foco e deixa o clique passar pro jogo.

Limites:

- Nunca rodou dentro do jogo. Só foi provado em quadros de vídeo da árvore: 184 quadros, todos 16:9, em 1080p e 1440p. Outras proporções (21:9), 4K, janela menor, HDR e escala do Windows diferente de 100% não têm prova nenhuma.
- Nesses quadros, a procura completa da árvore levou cerca de 45 ms em 1080p e 56 a 58 ms em 1440p (mediana, neste PC). No jogo ainda não foi medido.
- Se o guia não tem certeza de que achou a árvore, não desenha nada.
- PoB com uma árvore só: a ordem é estimada (o notável mais perto primeiro), não a do autor da build. Com várias árvores, o guia segue uma por vez, mas a ordem dentro de cada uma também é estimada.
- Os dados da árvore são da 3.29.1, até a GGG publicar a 3.30. Nó que mudou de lugar fica sem guia ou com o anel fora do lugar. Pra atualizar: `node scripts/gerar-arvore.mjs <tag>` (por exemplo `3.30.0`) e gerar o programa de novo. Se o PoB usa outra versão da árvore, o guia avisa.
- Joias de cluster e a árvore de ascendência não são lidas nem guiadas.
- O guia não vê qual efeito de maestria você escolheu, só se a maestria está pega. O efeito da build aparece escrito.
- Nó debaixo do painel do guia não é guiado. `F2` esconde o painel.
- O desenho não aparece em print nem em transmissão: a janela dele fica fora de toda captura de tela, pra o guia não fotografar o próprio desenho. Se o Windows recusar isso, o guia não desenha e a árvore fica só no painel.
- Em tela cheia exclusiva não funciona.
- O consumo com a árvore aberta ainda não foi medido (veja "Consumo").

## Bolinha com o Mundo ou o Baú aberto

Com o balão na parte esquerda da tela, ele fica na frente dos painéis da esquerda do jogo, como o Mundo (tecla `U`) e o Baú. Enquanto um desses painéis está aberto por baixo do balão, o balão vira bolinha. Quando o painel fecha, ele volta na forma em que estava, no mesmo lugar onde estava.

- O lugar do balão é o canto de cima, à esquerda, onde você deixou. Bolinha, normal, expandido e detalhado nascem todos desse canto. Arrastou o balão (ou a bolinha), o lugar novo passa a valer.
- Se o balão maior não cabe na tela a partir desse canto, ele é empurrado só o necessário pra caber, e na volta pro tamanho menor volta pro canto de antes.

- O guia reconhece o painel pelo cabeçalho, que tem a mesma arte no Mundo e no Baú. Pra isso tira uma foto pequena do canto de cima, à esquerda, da janela do jogo, a cada 0,3 s, só com o jogo na frente. A foto é tirada mesmo com o balão longe (ou com a bolinha desligada), porque os botões de busca da loja também dependem dela.
- A janela de compra do vendedor ("Purchase") não fica no canto: fica no meio do espaço à esquerda do inventário. Quando o painel da esquerda não está aberto, o guia procura o cabeçalho dela numa faixa fina da tela (~0,07 da altura), da esquerda até o inventário. Achou, o balão vira bolinha se estiver por cima dela, e os botões de busca aparecem.
- Balão do lado direito da tela não vira bolinha.
- Pra abrir o balão com o painel aberto, segure Alt e clique na bolinha, ou aperte `Ctrl+F3`. Ele fica aberto até o painel fechar.
- Liga e desliga no modo de edição: "Virar bolinha quando um painel da esquerda do jogo…". Começa ligado.

Limites:

- Nunca rodou dentro do jogo. Foi provado com 3 prints (Mundo duas vezes e Baú uma), em 16:9, e com esses prints reduzidos e ampliados pra 1080p, 1440p e 4K. Neles o cabeçalho deu 99% de parecença. Em quase mil recortes do jogo sem painel e na árvore de passivas, o máximo foi 54%. O guia só vira bolinha acima de 85%.
- A janela de compra foi provada com 1 print só (Nessa, 2000x1125) e com ele reduzido e ampliado de 720p a 4K: deu 99%. Nos prints sem ela (Mundo, Baú, árvore), o máximo foi 43%. Com uma dica de item tapando quase metade do cabeçalho, ela continua aberta. Outros vendedores têm abas diferentes, e as abas ficam fora da conta, mas só a Nessa foi vista.
- Outros painéis da esquerda com o mesmo cabeçalho do Mundo e do Baú provavelmente também fazem o balão virar bolinha.
- Uma dica de item tapando parte do cabeçalho não traz o balão de volta. Se tapar o cabeçalho quase inteiro por mais de meio segundo, o balão pode voltar antes de o painel fechar.
- O consumo ainda não foi medido.

## Busca da loja

Abra o Baú ou a janela de compra do vendedor no jogo: logo abaixo do campo de busca ("Type keywords here..."), alinhados com ele, aparecem botões roxos, um pra cada busca. Segure Alt e clique num deles: o guia põe o texto nesse campo, e o jogo destaca os itens que batem. Com Alt segurado os botões acendem. Passe o mouse com Alt pra ver o texto inteiro de cada busca.

- Os botões ficam numa janelinha à parte, transparente e sem pegar o foco, como o balão. Ela existe o tempo todo, mas fica fora da tela. Só vem pra baixo do campo enquanto o guia vê o Baú ou o vendedor aberto, com o jogo na frente. No modo de edição, com o guia escondido ou sem build, fica fora.
- O lugar sai das medidas da tela do jogo: no Baú, o campo fica sempre no mesmo canto; no vendedor, segue a janela de compra que o guia achou.

- **Build**: a busca que o autor da build deixou nas notas do PoB (o Maxroll põe uma, com links, botas de movimento, a base da arma e as gemas). O guia acha a linha sozinho: um ou mais termos entre aspas, ou um termo com `|`, com até 250 letras. Pode ter um rótulo antes, como `Vendor regex:`. Se o autor deixou mais de uma, aparecem até três (Build, Build 2, Build 3).
- **Gemas**: feita pelo guia com o nome inteiro de cada gema do conjunto de agora (`"^(spectral throw|volley support)$"`). Se passar de 250 letras, entram as primeiras.

As buscas avançam com a build, como as gemas, os itens e a árvore:

- **Busca com nível ou ato**: quando o autor liga a busca a uma etapa, ela só aparece na etapa dela. Vale o rótulo na mesma linha (`Level 26: "..."`, `Lvl 48 regex - ...`, `Act 4+ = ...`, `"..." (Maps)`) ou um título em cima (`---- Level 71 ----`, que vale até o próximo título). A etapa vira junto com a árvore, pela mesma regra dos itens: com buscas `Level 12`, `Level 26`, `Level 48` e `Level 71`, a do 26 entra quando a árvore passa do 12, e assim por diante.
- **Fim de jogo**: `Maps`, `Endgame` e `Ubers` entram nos mapas, depois da última de nível. `Leveling` e `Early game` valem a campanha toda, junto com a da etapa.
- **Busca sem etapa** (a do Maxroll, por exemplo) vale a build toda. Se ela tem a lista de gemas do autor (`^(gema|gema)$`), do conjunto seguinte em diante a lista vira a do conjunto de agora, com as gemas novas primeiro. O resto da busca (links, botas, arma) fica como o autor fez. Se não couber em 250 letras, saem as últimas gemas.
- A busca que o autor põe no rótulo de um grupo de gemas vale com aquele conjunto.
- Texto corrido que cita um nível ("Get Frostblink at level 4") não vira rótulo.
- Como vai pro jogo: depois de você soltar o Alt, o guia põe o texto na área de transferência, traz o jogo pra frente e manda `Ctrl+F`, `Ctrl+V` e `Enter`. Depois devolve à área de transferência o texto que estava lá. É o mesmo jeito do Awakened PoE Trade. Um clique, uma busca.
- Se outra janela tomar a frente no meio, as teclas param. Se o jogo não vier pra frente, a busca fica copiada e é só colar com `Ctrl+V`.
- O resultado aparece por uns segundos do lado dos botões.

Limites:

- Ainda não foi testado dentro do jogo. O lugar dos botões foi medido em prints de 2000 x 1125; em outras telas ele encolhe junto com a altura, mas não foi conferido.
- Se o guia não perceber a janela aberta, os botões não aparecem.
- O Mundo tem o mesmo cabeçalho, então os botões também aparecem com ele aberto. Clicar ali não acha caixa de busca: o `Enter` abre o chat vazio.
- Se a área de transferência tinha uma imagem, ela não volta: só texto volta.

## Filtro da build

Em `Ctrl+F2` > Build, embaixo da importação, o botão **Aplicar filtro da build** grava um filtro de itens com o que a build usa em destaque.

- O arquivo se chama sempre `Guia de leveling.filter` e fica na pasta de filtros do jogo. No jogo, escolha uma vez em Esc > Options > Game > Item Filter > "Guia de leveling". Depois de gravar de novo (outra build, outra base), é só recarregar o filtro lá.
- **Filtro base**: o guia põe os destaques em cima de um filtro que já está na pasta (o NeverSink, por exemplo), sem mudar nada nele. Já vem marcado o que o jogo está usando. Com "Nenhum", o arquivo tem só os destaques e o resto aparece como no jogo sem filtro. Filtro online (o que o jogo baixa do site) não aparece na lista: baixe o arquivo pra pasta, se quiser usar.
- Os destaques têm borda roxa e ícone roxo no minimapa e só valem na campanha (área até o nível 67). Nos mapas fica o filtro base, como sempre.
- O que entra: os únicos da build, os links nas cores das gemas do grupo principal (3 e 4 links), botas mágicas ou raras com movimento, as bases dos itens da campanha e as gemas da build.
- Só entram nomes que o guia conhece (das artes de itens e dos dados de gemas): um nome errado estraga o filtro inteiro no jogo.
- Ainda não foi testado dentro do jogo.

## Ascendência e panteão

Com a árvore de passivas aberta no jogo (e no modo de edição), o balão mostra uma caixa roxa com a ascendência da build:

- Uma linha por lab, com os nós que pegar: `Lab 1 (normal): Flask Effect, Chaos Damage · Nature's Reprisal`. Os notáveis vão em negrito. O guia tira isso das árvores do PoB: cada árvore que traz nós de ascendência novos vira uma linha, e os pontos somados dizem de qual lab é (2 por lab). Quando uma árvore traz 4 pontos de uma vez, a linha diz "Labs 2 e 3".
- O lab que o seu nível já deixa fazer fica mais forte (normal a partir do 33, cruel do 55, merciless do 68, eternal do 75).
- Embaixo, o panteão da build: `Panteão: Soul of the Brine King (maior) · Soul of Ryslatha (menor)`. O botão do panteão fica na própria tela da árvore.
- A caixa não desenha em cima do disco da ascendência: a leitura da tela acha a árvore de passivas, mas ainda não acha o disco.
- Ainda não foi testado dentro do jogo.

## Gravador de estudo

No modo de edição, o botão "Gravar a tela (estudo)" liga e desliga um gravador: uma foto por segundo da janela do jogo, só com ela na frente. Serve pra estudar depois o que aparece na tela (lista de missões, recompensas, lojas).

- As fotos ficam em `%APPDATA%\br.guialeveling.overlay\gravacoes\<data-hora>\` e não saem do computador.
- Conte com cerca de 1 GB a cada 40 minutos. Começa sempre desligado e desliga sozinho em 4 horas.
- Ainda não foi testado com o jogo na frente.

## Limitações

- As receitas de vendedor foram conferidas no texto: as da 3.30 nas patch notes oficiais, as outras na página "Vendor recipe system" do poedb.tw (12/11/2026). Essa página não diz de que versão é. Nenhuma foi testada no vendedor.
- O texto dos passos da rota está em inglês.
- O guia não desenha a árvore inteira: só marca os próximos pontos por cima da árvore do jogo, com os limites da seção "Guia da árvore de passivas". Pra ver a árvore toda, o modo de edição tem o link de cada uma.
- A rota e os dados de gemas são de antes do 3.30 (exile-leveling de 02/08/2026). O que as notas oficiais da 3.30 já contam foi acrescentado à mão em `src/nucleo/dados-330.ts`: a gema Arcane Link (Scion ganha em Breaking the Seal; Marauder, Duelist e Templar compram), com ícone pra piscar na tela, e os preços novos (28 a 33 por Alteration, 34 a 37 por Alchemy). Ainda são suposição: o nível exigido da Arcane Link (34, como as outras Links), o id dela, o Scion também comprar e a Lilly Roth vender no ato 6. A Fireball of Radiation é transfigurada: o guia manda comprar a Fireball, e ela é transfigurada no Divine Font. A rota em si (layouts, ordem das zonas) só dá pra conferir no jogo.
- O planner do Maxroll (`maxroll.gg/poe/planner/…`, ou a página de um guia que só tem o planner) entra com um pedido só a `planners.maxroll.gg`. O formato dele não é público: foi lido de 2 planners salvos e de 10 guias do Maxroll, e pode mudar sem aviso. Se não abrir, cole o código do PoB.
  - A árvore de leveling que o autor desenhou inteira ("Campaign", "Leveling") é cortada pela ordem dos cliques, uma etapa a cada 8 pontos mais ou menos, com o título `Level 20 (25 points)`. O nível de cada etapa é estimado pelos pontos. As etapas param antes da primeira árvore de mapas.
  - O guia segue a primeira árvore do planner e avisa das outras (caminhos alternativos). Se o planner mostra mais de uma ascendência, nenhuma é escolhida: o aviso pede pra escolher no laboratório.
  - Os itens do planner entram só com o nome e a raridade, sem base nem atributos.
- PoB com um conjunto só de gemas: o guia mostra esse conjunto o tempo todo.
- Com o jogo em outro idioma, só a troca de zona é lida. O nível e as mortes ficam por sua conta.
- No laboratório do ato 3, voltar ao acampamento antes do Aspirants' Plaza pula um passo. `F3` corrige.

## Desenvolver

Tudo a partir desta pasta. Precisa de Node 22 e Rust.

```
npm install
npm run tauri dev
npm test
cd src-tauri && cargo test --workspace
npm run tauri build
```

- `node scripts/e2e.mjs` abre o app de verdade e confere janela, teclas, importação e uma corrida de mentira. Só roda com o jogo fechado. As opções estão no começo do arquivo.
- `npm run simular -- <arquivo> zona 1_1_2 2 "The Coast"` escreve linhas num `Client.txt` de teste. Abra o app com a variável `GUIA_CLIENT_TXT` apontando pra esse arquivo.

## Créditos

- Rota e dados de gemas: [exile-leveling](https://github.com/HeartofPhos/exile-leveling), de HeartofPhos (MIT).
- Imagens de layout: [Exile-UI](https://github.com/Lailloken/Exile-UI), de Lailloken (MIT).
- Dados da árvore de passivas: Grinding Gear Games, do [skilltree-export](https://github.com/grindinggear/skilltree-export). Só números e nomes, nenhuma arte do jogo. Detalhes em [`src/dados/arvore/ORIGEM.md`](src/dados/arvore/ORIGEM.md).
- Contas de posição dos nós e tabela de pontos de passiva por missão: conferidas com o [Path of Building Community](https://github.com/PathOfBuildingCommunity/PathOfBuilding) (MIT).
- Ícones das gemas: arte da Grinding Gear Games, baixada do [poedb](https://poedb.tw). A lista de qual ícone é de qual gema vem do [RePoE](https://github.com/repoe-fork/repoe). O da Arcane Link veio do [post oficial das gemas da 3.30](https://www.pathofexile.com/forum/view-thread/4013898).

As licenças e o que foi usado de cada projeto estão em [`../terceiros/LEIA-ME.md`](../terceiros/LEIA-ME.md).
