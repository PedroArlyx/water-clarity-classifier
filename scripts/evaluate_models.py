"""Executa somente a avaliação comparativa, sem substituir o modelo servido."""

from train_model import run_pipeline

if __name__ == "__main__":
    run_pipeline(evaluate_only=True)
