# API HTTP

Prefixo atual: `/api/v1`. Todas as falhas da API seguem `{"error":{"code":"...","message":"..."}}`.

## `POST /api/v1/predictions`

Recebe `multipart/form-data` com o campo obrigatório `image`. Formatos aceitos: PNG, JPEG, WebP e BMP. Limites: 16 MB no corpo, 24 megapixels e 10 partes de formulário.

```bash
curl -X POST http://127.0.0.1:5000/api/v1/predictions -F "image=@sujo19.jpg"
```

```json
{
  "data": {
    "classification": "sujo",
    "confidence": 0.9457,
    "probabilities": {"limpo": 0.0543, "sujo": 0.9457},
    "model": "SVM",
    "pipeline": [
      {"name": "scaler", "estimator": "StandardScaler"},
      {"name": "classifier", "estimator": "SVC"}
    ],
    "features": {
      "mean_rgb": [115.21, 130.4, 127.33],
      "histogram": {"r": [0.0, "... 32 faixas"], "g": ["..."], "b": ["..."]},
      "count": 794,
      "histogram_count": 768,
      "engineered_count": 26,
      "schema_version": "rgb-histogram-stats-v2"
    },
    "image": {"format": "JPEG", "height": 3000, "width": 4000, "mime_type": "image/jpeg"},
    "warning": "Resultado baseado somente na aparência visual; não confirma potabilidade, segurança química ou microbiológica."
  }
}
```

Campos adicionados na etapa visual (aditivos, sem quebrar clientes):

- `features.histogram` — os 256 bins normalizados de cada canal, **extraídos pelo servidor**, agrupados em 32 faixas (cada faixa é a soma de 8 bins; cada canal soma 1). Usado no histograma da interface.
- `features.count`, `histogram_count`, `engineered_count`, `schema_version` — tamanho real do vetor enviado ao modelo.
- `pipeline` — etapas reais do `sklearn.Pipeline` carregado (ex.: normalização + classificador). Nenhum nome de algoritmo é fixo no frontend.
- `probabilities` — `predict_proba` por classe, na ordem de `classes_` do pipeline.

A confiança é a maior probabilidade estimada pelo classificador. Ela não é uma medida de potabilidade e não representa calibração clínica ou laboratorial.

## Consulta

| Método e rota | Conteúdo |
|---|---|
| `GET /api/v1/health` | estado da aplicação e disponibilidade do modelo |
| `GET /api/v1/model` | nome, schema e resumo do modelo |
| `GET /api/v1/model/metrics` | métricas reais da validação |
| `GET /api/v1/model/metadata` | metadados completos, hash, versões e resultados |

## Erros relevantes

| HTTP | Código | Situação |
|---:|---|---|
| 400 | `missing_image` | campo de imagem ausente |
| 413 | `request_too_large` | corpo acima de 16 MB |
| 415 | `unsupported_image_type` | extensão/MIME/formato não permitido ou divergente |
| 422 | `invalid_image` | bytes corrompidos, dimensão inválida ou limite de pixels |
| 503 | `model_unavailable` | artefato ausente ou incompatível |
| 500 | `internal_error` | falha não prevista sem exposição de stack trace |

Não há autenticação: trata-se de uma demonstração pública e sem dados persistidos. Em cenário multiusuário, aplique rate limiting no proxy, TLS e monitoramento.
