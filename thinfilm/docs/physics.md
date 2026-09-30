# Physical and numerical conventions

## Geometry and fields

The stack order is incident medium → layer 1 → … → substrate. Boundary media are semi-infinite and have positive real indices. Each layer is homogeneous, isotropic, passive, and described by a **constant** index `N = n + iκ`, `n > 0`, `κ ≥ 0`. No material dispersion is inferred.

Fields use `exp(-iωt)` and forward propagation `exp(i k_z z)`. Consequently positive `κ` attenuates forward waves. All wavelengths and thicknesses use nm. Incidence angles are in degrees, relative to the interface normal.

The conserved transverse index and longitudinal index are

```text
a   = n_incident sin(θ)
q_j = sqrt(N_j² - a²)
k_z = 2π q_j / λ
```

The square-root branch has `Im(q) ≥ 0` and, for propagating passive modes, `Re(q) ≥ 0`. Small absorptive components are calculated by division rather than subtracting two nearly equal square-root terms, so weak absorption is retained in optically thick layers.

## Interface amplitudes

`r` and `t` are complex **electric-field** amplitude ratios in each local polarization basis. For `s`, the electric field is perpendicular to the incidence plane. For `p`, the standard local electric polarization vectors are used; reflected and incident vectors have opposite tangential orientation. Thus at normal incidence `r_p = -r_s`, while their reflected powers are identical. Mixing these phases with a convention using tangential electric amplitudes requires the corresponding sign change.

At an interface from medium `i` to `j`:

```text
r_s = (q_i - q_j) / (q_i + q_j)
t_s = 2 q_i / (q_i + q_j)

r_p = (N_j² q_i - N_i² q_j) / (N_j² q_i + N_i² q_j)
t_p = 2 N_i N_j q_i / (N_j² q_i + N_i² q_j)
```

Cross products avoid dividing an admittance directly by a zero longitudinal wavevector.

## Stable scattering recursion

For layer `j`, define `p_j = exp(i 2π q_j d_j / λ)`. Its magnitude is at most one. Starting with the last interface, combine the reflection/transmission of the stack to the right with the next interface:

```text
D     = 1 + r_interface r_right p_j²
r_new = (r_interface + r_right p_j²) / D
t_new = t_interface t_right p_j / D
```

This recursion uses no growing `exp(+Im(k_z)d)` term. Extremely attenuated propagation factors underflow safely to zero. It avoids the characteristic-matrix overflow of thick absorbing films. Floating-point resonance conditioning and representability still limit any numerical implementation; nonfinite phases and singular denominators are rejected.

## Power fractions

With real boundary indices and the amplitude convention above:

```text
R = |r|²
T = Re(q_substrate) / q_incident × |t|²
A = 1 - R - T
```

`A` is total absorptance in the entire film stack, not layer-resolved absorption. An evanescent substrate wave has zero **normal transmitted flux**, even when its electric amplitude is nonzero. For passive lossless stacks `R + T = 1`; for absorbing stacks `R + T + A = 1`.

Coefficients are dimensionless flux fractions, not watts. They are not normalized by a scan peak. Roundoff deviations no larger than `10⁻¹⁰` are clamped to the physical `[0,1]` range; larger violations of passive power balance throw an error. Unpolarized illumination is an incoherent equal-power mixture: `R`, `T`, and `A` average the separate `s` and `p` results, while a mean complex `r` or `t` is undefined and returned as `null`.

## Critical angles and supported domain

The incident angle is restricted to 0–85°, keeping the incident normal flux away from the grazing-incidence singularity. At an exact substrate critical angle, `q_substrate = 0`, the interface formulas have a finite limit and `T = 0`; a diagnostic identifies this limit.

A finite internal layer at `q ≈ 0` has coincident forward/backward traveling waves. The implemented scattering-wave decomposition is degenerate there. Such a stack is **explicitly rejected**, not regularized with an arbitrary index loss or returned with NaN. Shift the angle slightly, or use a solver with an analytic zero-`q` layer limit. A zero-thickness layer is removed before this check, since it is physically absent. Squared longitudinal values within 32 machine epsilons of cancellation use the critical limit; internal values within `10⁻¹²` of the index scale are rejected.

The API accepts at most 128 layers and 1–2001 inclusive scan points. One point samples the start coordinate. Unknown fields, nonfinite values, active layers (`κ < 0`), complex boundary indices, and reversed scan ranges are rejected. Boundary indices must be represented as real numbers. Extreme index/phase values outside double-precision representability also fail explicitly.

## Analytic references in the test suite

- Single-interface Fresnel amplitudes and flux at multiple angles.
- `θ_B = atan(n_substrate / n_incident)` for zero `p` reflection.
- Total internal reflection with unit reflected modulus and zero transmitted flux.
- Quarter-wave matched AR index `sqrt(n_incident n_substrate)`, thickness `λ₀/(4n)`, and its independent off-design reflectance formula.
- A normal-incidence high/low quarter-wave Bragg stack with `m` pairs has effective admittance `Y = n_substrate (n_H/n_L)^(2m)` and `R = [(n_incident-Y)/(n_incident+Y)]²` at `λ₀`.
- A sufficiently thick absorbing layer approaches the semi-infinite complex-interface reflectance; weak-index absorption is compared against Beer attenuation.

The model does not solve rough surfaces, anisotropic or magnetic media, dispersion, incoherent substrates, or experimental inverse fitting. Bundled examples use ideal constant indices and are reproducible simulations, not measured spectra.
