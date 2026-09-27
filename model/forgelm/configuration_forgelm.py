from __future__ import annotations

from dataclasses import asdict, dataclass
import json
from pathlib import Path
from typing import Any, Dict


@dataclass(frozen=True)
class ForgeLMConfig:
    model_type: str = "forgelm"
    vocab_size: int = 32768
    max_position_embeddings: int = 2048
    hidden_size: int = 384
    num_hidden_layers: int = 8
    num_attention_heads: int = 6
    num_key_value_heads: int = 2
    head_dim: int = 64
    intermediate_size: int = 1024
    rope_theta: float = 10000.0
    rms_norm_eps: float = 1e-5
    initializer_range: float = 0.02
    tie_word_embeddings: bool = True
    attention_bias: bool = False
    mlp_bias: bool = False
    dropout: float = 0.0
    pad_token_id: int = 0
    bos_token_id: int = 1
    eos_token_id: int = 2

    def validate(self) -> None:
        if self.hidden_size <= 0 or self.num_hidden_layers <= 0:
            raise ValueError("hidden_size and num_hidden_layers must be positive")
        if self.hidden_size % self.num_attention_heads != 0:
            raise ValueError("hidden_size must be divisible by num_attention_heads")
        if self.num_attention_heads % self.num_key_value_heads != 0:
            raise ValueError("num_attention_heads must be divisible by num_key_value_heads")
        if self.hidden_size // self.num_attention_heads != self.head_dim:
            raise ValueError("head_dim must equal hidden_size / num_attention_heads")
        if self.head_dim % 2:
            raise ValueError("head_dim must be even for RoPE")
        if self.vocab_size < 288:
            raise ValueError("vocab_size must be >= 288 for the bootstrap byte tokenizer")
        if self.max_position_embeddings < 16:
            raise ValueError("max_position_embeddings is too small")
        if not (0.0 <= self.dropout < 1.0):
            raise ValueError("dropout must be in [0, 1)")

    def to_dict(self) -> Dict[str, Any]:
        self.validate()
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ForgeLMConfig":
        cfg = cls(**data)
        cfg.validate()
        return cfg

    def save_json(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(self.to_dict(), indent=2, sort_keys=True) + "\n", encoding="utf-8")

    @classmethod
    def load_json(cls, path: str | Path) -> "ForgeLMConfig":
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))

    @classmethod
    def nano(cls) -> "ForgeLMConfig":
        cfg = cls()
        cfg.validate()
        return cfg

    @classmethod
    def smoke(cls) -> "ForgeLMConfig":
        cfg = cls(
            vocab_size=512,
            max_position_embeddings=96,
            hidden_size=64,
            num_hidden_layers=2,
            num_attention_heads=4,
            num_key_value_heads=2,
            head_dim=16,
            intermediate_size=128,
        )
        cfg.validate()
        return cfg
