"""ForgeVision: native visual encoder/projector for ForgeLM.

This is an independently implemented, trainable local visual front-end. It converts
RGB image tensors into ForgeLM-space visual tokens. It does not call any network or
external model, and untrained weights are not represented as useful image
understanding.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any
import torch
import torch.nn as nn
import torch.nn.functional as F


@dataclass
class ForgeVisionConfig:
    image_size: int = 224
    patch_size: int = 16
    in_channels: int = 3
    vision_dim: int = 128
    vision_layers: int = 2
    vision_heads: int = 4
    output_dim: int = 64
    dropout: float = 0.0

    @property
    def num_patches(self) -> int:
        side = self.image_size // self.patch_size
        return side * side


class VisionBlock(nn.Module):
    def __init__(self, c: ForgeVisionConfig):
        super().__init__()
        self.n1 = nn.LayerNorm(c.vision_dim)
        self.attn = nn.MultiheadAttention(c.vision_dim, c.vision_heads, dropout=c.dropout, batch_first=True)
        self.n2 = nn.LayerNorm(c.vision_dim)
        self.ff = nn.Sequential(
            nn.Linear(c.vision_dim, c.vision_dim * 4),
            nn.GELU(),
            nn.Linear(c.vision_dim * 4, c.vision_dim),
        )

    def forward(self, x):
        h = self.n1(x)
        a, _ = self.attn(h, h, h, need_weights=False)
        x = x + a
        return x + self.ff(self.n2(x))


class ForgeVisionEncoder(nn.Module):
    def __init__(self, c: ForgeVisionConfig):
        super().__init__()
        if c.image_size % c.patch_size:
            raise ValueError("image_size must be divisible by patch_size")
        self.config = c
        self.patch = nn.Conv2d(c.in_channels, c.vision_dim, kernel_size=c.patch_size, stride=c.patch_size, bias=False)
        self.cls = nn.Parameter(torch.zeros(1, 1, c.vision_dim))
        self.pos = nn.Parameter(torch.zeros(1, c.num_patches + 1, c.vision_dim))
        self.blocks = nn.ModuleList([VisionBlock(c) for _ in range(c.vision_layers)])
        self.norm = nn.LayerNorm(c.vision_dim)
        self.projector = nn.Sequential(
            nn.Linear(c.vision_dim, c.output_dim * 2),
            nn.GELU(),
            nn.Linear(c.output_dim * 2, c.output_dim),
        )
        self._init()

    def _init(self):
        nn.init.normal_(self.cls, std=0.02)
        nn.init.normal_(self.pos, std=0.02)
        for m in self.modules():
            if isinstance(m, (nn.Linear, nn.Conv2d)):
                nn.init.normal_(m.weight, std=0.02)
                if getattr(m, "bias", None) is not None:
                    nn.init.zeros_(m.bias)

    def preprocess(self, images: torch.Tensor) -> torch.Tensor:
        if images.ndim == 3:
            images = images.unsqueeze(0)
        if images.ndim != 4 or images.shape[1] != self.config.in_channels:
            raise ValueError("images must have shape [B,3,H,W] or [3,H,W]")
        images = images.to(dtype=torch.float32)
        if images.max().item() > 1.0:
            images = images / 255.0
        if images.shape[-2:] != (self.config.image_size, self.config.image_size):
            images = F.interpolate(images, size=(self.config.image_size, self.config.image_size), mode="bilinear", align_corners=False)
        return images.clamp(0, 1)

    def forward(self, images: torch.Tensor, *, include_cls: bool = True) -> torch.Tensor:
        x = self.preprocess(images)
        x = self.patch(x).flatten(2).transpose(1, 2)
        cls = self.cls.expand(x.shape[0], -1, -1)
        x = torch.cat([cls, x], dim=1)
        x = x + self.pos[:, :x.shape[1], :]
        for b in self.blocks:
            x = b(x)
        x = self.projector(self.norm(x))
        return x if include_cls else x[:, 1:, :]

    @torch.no_grad()
    def embed(self, images: torch.Tensor) -> torch.Tensor:
        self.eval()
        tokens = self(images)
        return F.normalize(tokens.mean(dim=1), p=2, dim=-1)

    def save(self, path: str | Path, metadata: dict[str, Any] | None = None):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        torch.save({"format":"ForgeVision-1","config":asdict(self.config),"state_dict":self.state_dict(),"metadata":metadata or {}}, path)

    @classmethod
    def load(cls, path: str | Path, device: str = "cpu"):
        data = torch.load(path, map_location=device, weights_only=False)
        if data.get("format") != "ForgeVision-1":
            raise ValueError("unsupported ForgeVision checkpoint")
        model = cls(ForgeVisionConfig(**data["config"]))
        model.load_state_dict(data["state_dict"])
        model.checkpoint_metadata = data.get("metadata", {})
        return model.to(device)


class ForgeMultimodalAdapter(nn.Module):
    """Projects ForgeVision tokens into the exact hidden size expected by ForgeLM."""
    def __init__(self, vision: ForgeVisionEncoder, language_dim: int):
        super().__init__()
        self.vision = vision
        self.language_dim = int(language_dim)
        if vision.config.output_dim == self.language_dim:
            self.adapter = nn.Identity()
        else:
            self.adapter = nn.Linear(vision.config.output_dim, self.language_dim, bias=False)

    def forward(self, images: torch.Tensor) -> torch.Tensor:
        return self.adapter(self.vision(images))


__all__ = ["ForgeVisionConfig", "ForgeVisionEncoder", "ForgeMultimodalAdapter"]
