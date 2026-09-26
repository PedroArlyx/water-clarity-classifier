# Dados do projeto

Esta pasta separa aquisição, revisão e artefatos derivados.

```text
data/
├── raw/                 # Imagens originais catalogadas
│   ├── proprias/        # Fotos de celular do projeto (entram no treino)
│   │   ├── limpo/
│   │   └── sujo/
│   └── commons/         # Wikimedia Commons (hoje em reserva, fora do treino)
│       ├── limpo/
│       └── sujo/
├── metadata/
│   └── images.csv       # Origem, licença, autor, hash, grupo e revisão
├── processed/           # Reservado para datasets derivados
├── splits/              # Reservado para divisões agrupadas futuras
└── reports/             # Auditorias e resumo do dataset
```

## Política de inclusão

Uma imagem só entra no `res.csv` quando possui `review_status=approved`. O nome
ou a consulta de busca não é usado como verdade do rótulo. O fluxo verifica o
hash antes de extrair o histograma RGB.

Outros status do catálogo:

- `reserva` — imagem revisada e válida, mas fora do treino. As fotos do Wikimedia
  Commons são quase todas de água limpa (31 limpo × 5 sujo); treinar com elas faz o
  modelo aprender "foto da internet = limpo" e derrubou a acurácia balanceada nas
  50 fotos originais de ~0,80 para 0,43 (CV agrupada por fonte, 26/09/2026).
  Voltam para `approved` quando houver fotos sujas equivalentes.
- `holdout` — teste externo, nunca treinado (hoje nenhuma imagem).
- `rejected` / `pending` — descartadas ou aguardando revisão.

```bash
python -m scripts.import_wikimedia   # aquisição pendente
python -m scripts.review_candidates # decisões humanas registradas
python -m scripts.audit_dataset     # duplicatas e dimensões
python -m scripts.prepare_dataset   # reconstrói res.csv
python train_model.py               # avalia e treina o vencedor
```

`res.csv.bak` preserva as 50 linhas legadas. Como os respectivos arquivos
originais e IDs de sessão não estão disponíveis, não é possível auditar
near-duplicates ou executar validação agrupada sobre essa parte da base.
