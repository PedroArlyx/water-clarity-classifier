# Water Clarity Classifier

Classificador educacional que estima se a água de um copo parece **limpa** ou **suja** a partir de uma fotografia. O repositório reúne comparação de 16 modelos sobre o `res.csv`, a transformação "formato da cor", treino reproduzível do `modelo_agua`, API Flask, interface clássica e uma demonstração 3D cujo robô envia uma captura real da cena ao mesmo classificador.

> **Aviso:** o sistema avalia somente aparência visual. Ele não comprova potabilidade nem segurança química ou microbiológica e não deve orientar consumo.

## Resultado atual

O `res.csv` (50 fotos: 14 `limpo`, 36 `sujo`; 768 atributos de histograma RGB) foi submetido a **8 algoritmos em 2 cenários de atributos** (16 modelos), com validação cruzada estratificada repetida (5 dobras × 10 repetições) e normalização de 0 a 1 (`MinMaxScaler`) dentro do pipeline:

- **histograma bruto** — os 768 valores, como proporção de pixels;
- **formato da cor** — 78 atributos que comparam o formato das curvas R, G e B depois de remover brilho e contraste (`ColorShapeTransformer` em `water_clarity/ml/features.py`). Água limpa é transparente e deixa as três curvas iguais; água suja é colorida e cria um "morro" num canal só. A diferença média entre canais no `res.csv` é 0,059 nas limpas e 0,134 nas sujas.

Cada modelo também foi testado nas **8 fotos do professor** (`data/teste/professor/`) e em **7 fotos extras** (`data/teste/whatsapp/`), que nunca entram no treino.

| Cenário | Algoritmo | Acurácia | F1-macro | Fotos do professor | Fotos extras |
|---|---|---:|---:|---:|---:|
| formato da cor | Árvore de Decisão | 0,902 | 0,875 | 4/8 | 6/7 |
| **formato da cor** | **Naive Bayes ★** | **0,888** | **0,873** | **7/8** | **5/7** |
| formato da cor | SVM RBF | 0,890 | 0,854 | 7/8 | 5/7 |
| formato da cor | Random Forest | 0,876 | 0,847 | 6/8 | 6/7 |
| formato da cor | MLP (rede neural) | 0,856 | 0,824 | 4/8 | 4/7 |
| formato da cor | Regressão Logística | 0,846 | 0,787 | 4/8 | 5/7 |
| formato da cor | KNN (k=5) | 0,812 | 0,773 | 6/8 | 3/7 |
| formato da cor | SVM Linear | 0,822 | 0,768 | 6/8 | 4/7 |
| histograma bruto | Naive Bayes | 0,820 | 0,765 | 5/8 | 5/7 |
| histograma bruto | SVM RBF | 0,820 | 0,755 | 5/8 | 5/7 |
| histograma bruto | Regressão Logística | 0,808 | 0,753 | 5/8 | 5/7 |
| histograma bruto | Random Forest | 0,806 | 0,749 | 5/8 | 5/7 |
| histograma bruto | MLP (rede neural) | 0,796 | 0,735 | 5/8 | 5/7 |
| histograma bruto | KNN (k=5) | 0,758 | 0,694 | 5/8 | 5/7 |
| histograma bruto | Árvore de Decisão | 0,738 | 0,668 | 5/8 | 5/7 |
| histograma bruto | SVM Linear | 0,728 | 0,645 | 5/8 | 5/7 |

**Critério de escolha:** maior F1-macro na validação cruzada entre os modelos que acertam pelo menos 6 das 8 fotos do professor. A Árvore de Decisão tem o maior F1-macro, mas acerta só 4 de 8 fotos novas. O vencedor é o **Naive Bayes com formato da cor**, treinado de novo com as 50 fotos do `res.csv` e salvo em `model/modelo_agua.pkl`.

| Vencedor · Naive Bayes + formato da cor | Valor |
|---|---:|
| Acurácia | 0,888 |
| Acurácia balanceada | 0,902 |
| Precisão / recall (sujo) | 0,971 / 0,874 |
| F1-macro | 0,873 ± 0,114 |
| Fotos do professor | 7 de 8 (erra `sujo2`, água leitosa quase branca) |
| Fotos extras (nunca usadas na escolha) | 5 de 7 |

As fotos do professor ajudaram a escolher o modelo, então o "7 de 8" é um pouco otimista; as fotos extras são o teste independente. O Naive Bayes costuma mostrar probabilidades perto de 100% porque trata os 78 atributos como independentes; a classe prevista é o que importa.

## O que o projeto faz

- valida extensão, MIME, assinatura, formato, dimensões e limite de pixels do upload;
- corrige orientação EXIF, converte para RGB e extrai o histograma de 768 valores, no mesmo formato do `res.csv`;
- o pipeline do `modelo_agua` aplica o formato da cor, a normalização de 0 a 1 e o Naive Bayes;
- compara 16 modelos com `RepeatedStratifiedKFold(5, 10)` e testa todos nas fotos do professor;
- gera CSV de métricas, gráficos, matriz de confusão e metadados do experimento;
- treina o vencedor com todo o `res.csv`, sem dividir treino e teste;
- atende upload tradicional e uma cozinha 3D interativa pelo mesmo endpoint de inferência;
- expõe dashboard experimental e API JSON versionada;
- inclui testes, lint, CI e Blueprint de deploy para Render.

