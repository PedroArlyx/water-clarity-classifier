# Water Clarity Classifier

Classificador educacional que estima se a água de um copo parece **limpa** ou **suja** a partir de uma fotografia. O repositório reúne aquisição e auditoria de dados, histograma RGB, treino reproduzível do `modelo_agua`, API Flask, interface clássica e uma demonstração 3D cujo robô envia uma captura real da cena ao mesmo classificador.

> **Aviso:** o sistema avalia somente aparência visual. Ele não comprova potabilidade nem segurança química ou microbiológica e não deve orientar consumo.

## Resultado atual

O único modelo usado é `model/modelo_agua.pkl`: `Normalizer(l1)` → `SelectKBest(chi2, k=500)` → `GaussianNB`, treinado com scikit-learn 1.8.0 sobre 65 fotos (19 `limpo`, 46 `sujo`): as 50 originais do notebook do Colab mais as 15 fotos de celular em `data/raw/proprias/`. Métricas da validação cruzada estratificada de cinco folds:

| Métrica do Naive Bayes | Média |
|---|---:|
| F1 macro | 0,6991 |
| Acurácia balanceada | 0,7189 |
| Acurácia | 0,7538 |
| F1 ponderado | 0,7504 |

A matriz de confusão fora do treino foi `[[12, 7], [9, 37]]`, na ordem `limpo`, `sujo`; desvio do F1 macro entre folds: 0,0998. O conjunto é mais variado que as 50 originais, por isso o F1 não é comparável ao 0,81 anterior. Ainda há poucas fotos limpas (19 × 46): o modelo tende a responder `sujo`. 36 fotos do Wikimedia Commons (`data/raw/commons/`) ficam como `reserva`, fora do treino, porque são quase todas de água limpa e ensinavam "foto da internet = limpo".

## O que o projeto faz

- valida extensão, MIME, assinatura, formato, dimensões e limite de pixels do upload;
- corrige orientação EXIF, converte a imagem para RGB e extrai 768 bins de histograma normalizados;
- classifica com o `modelo_agua` (normalização L1, seleção de 500 atributos por qui-quadrado e Gaussian Naive Bayes);
- avalia com `StratifiedKFold(5, shuffle=True, random_state=42)`, métrica principal F1 macro;
- gera CSV de métricas, gráficos, matriz de confusão e metadados do experimento;
- treina o `modelo_agua` com 100% dos dados depois da avaliação;
- atende upload tradicional e uma cozinha 3D interativa pelo mesmo endpoint de inferência;
- expõe dashboard experimental e API JSON versionada;
- cataloga procedência, licença, revisão e hash das imagens externas;
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

O `res.csv.bak` preserva as 50 linhas legadas. As imagens aprovadas no catálogo `data/metadata/images.csv` são transformadas e combinadas a essa base para produzir `res.csv`.

```bash
# Reexecuta auditoria, preparação e treinamento completo
python -m scripts.pipeline

# Etapas independentes
python -m scripts.audit_dataset
python -m scripts.prepare_dataset
python train_model.py --evaluate-only   # só validação cruzada, não grava nada
python -m scripts.train_final           # avalia e retreina model/modelo_agua.pkl
```

Para importar novamente os candidatos selecionados do Wikimedia Commons é necessário acesso à internet:

```bash
python -m scripts.import_wikimedia
python -m scripts.review_candidates
```

Para catalogar uma nova imagem local, informe licença e autoria. Sem `--reviewed`, ela permanece pendente e não entra no dataset preparado.

```bash
python add_to_dataset.py foto.jpg limpo \
  --license "CC BY-SA 4.0" --author "Nome" --source-url "https://..."
python -m scripts.review_candidates
python -m scripts.prepare_dataset
```

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
    "model": "Naive Bayes",
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
- Os modos renderizados alteram a cena, mas não forçam o resultado. Com o modelo atual, a cena marrom ainda pode ser classificada como `limpo`; use o modo de upload com `data/raw/proprias/sujo/sujo19.jpg` para demonstrar o alerta real. Essa falha é evidência da limitação do modelo, não deve ser escondida nem substituída por um rótulo simulado. O Gaussian Naive Bayes sobre 500 bins produz probabilidades extremas (0 ou 1) e classifica como `sujo` fotos que se afastam das 50 do treino — inclusive `limpo2.jpg` e as fotos limpas de `data/raw`.

## Licenças e terceiros

As imagens externas mantêm URL, autor e licença no catálogo. Three.js 0.186.1 é distribuído sob MIT; o aviso está em `static/vendor/THREE-LICENSE.txt`. Fontes Inter e JetBrains Mono (SIL OFL 1.1) e demais assets estão em [docs/ASSETS.md](docs/ASSETS.md). Consulte [docs/DADOS.md](docs/DADOS.md) antes de redistribuir o dataset.
