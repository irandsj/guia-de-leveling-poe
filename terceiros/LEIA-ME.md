# Código e dados de terceiros

Tudo aqui é MIT: pode ser copiado, desde que a licença vá junto e a fonte seja citada.
As licenças ficam nesta pasta. O que foi copiado fica dentro do app, nos lugares abaixo.

| Projeto | Autor | Versão | O que usamos | Onde está |
|---|---|---|---|---|
| [exile-leveling](https://github.com/HeartofPhos/exile-leveling) | HeartofPhos | commit `b7b2dd0` (02/08/2026) | Rota dos atos 1-10, interpretador da rota, dados de zonas, quests e gemas (quem dá, quem vende, pra qual classe) e a tabela de ids de gema do PoB. | `app/src/terceiros/exile-leveling/` (cópia fiel) e `app/src/nucleo/pob.ts` (tabela de ids) |
| [exile-log-api](https://github.com/HeartofPhos/exile-log-api) | HeartofPhos | commit `a0e75c0` (23/07/2026) | Só a ideia de acompanhar o fim do `Client.txt`. O leitor em Rust foi escrito do zero. | `app/src-tauri/leitor-log/` |
| [Exile-UI](https://github.com/Lailloken/Exile-UI) | Lailloken | commit `67d1a36` (08/10/2026) | Imagens de layout das zonas (act-decoder). | `app/public/layouts/` |

Projetos GPL (XileHUD, Exile-Build-PoE) foram só estudados: nada deles foi copiado.
