# Reproducible stacks

All indices are ideal **constant** values, not wavelength-dependent material measurements. Layers appear in incident-to-substrate order. These files can be loaded into the browser or passed directly to `--stack`.

The README figure uses [computed power samples](../docs/spectra.json) from 350–850 nm in 1 nm steps, at normal incidence with `s` polarization. Its curves have not been normalized by their maxima.

| File                             | Stack                                         | Reference at 550 nm, normal incidence |
| -------------------------------- | --------------------------------------------- | ------------------------------------- |
| [interface.json](interface.json) | Index 1 → 1.5, no layers                      | R = 0.04, T = 0.96                    |
| [ar.json](ar.json)               | Matched quarter-wave AR, n = √1.5             | R ≈ 0, T = 1                          |
| [bragg.json](bragg.json)         | Eight quarter-wave high/low pairs, 2.1 / 1.45 | R = 0.9929074271                      |
| [absorber.json](absorber.json)   | 300 nm film, index 2 + 0.5i                   | A = 0.8369531095                      |

```sh
node bin/thinfilm.js spectrum --stack examples/bragg.json --out out-bragg
node bin/thinfilm.js angle --stack examples/interface.json --polarization p --out out-brewster
```

The interface angle scan shows Brewster reflection at `atan(1.5) ≈ 56.31°`. For total internal reflection, swap the boundary indices to incident 1.5 and substrate 1; the critical angle is `asin(1/1.5) ≈ 41.81°`.

`curve.csv` stores raw R/T/A and complex amplitudes. Unpolarized amplitudes are blank because an incoherent mixture has no single complex coefficient. `result.json` retains separate `s`/`p` components.