## Início rápido

Requer Python 3.12.

```bash
python -m venv .venv
source .venv/bin/activate              # Windows: .venv\Scripts\activate
python -m pip install -r requirements.txt
python -m scripts.run
```

Acesse `http://127.0.0.1:5000`. As páginas disponíveis são:

- `/` — upload clássico;
- `/demonstracao` — **Water Vision**: cozinha 3D em que o robô coleta a água, fotografa o copo numa estação de visão e consulta a API (modos Demonstração/Livre, qualidade Auto/Alta/Média/Baixa);
- `/experimento` — métricas e artefatos do treinamento;
- `/api/v1/health` — estado do serviço e do modelo.

## Pipeline de dados e treinamento

```bash
python train_model.py                   # compara os 16 modelos e treina o vencedor em model/modelo_agua.pkl
python train_model.py --evaluate-only   # só a comparação, não grava nada
python -m scripts.pipeline              # auditoria + reconstrução do res.csv + treino
```

O treino lê o `res.csv`. As fotos com status `holdout` no catálogo `data/metadata/images.csv` (professor e extras, em `data/teste/`) são usadas só para teste; a previsão de cada uma fica em `data/reports/fotos_de_teste.csv`.

Para acrescentar fotos novas ao `res.csv`, catalogue-as com revisão e reconstrua o dataset (vão para `data/raw/proprias/<classe>/`):

```bash
python add_to_dataset.py foto1.jpg limpo foto2.jpg sujo   --license "Fotos próprias" --author "Nome" --group sessao-1 --reviewed
python -m scripts.prepare_dataset   # res.csv = 50 linhas originais (res.csv.bak) + fotos aprovadas
python train_model.py
```

## API

```bash
curl -X POST http://127.0.0.1:5000/api/v1/predictions \
  -F "image=@data/teste/professor/limpo/limpo2.jpg"
```

Resposta resumida:

```json
{
  "data": {
    "classification": "limpo",
    "confidence": 0.9012,
    "model": "Naive Bayes · formato da cor",
    "warning": "Resultado baseado somente na aparência visual; não confirma potabilidade, segurança química ou microbiológica."
  }
}
```

Consulte [docs/API.md](docs/API.md) para contratos, erros e todos os endpoints.

## Qualidade

```bash
python -m pip install -r requirements-dev.txt
ruff check .
pytest
node --check static/js/classic.js
node --check static/js/demo3d.js
```

A integração contínua executa lint, testes e um smoke test dos metadados em `.github/workflows/ci.yml`.

## Deploy no Render

O `render.yaml` instala as dependências fixadas, inicia `gunicorn`, configura produção e monitora `/api/v1/health`. No Dashboard do Render, crie um **Blueprint** a partir deste repositório. Ao usar domínio próprio, acrescente-o a `TRUSTED_HOSTS`.

## Estrutura principal

```text
water_clarity/          factory Flask, rotas, validação e serviço de ML
scripts/                importação, auditoria, preparação, avaliação e execução
templates/              upload, demonstração 3D, dashboard e erros
static/                 design system (CSS), fontes locais, JS da cena 3D (js/experience) e Three.js local
tests/                  testes unitários e de integração
data/                   imagens brutas, catálogo, licenças e relatórios
model/                  pipeline final, schema e metadados
docs/                   arquitetura, API, dados, segurança e relatório
```

## Documentação

- [Arquitetura e diagramas](docs/ARQUITETURA.md)
- [Dados, licenças e rastreabilidade](docs/DADOS.md)
- [API](docs/API.md)
- [Revisão de segurança](docs/SEGURANCA.md)
- [Atendimento aos requisitos](docs/ATENDIMENTO_ATIVIDADE.md)
- [Assets, fontes e licenças visuais](docs/ASSETS.md)
- [Design system](design-system/water-clarity-lab/MASTER.md)

## Limitações conhecidas

- 50 amostras herdadas existem somente como histogramas; sem os arquivos brutos, não há auditoria visual nem agrupamento por sessão/origem para elas.
- A base é pequena, desbalanceada e não representa condições variadas de iluminação, recipiente, câmera e tipos de contaminação.
- Fotografias semelhantes podem induzir vazamento entre folds; o catálogo novo possui `group_id`, mas a base legada não.
- Transparência ou cor não revela contaminantes invisíveis. O domínio do sistema é classificação visual binária, não potabilidade.
- Os modos renderizados alteram a cena, mas não forçam o resultado. Com o modelo atual, a cena marrom ainda pode ser classificada como `limpo`; use o modo de upload com `data/teste/professor/sujo/sujo19.jpg` para demonstrar o alerta real. Essa falha é evidência da limitação do modelo, não deve ser escondida nem substituída por um rótulo simulado. O modelo ainda confunde água suja pouco colorida (leitosa, quase branca) com limpa, e o fundo ocupa a maior parte da foto.

## Licenças e terceiros

As imagens externas mantêm URL, autor e licença no catálogo. Three.js 0.186.1 é distribuído sob MIT; o aviso está em `static/vendor/THREE-LICENSE.txt`. Fontes Inter e JetBrains Mono (SIL OFL 1.1) e demais assets estão em [docs/ASSETS.md](docs/ASSETS.md). Consulte [docs/DADOS.md](docs/DADOS.md) antes de redistribuir o dataset.
