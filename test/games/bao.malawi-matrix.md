# Bao Malawi (Bawo) — test matrix

Authorities (implementation references only):

1. [Bao (Malawi) — Game Cabinet / Mark Chikoko](http://www.gamecabinet.com/rules/Bao2.html)
2. [Bawo — Mancala World](https://mancala.fandom.com/wiki/Bawo)

Automated contracts: `bao.malawi-full.test.ts`. Zanzibar matrix remains `bao.rules.test.ts`.

| Bao2 / Bawo topic | Test describe |
|-------------------|---------------|
| 8 kuu / 20 nemo setup | `setup — Figure 2` |
| Functional kuu at ≥8 seeds | `setup — functional kuu threshold` |
| No namu takata from kuu (except nine-seed) | `namu — no kutakata from kuu` |
| Namu singleton takata only when non-kuu pits ≤1 | `namu — singleton takata` |
| Cannot capture opponent kuu when own kuu threatened | `namu — kuu capture guard` |
| Nine-seed lift from kuu | `namu — nine-seed kuu` |
| Mtaji max 15 for capturing starts | `mtaji — fifteen seed boundary` |
| First stage-2 takata from unmoved kuu | `mtaji — first takata from kuu` |
| Lone end-kichwa takata across outer row → loss | `mtaji — lone end-hole loss` |

`malawi` (setup only) uses 8/20 with Zanzibar rules; covered by `setup — functional kuu threshold` with `malawi` variant.
