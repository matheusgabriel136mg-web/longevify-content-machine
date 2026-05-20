#!/usr/bin/env python3
"""
viral-optimizer.py — Brain-based viral score predictor para conteúdo Longevify.

Usa TRIBE v2 para predizer resposta fMRI ao conteúdo visual e calcula um
score de viralização baseado em 4 métricas neurais:
  - Atenção visual    (V1/V2: córtex occipital/calcarino)
  - Resposta emocional (proxy: ínsula + polo temporal)
  - Memorabilidade    (proxy: giro parahipocampal)
  - Engajamento social (TPJ + mPFC)

Uso:
  python scripts/viral-optimizer.py output/stories/minha-story.png
  python scripts/viral-optimizer.py output/videos/*.mp4            # compara múltiplas versões
  python scripts/viral-optimizer.py output/stories/a.png output/stories/b.png

Requer: .venv com tribev2[plotting] instalado em ../tribev2/.venv
"""

import sys
import os
import subprocess
import tempfile
import json
import textwrap
from pathlib import Path
from datetime import datetime

import numpy as np

# ── Paths ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR   = Path(__file__).parent
ROOT         = SCRIPT_DIR.parent
TRIBEV2_DIR  = ROOT.parent / "tribev2"
VENV_PYTHON  = TRIBEV2_DIR / ".venv311" / "bin" / "python"
OUT_DIR      = ROOT / "output" / "brain-scores"
CACHE_DIR    = TRIBEV2_DIR / "cache"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ── ROI definitions (fsaverage5, índices por hemisfério) ──────────────────────

def get_roi_masks() -> dict[str, np.ndarray]:
    """
    Retorna máscaras de vértices por ROI usando o atlas Destrieux no fsaverage5.
    fsaverage5: 10242 vértices/hemisfério → 20484 total.
    LH: índices 0..10241 | RH: índices 10242..20483
    """
    from nilearn import datasets as nlds

    destrieux  = nlds.fetch_atlas_surf_destrieux()
    map_lh     = np.array(destrieux["map_left"])    # (10242,) int — índice no labels
    map_rh     = np.array(destrieux["map_right"])
    names      = [n.decode() if isinstance(n, bytes) else n
                  for n in destrieux["labels"]]
    name_to_idx = {n: i for i, n in enumerate(names)}

    def vertices(*region_names: str) -> np.ndarray:
        indices = []
        for rn in region_names:
            if rn not in name_to_idx:
                continue
            idx = name_to_idx[rn]
            indices.extend(np.where(map_lh == idx)[0].tolist())
            indices.extend((np.where(map_rh == idx)[0] + 10242).tolist())
        return np.array(indices, dtype=int)

    return {
        # Córtex visual primário/secundário
        "visual": vertices(
            "G_and_S_calcarine",          # V1
            "G_cuneus",                    # V2/V3
            "G_oc-temp_med-Lingual",       # área ventral visual
            "G_occipital_sup",
        ),
        # Proxy emocional: ínsula + córtex cingulado + polo temporal
        "emotion": vertices(
            "G_Ins_lg_and_S_cent_ins",
            "S_circular_insula_ant",
            "G_cingul-Post-dorsal",
            "Pole_temporal",
            "G_temp_sup-Lateral",
        ),
        # Proxy de memória: giro parahipocampal + entorhinal
        "memory": vertices(
            "G_oc-temp_med-Parahip",
            "S_collat_transv_post",
            "G_oc-temp_lat-fusifor",
        ),
        # Engajamento social: TPJ + mPFC
        "social": vertices(
            "G_pariet_inf-Supramar",       # TPJ superior
            "G_pariet_inf-Angular",        # TPJ inferior / angular
            "G_front_medial",              # mPFC
            "G_orbital",                   # OFC
            "G_front_inf-Triangul",        # IFG (Broca)
        ),
    }


# ── Image → video ─────────────────────────────────────────────────────────────

