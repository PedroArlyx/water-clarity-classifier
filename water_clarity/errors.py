"""Erros de domínio convertidos em respostas HTTP previsíveis."""


class WaterClarityError(Exception):
    """Erro base conhecido pela aplicação."""

    status_code = 400
    code = "water_clarity_error"

    def __init__(self, message: str, *, status_code: int | None = None, code: str | None = None):
        super().__init__(message)
        self.message = message
        if status_code is not None:
            self.status_code = status_code
        if code is not None:
            self.code = code


class InvalidImageError(WaterClarityError):
    status_code = 422
    code = "invalid_image"


class ModelUnavailableError(WaterClarityError):
    status_code = 503
    code = "model_unavailable"

