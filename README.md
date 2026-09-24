# Classificador de Copo de Água (Limpo/Sujo)

Aplicação que treina um modelo de classificação sobre o dataset `res.csv` e disponibiliza uma interface web onde o usuário envia uma foto de um copo de água e recebe a classificação **limpo** ou **sujo**.

## Dataset

`res.csv` contém 52 exemplos (50 originais + 2 fotos reais adicionadas via `add_to_dataset.py` para melhorar a generalização — ver nota abaixo). Cada linha representa uma imagem, descrita por um **histograma de cor** de 256 bins por canal (`r0..r255`, `g0..g255`, `b0..b255` — 768 features no total) mais a coluna `class` (`limpo` ou `sujo`).

Distribuição de classes: 37 `sujo` / 15 `limpo` (dataset pequeno e desbalanceado).

> **Nota sobre generalização:** as 50 fotos originais parecem ter sido capturadas com o copo preenchendo quase todo o quadro (médias de RGB entre ~98–122 em todas as amostras). Fotos reais tiradas com celular, com mais fundo/parede no enquadramento, ficam fora dessa distribuição e podem ser classificadas incorretamente. Use `add_to_dataset.py <foto> <limpo|sujo> ...` para adicionar mais fotos reais ao dataset e rode `train_model.py` de novo — quanto mais variedade de enquadramento/iluminação nos exemplos, mais robusto o modelo fica para uso real.

## Metodologia (KDD)

Implementada em `train_model.py`:

1. **Seleção dos dados** — carrega `res.csv`.
2. **Pré-processamento** — remove nulos e duplicatas.
3. **Transformação** — separa features (histograma RGB) do alvo (`class`), normaliza cada canal para frequência relativa (soma 1 por canal, invariante à resolução da foto) e codifica o rótulo.
4. **Mineração de dados** — avalia 7 algoritmos de classificação com validação cruzada estratificada (5-fold): KNN, Decision Tree, Random Forest, Naive Bayes, SVM, Regressão Logística e Gradient Boosting. Modelos usam `class_weight="balanced"` (quando suportado) para compensar o desbalanceamento.
5. **Interpretação/avaliação** — compara acurácia, precisão, recall e F1 (ponderados) entre os algoritmos.
6. **Modelo final** — o algoritmo vencedor é retreinado com **todo** o dataset (sem divisão treino/teste) e salvo em `model/model.pkl`.

### Resultado da avaliação (validação cruzada 5-fold, 52 amostras)

| Modelo             | Acurácia | Precisão | Recall | F1     |
|--------------------|----------|----------|--------|--------|
| **SVM (vencedor)** | 0.769    | 0.794    | 0.769  | 0.776  |
| Gradient Boosting  | 0.751    | 0.759    | 0.751  | 0.745  |
| Random Forest      | 0.749    | 0.779    | 0.749  | 0.754  |
| Naive Bayes        | 0.731    | 0.731    | 0.731  | 0.720  |
| KNN                | 0.729    | 0.744    | 0.729  | 0.726  |
| Logistic Regression| 0.673    | 0.710    | 0.673  | 0.684  |
| Decision Tree      | 0.635    | 0.619    | 0.635  | 0.619  |

O gráfico comparativo fica em `comparacao_modelos.png` e a tabela completa em `resultados_avaliacao.csv`.

## Aplicação web

- `app.py` — backend Flask com as rotas `/` (formulário de upload) e `/predict` (recebe a imagem, extrai as features e classifica).
- `feature_extraction.py` — abre a imagem enviada e calcula o mesmo histograma de 768 bins (256 por canal R/G/B, normalizado por frequência relativa) usado no treinamento, além do RGB médio (exibido ao usuário). A normalização por total de pixels torna a predição invariante à resolução da foto enviada.
- `templates/index.html` + `static/style.css` — interface de upload e exibição do resultado (classe prevista, RGB médio e confiança do modelo).

## Como executar

```bash
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt

# 1. Treinar e avaliar os modelos (gera model/model.pkl)
.venv\Scripts\python.exe train_model.py

# 2. Rodar a aplicação web
.venv\Scripts\python.exe app.py
```

Depois abra `http://127.0.0.1:5000` no navegador, envie uma foto de um copo de água e veja o resultado.

## Estrutura do projeto

```
res.csv                    # dataset (histograma RGB + classe)
train_model.py              # pipeline KDD: avaliação, escolha e treino do modelo final
feature_extraction.py       # extração de features (histograma RGB) de uma imagem
add_to_dataset.py           # adiciona novas fotos rotuladas ao res.csv
app.py                      # backend Flask
templates/index.html        # frontend (upload + resultado)
static/style.css            # estilos da interface
model/model.pkl             # modelo treinado (gerado por train_model.py)
resultados_avaliacao.csv    # métricas de todos os algoritmos avaliados
comparacao_modelos.png      # gráfico comparativo dos algoritmos
```

## Limitações conhecidas

- Dataset pequeno (52 amostras) e desbalanceado (37 sujo / 15 limpo), o que limita a robustez estatística da avaliação.
- Fotos com composição/iluminação muito diferentes das do dataset (por exemplo, muito fundo/parede em vez do copo preenchendo o quadro) ainda podem reduzir a confiabilidade da predição — quanto mais fotos reais variadas forem adicionadas com `add_to_dataset.py`, melhor a generalização.