def image_to_video(img_path: Path, duration: float = 4.0) -> Path:
    """Converte imagem estática em vídeo de *duration* segundos para o TRIBE."""
    out = Path(tempfile.mktemp(suffix=".mp4"))
    subprocess.run(
        [
            "ffmpeg", "-y", "-loop", "1", "-i", str(img_path),
            "-c:v", "libx264", "-t", str(duration),
            "-pix_fmt", "yuv420p", "-vf", "scale=512:512",
            str(out),
        ],
        check=True, capture_output=True,
    )
    return out


# ── TRIBE inference ───────────────────────────────────────────────────────────

def run_tribe(asset: Path) -> np.ndarray:
    """Roda TRIBE v2 e retorna preds shape (n_timesteps, n_vertices)."""
    sys.path.insert(0, str(TRIBEV2_DIR))
    from tribev2 import TribeModel

    model = TribeModel.from_pretrained(
        "facebook/tribev2",
        cache_folder=str(CACHE_DIR),
        device="cpu",
        config_update={
            "data.video_feature.image.device": "cpu",
            "data.image_feature.image.device": "cpu",
            "data.audio_feature.device":       "cpu",
        },
    )

    suffix = asset.suffix.lower()
    image_exts = {".png", ".jpg", ".jpeg", ".webp"}

    if suffix in image_exts:
        video_path = image_to_video(asset)
        events = model.get_events_dataframe(video_path=str(video_path))
    else:
        events = model.get_events_dataframe(video_path=str(asset))

    preds, _ = model.predict(events, verbose=True)
    return preds  # (T, V)


# ── Score computation ─────────────────────────────────────────────────────────

def compute_scores(preds: np.ndarray, rois: dict[str, np.ndarray]) -> dict[str, float]:
    """
    Agrega ativação média por ROI e normaliza para 0–100.

    Estratégia:
      1. Média temporal (axis=0) → mapa de ativação por vértice
      2. z-score global para tornar comparável entre assets
      3. Média nos vértices do ROI → raw score por região
      4. Clip para [0, 100] com mapeamento linear via percentis
    """
    mean_act = preds.mean(axis=0)                 # (V,)
    z = (mean_act - mean_act.mean()) / (mean_act.std() + 1e-8)

    raw = {}
    for roi, idx in rois.items():
        if len(idx) == 0:
            raw[roi] = 0.0
            continue
        # Garante que índices não excedem dimensão
        idx = idx[idx < len(z)]
        raw[roi] = float(z[idx].mean())

    # Normaliza 0–100 usando os valores raw dos 4 ROIs
    vals = np.array(list(raw.values()))
    lo, hi = vals.min() - 0.5, vals.max() + 0.5   # pequena folga
    scores = {}
    for roi, v in raw.items():
        score = 100 * (v - lo) / (hi - lo + 1e-8)
        scores[roi] = float(np.clip(score, 0, 100))

    # Viral score: média ponderada (atenção e emoção têm mais peso)
    weights = {"visual": 0.30, "emotion": 0.30, "memory": 0.20, "social": 0.20}
    scores["viral"] = sum(weights[k] * scores[k] for k in weights)
    return scores


# ── Sugestões ─────────────────────────────────────────────────────────────────

SUGGESTIONS = {
    "visual":  (
        "Score de atenção visual baixo → aumenta o contraste entre foreground e fundo, "
        "adiciona um elemento em movimento sutil (partículas, glow pulsante) ou usa "
        "enquadramento mais fechado (crop mais tight)."
    ),
    "emotion": (
        "Resposta emocional baixa → experimenta paleta mais quente (âmbar/laranja em vez "
        "de teal frio), adiciona música mais intensa no reel, ou usa closeup de rosto/textura "
        "orgânica que evoca contato humano."
    ),
    "memory":  (
        "Memorabilidade baixa → introduz um elemento visual único e inesperado (ex: objeto "
        "fora de contexto, ângulo incomum de câmera, detalhe que o olho não esperava). "
        "Elementos de surpresa disparam o giro parahipocampal."
    ),
    "social":  (
        "Engajamento social baixo → adiciona elemento humano (mão, rosto, silhueta) ou "
        "texto que cria pertencimento ('Você sabia que...', 'Para quem já sentiu...'). "
        "TPJ responde a perspectiva de outra pessoa."
    ),
}

