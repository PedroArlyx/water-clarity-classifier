"""Avalia os candidatos e treina o vencedor com todo o dataset."""

from train_model import run_pipeline

if __name__ == "__main__":
    run_pipeline(evaluate_only=False)
