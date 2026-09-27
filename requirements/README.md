# UAI Python environment contract

The core UAI server and governance/data-plane tooling use Python's standard library and SQLite where possible. Neural and multimodal runtimes are optional and are probed at runtime; installing a package never makes a capability `CONNECTED` by itself.

Authoritative CI currently uses Python 3.13. The neural lane explicitly installs CPU PyTorch and runs ForgeLM train/save/load plus advanced-objective tests. Optional model, dense-retrieval, OCR, PDF, audio and video dependencies are documented in `requirements/runtime-matrix.json`.

For reproducibility, do not treat this file as a universal lock for platform-specific packages such as PyTorch. Android/Termux, Linux CPU and GPU builds may require different wheels or package-manager sources. Runtime status must report the actual import/executable probe result.
