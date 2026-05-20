#!/usr/bin/env python3
"""
calibrate.py — Treina camada de calibração TRIBE v2 → vsMedian (Instagram).

Lê todos os relatórios em output/brain-scores/, junta com features de raw-posts.json
da última análise, treina Ridge regression com 5-fold CV.

Output:
  output/calibration/calibration-report.md  — feature importance + R²
  output/calibration/weights.json           — pesos calibrados (substitui hardcoded
                                              do viral-optimizer.py)

Uso: python scripts/calibrate.py
Requer venv311 (já tem numpy). Instala scikit-learn se faltar.
"""

import json
import re
import subprocess
import sys
from pathlib import Path
from datetime import datetime

import numpy as np

# ── Garante sklearn ──────────────────────────────────────────────────────────
try:
    from sklearn.linear_model import Ridge, RidgeCV
    from sklearn.model_selection import cross_val_score, KFold
    from sklearn.preprocessing import StandardScaler
    from sklearn.metrics import r2_score
except ImportError:
    print("📦 Instalando scikit-learn…")
    subprocess.run([sys.executable, "-m", "pip", "install", "scikit-learn"], check=True)
    from sklearn.linear_model import Ridge, RidgeCV
    from sklearn.model_selection import cross_val_score, KFold
    from sklearn.preprocessing import StandardScaler
    from sklearn.metrics import r2_score

# ── Paths ────────────────────────────────────────────────────────────────────

ROOT = Path(__file__).parent.parent
BRAIN_OUT = ROOT / "output" / "brain-scores"
CAL_OUT = ROOT / "output" / "calibration"
CAL_OUT.mkdir(parents=True, exist_ok=True)


def find_latest_analysis_dir() -> Path:
    candidates = sorted(p for p in (ROOT / "output").iterdir() if p.name.startswith("analysis-"))
    if not candidates:
        raise RuntimeError("Nenhuma pasta analysis-*")
    return candidates[-1]


# ── Parse brain-score reports ────────────────────────────────────────────────

SCORE_RE = re.compile(r"\| (Atenção visual|Resposta emocional|Memorabilidade|Engajamento social) \| (\d+)/100")
VIRAL_RE = re.compile(r"Viral Score: (\d+)/100")
SHORTCODE_RE = re.compile(r"-([A-Za-z0-9_-]{6,15})-\d+\.\d+x")  # captura shortCode no stem


def parse_brain_report(p: Path) -> dict | None:
    text = p.read_text(encoding="utf-8")
    scores = {}
    for m in SCORE_RE.finditer(text):
        label, val = m.group(1), int(m.group(2))
        key = {
            "Atenção visual": "visual",
            "Resposta emocional": "emotion",
            "Memorabilidade": "memory",
            "Engajamento social": "social",
        }[label]
        scores[key] = val
    viral_m = VIRAL_RE.search(text)
    if not viral_m or len(scores) != 4:
        return None
    scores["viral"] = int(viral_m.group(1))
    # Tenta extrair shortCode do nome do arquivo
    sc_m = SHORTCODE_RE.search(p.name)
    scores["shortCode"] = sc_m.group(1) if sc_m else None
    scores["report"] = p.name
    return scores


# ── Build feature matrix ─────────────────────────────────────────────────────

