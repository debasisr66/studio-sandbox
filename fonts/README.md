# Fonts

Self-hosted so no third party sees a visit and the page does not depend on another site.

| File | Family | Licence |
|------|--------|---------|
| `inter-latin.woff2`, `inter-latin-ext.woff2` | Inter (variable; Latin and Latin Extended subsets) | `LICENSE-Inter.txt` (SIL Open Font Licence 1.1) |
| `jetbrains-mono-latin.woff2`, `jetbrains-mono-latin-ext.woff2` | JetBrains Mono (variable; Latin and Latin Extended subsets) | `LICENSE-JetBrainsMono.txt` (SIL Open Font Licence 1.1) |

The **Latin Extended** files matter: the rupee sign (₹, U+20B9) is in them, and Penny's release notes use it. A Latin-only build changed the width of ₹ (the browser fell back to another font); CI now requires the Inter faces to cover U+20B9. A browser downloads an Extended file only when a page actually uses one of its characters.

Source: the same files Google Fonts served to Studio (Inter v20, JetBrains Mono v24), downloaded unchanged on 2026-10-20 (Latin and Latin Extended; Cyrillic, Greek and Vietnamese are not included and fall back to the system font). The declarations are in `css/site.css`. CI requires a licence file beside every font and keeps each file under 150 KB.

To update a font: download the new `woff2`, replace the file, keep its licence, run `node scripts/validate-site.js`, and compare the page against the previous release (see `docs/build.md` section 13).
