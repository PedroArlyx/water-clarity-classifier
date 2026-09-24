# Dados, licenças e rastreabilidade

## Composição

O dataset atual possui 61 linhas: 50 histogramas legados preservados em `res.csv.bak` e 11 imagens aprovadas e catalogadas. Dessas 11, nove vieram do Wikimedia Commons e duas são os exemplos locais `limpo2.jpg` e `sujo19.jpg`.

O arquivo `data/metadata/images.csv` é a fonte de verdade para o conjunto novo. Cada registro contém arquivo, classe, URL de origem, página, licença, autor, data de acesso, SHA-256, grupo e estado de revisão. As imagens rejeitadas continuam no catálogo para que a decisão seja verificável, mas não entram em `res.csv`.

## Processo

1. `scripts/import_wikimedia.py` consulta apenas uma lista curada de títulos e obtém metadados pela API do Commons.
2. `scripts/review_candidates.py` grava decisões explícitas de aprovação e rejeição.
3. `scripts/audit_dataset.py` verifica dimensões, hashes exatos e dHash com distância até 8.
4. `scripts/prepare_dataset.py` valida hashes, extrai os histogramas e recria o dataset derivado.

O último relatório encontrou 15 imagens catalogadas, 11 aprovadas, quatro rejeitadas, nenhum hash exato repetido e nenhum par perceptualmente próximo no limiar adotado. Os artefatos estão em `data/reports/`.

## Fontes avaliadas

- Wikimedia Commons: escolhido para as imagens incorporadas por oferecer página individual, autoria e licença explícita.
- TankImage-I: não incorporado; além de restrição a educação/pesquisa, o conteúdo é subaquático e distante do cenário de copo.
- UIDLEIA: licença aberta, mas imagens subaquáticas fora do domínio do projeto.
- Um conjunto Zenodo localizado durante a pesquisa: não incorporado porque a página consultada não concedia uma licença de reutilização adequada.

As condições exatas de cada imagem incorporada estão no catálogo, e prevalecem sobre este resumo. Ao redistribuir, preserve as atribuições e confirme novamente os termos nas páginas de origem.

## Vazamento e limitações

As novas imagens têm `group_id`, possibilitando no futuro uma validação agrupada por fonte ou sessão. Isso ainda não é metodologicamente válido para o conjunto completo, pois as 50 linhas antigas não têm arquivo, origem, sessão ou grupo. Assim, foi mantido `StratifiedKFold`; a limitação está registrada nos metadados do modelo.

Também não se deve interpretar diversidade de URLs como diversidade de condições. A base continua pequena, desbalanceada e sensível a iluminação, balanço de branco, reflexos, fundo e recipiente. Novas coletas devem priorizar múltiplas câmeras, luzes e sessões, com um grupo por sessão e separação por grupo entre treino e teste.
