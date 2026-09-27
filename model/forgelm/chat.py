from __future__ import annotations

import argparse
import torch

from .checkpoint import load_checkpoint
from .generation import generate


def answer(model, tokenizer, text: str, *, max_new_tokens: int, temperature: float) -> str:
    prompt = "<|user|>\n" + text.strip() + "\n<|end_turn|>\n<|assistant|>\n"
    ids = tokenizer.encode(prompt, add_bos=True)
    device = next(model.parameters()).device
    input_ids = torch.tensor([ids], dtype=torch.long, device=device)
    out = generate(
        model,
        input_ids,
        max_new_tokens=max_new_tokens,
        eos_token_id=tokenizer.eos_token_id,
        temperature=temperature,
        top_k=50,
        top_p=0.95,
        repetition_penalty=1.05,
    )
    new_ids = out[0, input_ids.shape[1] :].tolist()
    text_out = tokenizer.decode(new_ids, skip_special_tokens=True)
    return text_out.strip()


def main() -> None:
    p = argparse.ArgumentParser(description="Chat with a local ForgeLM checkpoint")
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--device", default="cpu")
    p.add_argument("--prompt")
    p.add_argument("--max-new-tokens", type=int, default=96)
    p.add_argument("--temperature", type=float, default=0.8)
    args = p.parse_args()
    model, tokenizer, manifest = load_checkpoint(args.checkpoint, device=args.device)
    print(f"ForgeLM loaded · params={manifest['parameter_count']} · step={manifest['step']} · device={args.device}")
    if args.prompt is not None:
        print(answer(model, tokenizer, args.prompt, max_new_tokens=args.max_new_tokens, temperature=args.temperature))
        return
    while True:
        try:
            line = input("you> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not line:
            continue
        if line.lower() in {"quit", "exit", "/quit", "/exit"}:
            break
        print("forge> " + answer(model, tokenizer, line, max_new_tokens=args.max_new_tokens, temperature=args.temperature))


if __name__ == "__main__":
    main()
