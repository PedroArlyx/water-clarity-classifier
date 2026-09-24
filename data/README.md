# Dados do projeto

Esta pasta separa aquisição, revisão e artefatos derivados.

```text
data/
├── raw/                 # Imagens originais catalogadas
│   ├── limpo/
│   └── sujo/
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
