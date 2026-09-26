"""Inicia o servidor de desenvolvimento sem ativar debug implicitamente."""

import os

from water_clarity import create_app

if __name__ == "__main__":
    create_app().run(
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "5000")),
        debug=os.getenv("FLASK_DEBUG", "0") == "1",
    )
