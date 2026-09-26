# Dados do projeto

Esta pasta separa aquisição, revisão e artefatos derivados.

```text
data/
├── teste/               # Fotos de teste: NUNCA entram no treino
│   ├── professor/       # As 8 fotos do professor (limpo/, sujo/)
│   └── whatsapp/        # 7 fotos extras (limpo/, sujo/)
├── raw/
│   ├── commons/         # Wikimedia Commons (reserva, fora do treino)
│   └── proprias/        # Criada pelo add_to_dataset.py para fotos novas de treino
├── metadata/
│   └── images.csv       # Origem, licença, autor, hash, grupo e revisão
└── reports/             # Auditorias e previsões nas fotos de teste
```

## Política de inclusão

O treino usa o `res.csv` da atividade (50 fotos, 768 atributos de histograma RGB).
`python -m scripts.prepare_dataset` reconstrói o `res.csv` a partir das 50 linhas
preservadas em `res.csv.bak` mais as imagens com `review_status=approved`
(hoje nenhuma, então o `res.csv` tem exatamente as 50 fotos originais). O nome ou a
consulta de busca não é usado como verdade do rótulo, e o hash é conferido antes
de extrair o histograma.

Status do catálogo:

- `holdout` — fotos de teste (`data/teste/`): o professor e as extras. Nunca entram
  no treino; `train_model.py` testa todos os modelos nelas.
- `reserva` — revisada e válida, mas fora do treino: as 36 fotos do Wikimedia Commons,
  quase todas de água limpa (31 × 5), que ensinavam "foto da internet = limpo".
- `approved` — entra no `res.csv` na próxima execução de `prepare_dataset`.
- `rejected` / `pending` — descartadas ou aguardando revisão.

```bash
python -m scripts.import_wikimedia   # aquisição pendente
python -m scripts.review_candidates # decisões humanas registradas
python -m scripts.audit_dataset     # duplicatas e dimensões
python -m scripts.prepare_dataset   # reconstrói res.csv
python train_model.py               # compara 16 modelos e treina o vencedor
```

`res.csv.bak` preserva as 50 linhas do `res.csv` original da atividade. Como os
arquivos das fotos e as sessões dessas linhas não estão disponíveis, não é possível
auditar near-duplicates nem fazer validação agrupada sobre elas.
