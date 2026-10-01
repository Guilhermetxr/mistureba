# Design tokens — Sistema Mistureba

Fonte única: `public/css/tokens.css`. Componentes em `public/css/app.css` usam só esses tokens.

- **Fundação**: tokens próprios no estilo Open Props (cor, espaço em escala de 4px, raio, sombra, easing), tipografia fluida com `clamp()` entre 360px e 1440px.
- **Paleta**: papel quente (`--bg #f4f1ec`, `--surface #fdfcfa`), tinta `--ink #1f1c19`, marca "brasa" `--brand #d4481f`. Status reservados (`--good`, `--warn`, `--bad`, `--info`) sempre acompanhados de ícone ou rótulo.
- **Tipo**: Manrope (UI) com números tabulares; JetBrains Mono para códigos.
- **Componentes**: próprios, sem biblioteca (botão, campo, card, stat, tabela, badge, abas, segmento, diálogo nativo `<dialog>`, toast).
- **Gráficos**: SVG próprio (`public/js/charts.js`), uma série = uma cor (`--series-1`), grade recessiva, tooltip por barra, linha de meta tracejada. A matriz de engenharia de cardápio usa posição (quadrantes), não cor, para a classificação.
- **Movimento**: só no fim; ≤ 200ms, `--ease-out`, respeita `prefers-reduced-motion`.
- **Acessibilidade**: foco via `box-shadow` (`--focus`), botões só-ícone com `aria-label`, inputs com 16px (sem zoom no iOS), alvos de toque ≥ 38–44px.
