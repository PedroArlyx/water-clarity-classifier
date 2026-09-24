# API HTTP

Prefixo atual: `/api/v1`. Todas as falhas da API seguem `{"error":{"code":"...","message":"..."}}`.

## `POST /api/v1/predictions`

Recebe `multipart/form-data` com o campo obrigatório `image`. Formatos aceitos: PNG, JPEG, WebP e BMP. Limites: 16 MB no corpo, 24 megapixels e 10 partes de formulário.

```bash
curl -X POST http://127.0.0.1:5000/api/v1/predictions -F "image=@sujo19.jpg"
```

```json
{
  "prediction": {
    "classification": "sujo",
    "confidence": 0.9457,
    "image": {"format": "JPEG", "height": 4160, "width": 3120},
    "mean_rgb": {"b": 75.21, "g": 91.33, "r": 103.84},
    "model": "SVM",
    "warning": "Resultado baseado somente na aparência visual; não confirma potabilidade, segurança química ou microbiológica."
  }
}
```

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
