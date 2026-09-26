# Dados do projeto

Esta pasta separa aquisição, revisão e artefatos derivados.

```text
data/
├── raw/                 # Imagens originais catalogadas
│   ├── proprias/        # Fotos de celular do projeto (entram no treino)
│   │   ├── limpo/
│   │   └── sujo/
│   └── commons/         # Wikimedia Commons (entram no treino)
│       ├── limpo/
│       └── sujo/
├── metadata/
│   └── images.csv       # Origem, licença, autor, hash, grupo e revisão
├── processed/           # Reservado para datasets derivados
├── splits/              # Reservado para divisões agrupadas futuras
└── reports/             # Auditorias e resumo do dataset
```

## Política de inclusão

Uma imagem só entra no treino (`python train_model.py`) quando possui
`review_status=approved`. O nome ou a consulta de busca não é usado como verdade
do rótulo. O treino confere o hash antes de extrair a cor do centro da foto.

Outros status do catálogo:

- `reserva` — imagem revisada e válida, mas deixada fora do treino (hoje nenhuma).
- `holdout` — teste externo, nunca treinado (hoje nenhuma imagem).
- `rejected` / `pending` — descartadas ou aguardando revisão.

```bash
python -m scripts.import_wikimedia   # aquisição pendente
python -m scripts.review_candidates # decisões humanas registradas
python -m scripts.audit_dataset     # duplicatas e dimensões
python train_model.py               # avalia e treina o modelo_agua
```

`res.csv.bak` preserva as 50 linhas do notebook do Colab. Elas existem só como
histogramas, sem as fotos, então não servem para recortar o centro e não entram
no treino atual. `scripts/prepare_dataset.py` e `res.csv` ficam apenas como
registro da abordagem anterior.
