# GitHub migration checkpoint

The v0.30.0 tree is structured for GitHub. Commit source and manifests, but not mutable databases, checkpoints, downloaded datasets, credentials, or vendor-reference trees. GitHub Actions runs the dependency-light Node regression suite and portable Python checks. Model/GPU jobs should be added separately on runners where those dependencies are genuinely installed.