def build_dataset() -> tuple[np.ndarray, np.ndarray, list[str], list[dict]]:
    analysis_dir = find_latest_analysis_dir()
    raw = json.loads((analysis_dir / "raw-posts.json").read_text())
    posts_by_sc = {p.get("shortCode"): p for p in raw if p.get("shortCode")}

    # Lê todos os brain-scores
    reports = sorted(BRAIN_OUT.glob("*-analysis.md"))
    print(f"📊 {len(reports)} brain-score reports encontrados")

    rows = []
    for r in reports:
        score = parse_brain_report(r)
        if not score:
            continue
        sc = score["shortCode"]
        if not sc or sc not in posts_by_sc:
            continue
        post = posts_by_sc[sc]

        # Features textuais simples
        caption = post.get("caption", "") or ""
        first_line = caption.split("\n")[0]

        rows.append({
            "shortCode": sc,
            "brand": post["brand"],
            "format": post["format"],
            "vsMedian": post["vsMedian"],
            "isViral": post.get("isViral", False),
            # TRIBE features
            "visual": score["visual"],
            "emotion": score["emotion"],
            "memory": score["memory"],
            "social": score["social"],
            # Textual features
            "caption_len": min(len(caption), 2000),  # truncado pra estabilidade
            "first_line_len": min(len(first_line), 200),
            "hashtag_count": caption.count("#"),
            "has_question": int("?" in first_line),
            "has_number": int(bool(re.search(r"\d", first_line))),
            "has_emoji": int(bool(re.search(r"[\U0001F300-\U0001FAFF\u2600-\u27BF]", first_line))),
        })

    if not rows:
        raise RuntimeError("Nenhum post com brain-score + raw-post correspondente")

    print(f"✅ {len(rows)} samples com features completas")

    # One-hot encoding manual de format e brand
    formats = ["image", "carousel", "reel"]
    brands = ["Superpower", "Mito Health", "Function Health"]

    feature_names = [
        "tribe_visual", "tribe_emotion", "tribe_memory", "tribe_social",
        "caption_len", "first_line_len", "hashtag_count",
        "has_question", "has_number", "has_emoji",
        *[f"format_{f}" for f in formats],
        *[f"brand_{b.lower().replace(' ', '_')}" for b in brands],
    ]

    X = []
    y = []
    meta = []
    for r in rows:
        row = [
            r["visual"], r["emotion"], r["memory"], r["social"],
            r["caption_len"], r["first_line_len"], r["hashtag_count"],
            r["has_question"], r["has_number"], r["has_emoji"],
        ]
        for f in formats:
            row.append(int(r["format"] == f))
        for b in brands:
            row.append(int(r["brand"] == b))
        X.append(row)
        # Target: log(vsMedian) pra normalizar a cauda longa
        y.append(np.log1p(r["vsMedian"]))
        meta.append(r)

    return np.array(X), np.array(y), feature_names, meta


# ── Train ────────────────────────────────────────────────────────────────────

