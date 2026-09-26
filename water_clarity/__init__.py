"""Factory Flask do Water Clarity Classifier."""

from __future__ import annotations

import os

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge

from water_clarity.api import api
from water_clarity.errors import WaterClarityError
from water_clarity.settings import MAX_UPLOAD_BYTES, PROJECT_ROOT
from water_clarity.web import web


def create_app(test_config: dict | None = None) -> Flask:
    production = os.getenv("FLASK_ENV") == "production"
    trusted_hosts = [
        host.strip()
        for host in os.getenv("TRUSTED_HOSTS", "").split(",")
        if host.strip()
    ]
    app = Flask(
        __name__,
        template_folder=str(PROJECT_ROOT / "templates"),
        static_folder=str(PROJECT_ROOT / "static"),
    )
    app.config.from_mapping(
        MAX_CONTENT_LENGTH=MAX_UPLOAD_BYTES,
        MAX_FORM_MEMORY_SIZE=128 * 1024,
        MAX_FORM_PARTS=10,
        JSON_SORT_KEYS=False,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=production,
    )
    if production and trusted_hosts:
        app.config["TRUSTED_HOSTS"] = trusted_hosts
    if test_config:
        app.config.update(test_config)

    app.register_blueprint(web)
    app.register_blueprint(api)

    @app.after_request
    def security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=(), payment=()",
        )
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; "
            "img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; "
            "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
        )
        return response

    @app.errorhandler(WaterClarityError)
    def handle_known_error(error: WaterClarityError):
        if request.path.startswith("/api/"):
            return jsonify({"error": {"code": error.code, "message": error.message}}), error.status_code
        return render_template("error.html", page="error", error=error.message), error.status_code

    @app.errorhandler(RequestEntityTooLarge)
    def handle_large_request(_error):
        message = "O arquivo excede o limite máximo permitido de 16 MB."
        if request.path.startswith("/api/"):
            return jsonify({"error": {"code": "request_too_large", "message": message}}), 413
        return render_template("error.html", page="error", error=message), 413

    @app.errorhandler(404)
    def not_found(_error):
        if request.path.startswith("/api/"):
            return jsonify({"error": {"code": "not_found", "message": "Recurso não encontrado."}}), 404
        return render_template("error.html", page="error", error="Página não encontrada."), 404

    @app.errorhandler(Exception)
    def unexpected_error(error: Exception):
        if isinstance(error, HTTPException):
            return error
        app.logger.exception("Falha inesperada durante a requisição")
        message = "Não foi possível concluir a operação. Tente novamente."
        if request.path.startswith("/api/"):
            return jsonify({"error": {"code": "internal_error", "message": message}}), 500
        return render_template("error.html", page="error", error=message), 500

    return app
