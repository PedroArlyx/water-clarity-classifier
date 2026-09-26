<<<<<<< HEAD
# water-clarity-classifier
Aplicação web em Python que classifica se a água de um copo está limpa ou suja a partir de uma foto, usando a cor média (RGB) e um modelo escolhido pela metodologia KDD.
=======
# Water Clarity Classifier

Classificador educacional que estima se a água de um copo parece **limpa** ou **suja** a partir de uma fotografia. O repositório reúne aquisição e auditoria de dados, cor do centro da foto, treino reproduzível do `modelo_agua`, API Flask, interface clássica e uma demonstração 3D cujo robô envia uma captura real da cena ao mesmo classificador.

> **Aviso:** o sistema avalia somente aparência visual. Ele não comprova potabilidade nem segurança química ou microbiológica e não deve orientar consumo.

## Resultado atual

O único modelo usado é `model/modelo_agua.pkl`. Ele olha a **cor do centro da foto**, onde normalmente está o copo: recorta 50% da largura e da altura, extrai 19 estatísticas de saturação, brilho e cromaticidade e classifica com `StandardScaler` → `LogisticRegression` (classes balanceadas). Foi treinado com scikit-learn 1.8.0 sobre 51 imagens aprovadas no catálogo (36 `limpo`, 15 `sujo`): 15 fotos de celular do projeto (`data/raw/proprias/`) e 36 do Wikimedia Commons (`data/raw/commons/`).

A abordagem anterior (histograma RGB da foto inteira + Naive Bayes) era dominada pelo fundo: em fotos próprias nunca vistas acertava **8/15, só 1 de 5 limpas**. A atual acerta **12/15, com 5 de 5 limpas**; ainda erra as sujas claras e leitosas (`sujo2`, `sujo9`, `sujo12`).

| Métrica (CV estratificada agrupada por sessão/fonte, 5 folds) | Média |
|---|---:|
| F1 macro | 0,582 |
| Acurácia balanceada | 0,607 |
| Acurácia | 0,692 |
| Fotos próprias nunca vistas (uma sessão de fora por vez) | 12/15 (limpo 5/5, sujo 7/10) |

A matriz de confusão fora do treino foi `[[28, 8], [8, 7]]`, na ordem `limpo`, `sujo`; desvio do F1 macro entre folds: 0,135. O F1 geral é puxado para baixo pelas fotos da internet, muito variadas e com poucas sujas; o número que mais se aproxima do uso real é o das fotos próprias nunca vistas, detalhado em `data/reports/fotos_nunca_vistas.csv`. Com tão poucas fotos, os números são preliminares.

As 50 linhas de `res.csv.bak` (dados do notebook do Colab) existem só como histogramas, sem as fotos; por isso não servem para recortar o centro e não entram no treino atual.

## O que o projeto faz

- valida extensão, MIME, assinatura, formato, dimensões e limite de pixels do upload;
- corrige orientação EXIF, converte para RGB e recorta o centro da foto;
- extrai 19 estatísticas de cor do centro e classifica com o `modelo_agua` (Regressão Logística);
- avalia com `StratifiedGroupKFold(5)` por sessão/fonte e testa cada sessão de fotos próprias como nunca vista;
- gera CSV de métricas, gráficos, matriz de confusão e metadados do experimento;
- treina o `modelo_agua` com 100% das imagens depois da avaliação;
- atende upload tradicional e uma cozinha 3D interativa pelo mesmo endpoint de inferência;
- expõe dashboard experimental e API JSON versionada;
- cataloga procedência, licença, revisão e hash das imagens;
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

O treino lê direto as imagens com `review_status=approved` em `data/metadata/images.csv` (fotos próprias em `data/raw/proprias/<classe>/`, Commons em `data/raw/commons/<classe>/`).

```bash
python train_model.py                   # avalia e treina model/modelo_agua.pkl
python train_model.py --evaluate-only   # só avaliação, não grava nada
python -m scripts.audit_dataset         # duplicatas e dimensões das imagens aprovadas
```

Para adicionar fotos próprias (vão para `data/raw/proprias/<classe>/` com o nome original):

```bash
python add_to_dataset.py foto1.jpg limpo foto2.jpg sujo   --license "Fotos próprias" --author "Nome" --group sessao-3 --reviewed
python train_model.py
```

Use um `--group` por sessão de fotos: a avaliação nunca mistura fotos da mesma sessão no treino e no teste. Sem `--reviewed`, a foto fica pendente e não entra no treino. Para importar novamente os candidatos do Wikimedia Commons: `python -m scripts.import_wikimedia` e `python -m scripts.review_candidates`.

## API

```bash
curl -X POST http://127.0.0.1:5000/api/v1/predictions \
  -F "image=@data/raw/proprias/limpo/limpo2.jpg"
```

Resposta resumida:

```json
{
  "data": {
    "classification": "limpo",
    "confidence": 0.9012,
    "model": "Regressão logística",
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

- [Relatório técnico](docs/RELATORIO_ANALISE.md)
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
- Os modos renderizados alteram a cena, mas não forçam o resultado. Com o modelo atual, a cena marrom ainda pode ser classificada como `limpo`; use o modo de upload com `data/raw/proprias/sujo/sujo19.jpg` para demonstrar o alerta real. Essa falha é evidência da limitação do modelo, não deve ser escondida nem substituída por um rótulo simulado. O modelo ainda confunde água suja clara ou leitosa com limpa; mais fotos desse tipo são o próximo passo.

## Licenças e terceiros

As imagens externas mantêm URL, autor e licença no catálogo. Three.js 0.186.1 é distribuído sob MIT; o aviso está em `static/vendor/THREE-LICENSE.txt`. Fontes Inter e JetBrains Mono (SIL OFL 1.1) e demais assets estão em [docs/ASSETS.md](docs/ASSETS.md). Consulte [docs/DADOS.md](docs/DADOS.md) antes de redistribuir o dataset.
>>>>>>> pedro/dev