def train_and_report(X: np.ndarray, y: np.ndarray, feature_names: list[str], meta: list[dict]):
    n, d = X.shape
    print(f"\n🔬 Dataset: {n} samples × {d} features")

    if n < 20:
        print(f"⚠️  Apenas {n} samples — modelo pode ser instável (CV menos confiável)")

    scaler = StandardScaler()
    Xs = scaler.fit_transform(X)

    # RidgeCV escolhe alpha via leave-one-out interno
    alphas = [0.01, 0.1, 1.0, 10.0, 100.0]
    cv_n = min(5, n // 4) if n >= 12 else 3

    ridge_cv = RidgeCV(alphas=alphas, cv=cv_n, scoring="r2")
    ridge_cv.fit(Xs, y)
    print(f"  Best alpha: {ridge_cv.alpha_}")

    # Cross-val score (avalia generalização)
    kf = KFold(n_splits=cv_n, shuffle=True, random_state=42)
    cv_scores = cross_val_score(
        Ridge(alpha=ridge_cv.alpha_), Xs, y, cv=kf, scoring="r2"
    )
    print(f"  CV R² ({cv_n}-fold): {cv_scores.mean():.3f} ± {cv_scores.std():.3f}")

    # Fit final em todo o dataset
    ridge = Ridge(alpha=ridge_cv.alpha_)
    ridge.fit(Xs, y)
    y_pred = ridge.predict(Xs)
    r2_train = r2_score(y, y_pred)
    print(f"  Train R² (in-sample): {r2_train:.3f}")

    # Feature importance: |coef| × std(feature)
    importance = np.abs(ridge.coef_) * Xs.std(axis=0)
    importance = importance / (importance.sum() + 1e-8)

    ranked = sorted(zip(feature_names, ridge.coef_, importance), key=lambda x: -x[2])

    # ── Markdown report ──────────────────────────────────────────────────────
    lines = [
        "# Calibration Report — TRIBE v2 + Features → vsMedian",
        "",
        f"> Gerado em {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "",
        "## Dataset",
        f"- **Samples:** {n}",
        f"- **Features:** {d}",
        f"- **Target:** log1p(vsMedian) — log da razão de engajamento vs. mediana da marca",
        "",
        "## Modelo",
        f"- **Tipo:** Ridge regression (regularização L2)",
        f"- **Alpha (regularização):** {ridge_cv.alpha_}",
        f"- **CV R² ({cv_n}-fold):** {cv_scores.mean():.3f} ± {cv_scores.std():.3f}",
        f"- **Train R² (in-sample):** {r2_train:.3f}",
        "",
        "### Interpretação do R²",
    ]
    cvr2 = cv_scores.mean()
    if cvr2 > 0.4:
        lines.append("✅ **R² > 0.4** — features (TRIBE + textuais) explicam parte real da variância. Modelo útil pra calibrar score.")
    elif cvr2 > 0.15:
        lines.append("⚠️  **R² moderado** — sinal real mas com muito ruído. Use o score calibrado como tiebreak, não como veredito.")
    elif cvr2 > 0:
        lines.append("⚠️  **R² baixo** — features capturam pouco. Considera adicionar features de hook (classificação semântica via Claude).")
    else:
        lines.append("🔴 **R² ≤ 0** — features atuais não explicam vsMedian. TRIBE não é predictor útil pra IG; descartar e usar só features textuais/semânticas.")

    lines += [
        "",
        "## Feature importance (normalizada)",
        "",
        "| Feature | Coef (std) | Importance |",
        "|---------|-----------:|-----------:|",
    ]
    for name, coef, imp in ranked:
        lines.append(f"| {name} | {coef:+.3f} | {imp*100:.1f}% |")

    # Soma TRIBE
    tribe_imp = sum(imp for n, _, imp in ranked if n.startswith("tribe_"))
    text_imp = sum(imp for n, _, imp in ranked if n in ["caption_len", "first_line_len", "hashtag_count", "has_question", "has_number", "has_emoji"])
    cat_imp = sum(imp for n, _, imp in ranked if n.startswith("format_") or n.startswith("brand_"))

    lines += [
        "",
        "## Importância agregada",
        f"- **TRIBE features (4 ROIs):** {tribe_imp*100:.1f}%",
        f"- **Textuais (caption/hashtag/etc):** {text_imp*100:.1f}%",
        f"- **Categóricas (format/brand):** {cat_imp*100:.1f}%",
        "",
    ]
    if tribe_imp < 0.15:
        lines.append("⚠️  TRIBE responde por <15% da importância. Sinal de que features visuais neurais não capturam IG virality bem — confirma intuição inicial.")
    else:
        lines.append(f"✅ TRIBE responde por {tribe_imp*100:.0f}% da importância. Mantém TRIBE no pipeline.")

    lines += [
        "",
        "## Próximos passos",
        "1. **Substituir** os pesos hardcoded `0.30/0.30/0.20/0.20` em `viral-optimizer.py` pelos coefs Ridge das 4 features TRIBE (escalados).",
        "2. **Adicionar features textuais** ao optimizer pra usar o modelo full.",
        "3. **Re-rodar** com mais samples conforme novos posts forem publicados.",
        "",
        "---",
        "*Pesos exatos em `weights.json` na mesma pasta.*",
    ]

    out_md = CAL_OUT / "calibration-report.md"
    out_md.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n📄 Relatório: {out_md}")

    # ── weights.json ────────────────────────────────────────────────────────
    weights = {
        "model": "Ridge",
        "alpha": float(ridge_cv.alpha_),
        "cv_r2_mean": float(cv_scores.mean()),
        "cv_r2_std": float(cv_scores.std()),
        "train_r2": float(r2_train),
        "n_samples": int(n),
        "feature_means": scaler.mean_.tolist(),
        "feature_stds": scaler.scale_.tolist(),
        "coefficients": {name: float(c) for name, c, _ in zip(feature_names, ridge.coef_, importance)},
        "intercept": float(ridge.intercept_),
        "feature_names": feature_names,
        "tribe_weights": {
            "visual": float(ridge.coef_[0]),
            "emotion": float(ridge.coef_[1]),
            "memory": float(ridge.coef_[2]),
            "social": float(ridge.coef_[3]),
        },
        "generated_at": datetime.now().isoformat(),
    }
    out_json = CAL_OUT / "weights.json"
    out_json.write_text(json.dumps(weights, indent=2), encoding="utf-8")
    print(f"📄 Pesos:     {out_json}")


def main():
    print("🔬 Calibration — TRIBE v2 + features → vsMedian")
    print("─" * 50)
    X, y, feature_names, meta = build_dataset()
    train_and_report(X, y, feature_names, meta)


if __name__ == "__main__":
    main()