THRESHOLD = 65.0  # abaixo disso, a sugestão aparece


# ── Markdown report ───────────────────────────────────────────────────────────

LABELS = {
    "visual":  "Atenção visual",
    "emotion": "Resposta emocional",
    "memory":  "Memorabilidade",
    "social":  "Engajamento social",
}


def build_report(asset: Path, scores: dict[str, float]) -> str:
    viral  = scores["viral"]
    lines  = [
        f"# Brain Score — {asset.name}",
        f"**Asset:** `{asset.name}`  ",
        f"**Viral Score: {viral:.0f}/100**",
        "",
        "## Scores por Região Neural",
        "",
        f"| Métrica | Score | Status |",
        f"|---------|-------|--------|",
    ]
    for k, label in LABELS.items():
        s = scores[k]
        emoji = "✅" if s >= 70 else ("⚠️" if s >= 55 else "🔴")
        lines.append(f"| {label} | {s:.0f}/100 | {emoji} |")

    low = [k for k in LABELS if scores[k] < THRESHOLD]
    if low:
        lines += ["", "## Sugestões de Melhoria", ""]
        for k in low:
            lines.append(f"### {LABELS[k]} ({scores[k]:.0f}/100)")
            lines.append(textwrap.fill(SUGGESTIONS[k], 90))
            lines.append("")
    else:
        lines += ["", "✅ Todos os scores acima do limiar — manda bala!", ""]

    lines += [
        "---",
        f"*Gerado em {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} "
        f"via TRIBE v2 (facebook/tribev2)*",
    ]
    return "\n".join(lines)


# ── Pipeline integração ───────────────────────────────────────────────────────

def analyze(asset_path: Path, rois: dict[str, np.ndarray]) -> dict:
    print(f"\n🧠 Analisando: {asset_path.name}")
    preds  = run_tribe(asset_path)
    scores = compute_scores(preds, rois)
    report = build_report(asset_path, scores)

    ts      = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    stem    = asset_path.stem
    outfile = OUT_DIR / f"{ts}-{stem}-analysis.md"
    outfile.write_text(report, encoding="utf-8")

    print(f"   Viral Score: {scores['viral']:.0f}/100")
    for k, label in LABELS.items():
        print(f"   {label}: {scores[k]:.0f}/100")
    print(f"   📄 Relatório: {outfile}")

    return {"asset": str(asset_path), "scores": scores, "report": str(outfile)}


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    assets = [Path(a) for a in sys.argv[1:]]
    if not assets:
        # Se nenhum argumento, usa o output mais recente
        candidates = list((ROOT / "output").rglob("*.png")) + \
                     list((ROOT / "output").rglob("*.mp4"))
        if not candidates:
            print("❌ Nenhum asset encontrado. Passe o caminho como argumento.")
            sys.exit(1)
        candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        assets = [candidates[0]]
        print(f"ℹ️  Nenhum argumento — usando o mais recente: {assets[0].name}")

    missing = [a for a in assets if not a.exists()]
    if missing:
        print(f"❌ Arquivo(s) não encontrado(s): {', '.join(str(m) for m in missing)}")
        sys.exit(1)

    print("\n🔬 Longevify Viral Optimizer — TRIBE v2")
    print("─" * 50)

    rois    = get_roi_masks()
    results = [analyze(a, rois) for a in assets]

    if len(results) > 1:
        print("\n📊 Ranking de Viralização:")
        ranked = sorted(results, key=lambda r: r["scores"]["viral"], reverse=True)
        for i, r in enumerate(ranked, 1):
            name  = Path(r["asset"]).name
            score = r["scores"]["viral"]
            flag  = "🏆" if i == 1 else f"#{i}"
            print(f"   {flag} {name}: {score:.0f}/100")

    # Pipeline integration: warn se score < 70
    for r in results:
        viral = r["scores"]["viral"]
        name  = Path(r["asset"]).name
        if viral < 70:
            print(f"\n⚠️  AVISO: {name} com score {viral:.0f}/100 (< 70) — revisa antes de postar!")
        else:
            print(f"\n✅ {name}: {viral:.0f}/100 — manda bala!")


if __name__ == "__main__":
    main()
