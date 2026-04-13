import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from config import ExperimentConfig
from runner import run_experiment

if __name__ == "__main__":
    config_path = sys.argv[1] if len(sys.argv) > 1 else "experiment.yaml"
    asyncio.run(run_experiment(ExperimentConfig.from_yaml(config_path)))
