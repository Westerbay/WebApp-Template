"""Keep one stable required status, including failed, cancelled and skipped jobs."""

import json
import os
import sys


def passed(needs, validation_jobs):
    planning = needs["plan"]
    if planning["result"] != "success":
        return False
    outputs = planning["outputs"]
    if any(outputs.get(key) not in ("true", "false") for key in ("validation", "security")):
        return False
    for job in validation_jobs + ["security"]:
        enabled = outputs["security" if job == "security" else "validation"] == "true"
        if needs[job]["result"] != ("success" if enabled else "skipped"):
            return False
    return True


if __name__ == "__main__":
    needs = json.loads(os.environ["NEEDS"])
    print("CI results:", json.dumps(needs))
    sys.exit(0 if passed(needs, os.environ["VALIDATION_JOBS"].split(",")) else 1)
