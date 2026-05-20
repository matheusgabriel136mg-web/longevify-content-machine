/**
 * image-provider.ts — Provider-agnostic image generation.
 *
 * Permite trocar Higgsfield → Replicate → FAL sem mudar visual-gen.ts.
 * Falha de um provider → tenta o próximo da lista PROVIDERS.
 *
 * Hoje: Higgsfield primary, Replicate stub (instalar SDK depois).
 */

import { execSync } from "child_process";
import { recordCost, PRICING } from "./cost-guard.js";
import { rateLimit } from "./rate-limiter.js";

export interface GenerateRequest {
  prompt: string;
  aspect: "4:5" | "9:16" | "1:1" | "3:4" | "16:9";
  resolution: "1k" | "2k" | "1080p" | "720p";
  runId?: string;
  phase?: string;
}

export interface GenerateResult {
  url: string;
  provider: string;
  cost_usd: number;
}

interface Provider {
  name: string;
  available: () => boolean;
  generate: (req: GenerateRequest) => Promise<GenerateResult>;
}

// ─── Higgsfield (primary) ──────────────────────────────────────────────────

const higgsfield: Provider = {
  name: "higgsfield",
  available: () => {
    try {
      execSync("which higgsfield", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  },
  generate: async (req) => {
    await rateLimit("higgsfield");
    const escapedPrompt = req.prompt.replace(/"/g, '\\"');
    const cmd = `higgsfield generate create nano_banana_2 --prompt "${escapedPrompt}" --aspect_ratio ${req.aspect} --resolution ${req.resolution} --wait`;
    const out = execSync(cmd, { encoding: "utf-8", timeout: 300_000 });
    const m = out.match(/https?:\/\/\S+\.(png|jpg|jpeg|webp)/);
    if (!m) throw new Error(`Higgsfield no URL in:\n${out}`);
    const url = m[0];
    const cost = PRICING["higgsfield-image"].per_call;
    recordCost({ provider: "higgsfield-image", usd: cost, run: req.runId, phase: req.phase, details: req.prompt.slice(0, 80) });
    return { url, provider: "higgsfield", cost_usd: cost };
  },
};

// ─── Replicate (fallback skeleton — implementar quando precisar) ──────────

const replicate: Provider = {
  name: "replicate",
  available: () => Boolean(process.env.REPLICATE_API_TOKEN),
  generate: async () => {
    throw new Error("Replicate provider not yet implemented. Install replicate SDK + implement here.");
  },
};

// ─── FAL (fallback skeleton) ──────────────────────────────────────────────

const fal: Provider = {
  name: "fal",
  available: () => Boolean(process.env.FAL_KEY),
  generate: async () => {
    throw new Error("FAL provider not yet implemented.");
  },
};

const PROVIDERS: Provider[] = [higgsfield, replicate, fal];

export async function generateImage(req: GenerateRequest): Promise<GenerateResult> {
  const errors: string[] = [];
  for (const p of PROVIDERS) {
    if (!p.available()) {
      errors.push(`${p.name}: not configured`);
      continue;
    }
    try {
      return await p.generate(req);
    } catch (e) {
      errors.push(`${p.name}: ${(e as Error).message}`);
    }
  }
  throw new Error(`All image providers failed:\n${errors.join("\n")}`);
}
