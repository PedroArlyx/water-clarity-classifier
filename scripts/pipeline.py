"""Executa auditoria, preparação do res.csv e treinamento em uma única ordem reproduzível."""

from scripts.audit_dataset import main as audit
from scripts.prepare_dataset import main as prepare
from train_model import run_pipeline


def main() -> int:
    audit()
    prepare()
    run_pipeline(evaluate_only=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
