# P4.T5 discovery — responsive composition

The plan's breakpoint contract is 390×844, 768×1024, and 1440×1000. The existing canvas is a CSS grid with a desktop `min-width: 1180px` branch; the canonical Thread already owns the document column and the presence rail.

The implementation therefore uses the existing layout seam: desktop side composition at `min-width: 1180px`, document composition below it, and a CSS-only vertical rail for the mobile graph. No `/demo` or backend layout surface is touched.
