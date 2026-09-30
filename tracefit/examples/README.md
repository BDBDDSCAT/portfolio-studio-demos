# Synthetic datasets

These CSV files are generated examples, **not experimental measurements**. Their x column is named `wavelength_nm` for a familiar spectral coordinate; no physical acquisition took place.

All contain 161 samples on `420..720`, independent seeded Gaussian noise with standard deviation `0.012`, and a `sigma_y` column containing that value. The baseline reference is x = 570.

| Dataset | Model | Offset | Slope | Peak amplitudes | Centers | Widths |
| --- | --- | --- | --- | --- | --- | --- |
| `gaussian.csv` | Gaussian | 0.16 | 0.0005 | 1.25 | 545 | 18 |
| `doublet.csv` | Gaussian | 0.10 | 0.0002 | 0.95, 0.72 | 525, 574 | 17, 22 |
| `lorentzian.csv` | Lorentzian | 0.10 | −0.00012 | 1.10 | 563 | 14 |

Gaussian widths are standard deviations. Lorentzian width is HWHM. Fitted estimates differ from these generation parameters because the files include noise.
