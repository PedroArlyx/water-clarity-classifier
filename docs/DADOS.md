# Dados, licenças e rastreabilidade

## Composição

O treino usa o `res.csv` da atividade: 50 fotos (14 `limpo`, 36 `sujo`) descritas por 768 atributos de histograma RGB. As 50 linhas ficam preservadas em `res.csv.bak`.

As fotos em arquivo ficam em `data/metadata/images.csv`, a fonte de verdade para origem, licença, autor, hash, grupo e estado de revisão:

- 8 fotos do professor e 7 fotos extras (`data/teste/`), com status `holdout`: só para teste;
- 36 fotos do Wikimedia Commons (`data/raw/commons/`), com status `reserva`: fora do treino, porque são quase todas de água limpa;
- 4 fotos do Commons rejeitadas na revisão.

## Processo

1. `scripts/import_wikimedia.py` consulta apenas uma lista curada de títulos e obtém metadados pela API do Commons.
2. `scripts/review_candidates.py` grava decisões explícitas de aprovação e rejeição.
3. `scripts/audit_dataset.py` verifica dimensões, hashes exatos e dHash com distância até 8.
4. `scripts/prepare_dataset.py` valida hashes, extrai os histogramas das imagens `approved` e recria o `res.csv` sobre as 50 linhas originais.

O relatório de auditoria fica em `data/reports/audit_summary.json`; as previsões do modelo nas fotos de teste, em `data/reports/fotos_de_teste.csv`.

## Fontes avaliadas

- Wikimedia Commons: escolhido para as imagens incorporadas por oferecer página individual, autoria e licença explícita.
- TankImage-I: não incorporado; além de restrição a educação/pesquisa, o conteúdo é subaquático e distante do cenário de copo.
- UIDLEIA: licença aberta, mas imagens subaquáticas fora do domínio do projeto.
- Um conjunto Zenodo localizado durante a pesquisa: não incorporado porque a página consultada não concedia uma licença de reutilização adequada.

As condições exatas de cada imagem incorporada estão no catálogo, e prevalecem sobre este resumo. Ao redistribuir, preserve as atribuições e confirme novamente os termos nas páginas de origem.

## Vazamento e limitações

As 50 linhas do `res.csv` não têm arquivo, origem ou sessão, então a validação usa `RepeatedStratifiedKFold` sem agrupamento. As fotos do professor nunca entram no treino, mas participam da escolha do modelo; por isso o "7 de 8" é um pouco otimista, e as 7 fotos extras servem como teste independente.

A base continua pequena, desbalanceada e sensível a iluminação, balanço de branco, reflexos, fundo e recipiente. Novas coletas devem priorizar múltiplas câmeras, luzes e sessões, com um grupo por sessão.
