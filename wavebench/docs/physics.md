# Scalar propagation model

Wavebench propagates a sampled complex monochromatic field. It provides two
free-space models and one ideal-lens focal-field model. Equations below use the
`exp(-i ωt)` convention and a forward Fourier transform with a negative exponent.
Use consistent length units; the implementation converts wavelength from nm to mm.

## Input field and Gaussian convention

For aperture transmission `T(x,y)`, phase `φ(x,y)`, and illumination `G(x,y)`:

```text
U₀(x,y) = G(x,y) T(x,y) exp[i φ(x,y)]
```

Plane illumination is `G = 1`. Gaussian illumination is
`G = exp[-(x²+y²)/w₀²]`. Thus `w₀` is the 1/e amplitude radius and 1/e² intensity
radius. `beamWaistMm = 0` selects plane illumination for aperture presets.
The `gaussian` source uses the Gaussian field directly with a flat initial
wavefront and no hard aperture. Its waist must be positive.

Slits, holes, and custom masks are amplitude transmissions, not intensity
transmissions. A custom sample of 0.5 transmits an intensity fraction of 0.25
under unit incident amplitude. Vortex phase is `φ = ℓ atan2(y,x)` within a circular
opening. Slit boundaries use cell coverage; circular and vortex boundaries use
subpixel quadrature. These approximations reduce edge artifacts but do not add
independent samples.

## Fresnel transfer function

The paraxial free-space envelope at distance `z` is

```text
U_z = F⁻¹{ F{U₀} H_F }
H_F(fx,fy) = exp[-i π λ z (fx²+fy²)]
```

The uniform carrier `exp(i k z)`, with `k = 2π/λ`, is omitted. This model
approximates the longitudinal wave number by
`kz ≈ k - (kx²+ky²)/(2k)`. It is suitable when the occupied spatial spectrum is
paraxial. Increasing distance can accumulate phase error even if angles are small.

## Angular spectrum

The angular-spectrum method propagates the scalar plane-wave spectrum:

```text
U_z = F⁻¹{ F{U₀} H_AS }
H_AS = exp{i k z [sqrt(1-λ²(fx²+fy²))-1]}
```

This expression applies to propagating components with
`λ²(fx²+fy²) ≤ 1`. It removes the same carrier as the Fresnel model. The square-root
difference is evaluated with a rationalized expression to avoid cancellation
near the optical axis.

For evanescent components and forward propagation, the amplitude decays as
`exp[-k z sqrt(λ²(fx²+fy²)-1)]`, with the relative carrier phase retained. Backward
propagation suppresses evanescent components rather than exponentially amplifying
them. At zero distance the low-level API returns the input field unchanged.
The supported browser/CLI distances are positive.

Angular spectrum retains nonparaxial scalar dispersion. It does not supply
polarization, vector boundary conditions, or a Maxwell solution. With the
instrument's millimeter window and visible wavelengths, the grid usually cannot
represent the very high spatial frequencies needed for evanescent physics.

## Ideal-lens Fraunhofer field

At the focal plane of an ideal lens, the returned scaled Fourier field is

```text
U_f(X,Y) = (Δx² / (λ f)) Σ U₀(x,y) exp[-i 2π (x X + y Y)/(λ f)]
I(X,Y) = |U_f(X,Y)|²
```

The output coordinates map Fourier frequencies to `X = λ f fx`, `Y = λ f fy`.
The global propagation carrier, constant phase factor, and output quadratic phase
are omitted. Read its phase as the phase of this Fourier representation, not as a
complete laboratory wavefront. The intensity includes the Fourier
integration/scaling factor; it is not merely the squared magnitude of an unscaled
FFT.

This optical configuration uses `focalLengthMm` and ignores `distanceMm`. Fresnel
and angular spectrum use `distanceMm` and do not insert a lens. Directly comparing
their arrays at equal numerical distances compares different optical systems
unless the corresponding lens phase and geometry are supplied explicitly.

## Sampling, coordinates, and power

For input-window width `L` and `N` samples per axis:

```text
input pitch:       Δx = L/N
frequency pitch:   Δfx = 1/L
Fresnel / AS:      ΔX = Δx
lens focal field:  ΔX = λ f/L
coordinate:       X_j = (j-N/2) ΔX
```

Arrays are row-major: index `y*N+x`, with the origin at `(N/2,N/2)`.
For the default `L = 8 mm`, `N = 512`, the input pitch is `15.625 μm`.
At `λ = 532 nm`, `f = 500 mm`, the focal-plane pitch is `33.25 μm` and its periodic
sampled extent is `17.024 mm`. Its last positive coordinate is one pitch short
of half that extent.

Native output arrays retain raw relative irradiance `I = |U|²`. The app also
returns `I/max(I)` for shape comparison. A zero field remains zero. The relative
integrated power is the sum of raw irradiance times the relevant pixel area.
It has units of relative amplitude squared × mm², not watts. Source amplitude,
physical calibration, and detector response are unspecified.
This scalar field norm is not a complete electromagnetic flux measurement for
high-angle or evanescent fields.

For unit-modulus free-space transfer functions, discrete power is conserved by
Parseval's theorem. Propagating evanescent terms may reduce power. With the scaled
lens field and the mapped output pitch, the same discrete integral is conserved.
Conservation alone does not establish that the spatial pattern is accurate.

Phase is `atan2(imag,real)` in radians. It is undefined physically where amplitude
is zero; the array uses a finite numerical value there. Linear/log display changes
color mapping only. Cropping or interpolating the preview does not change the
full native-grid CSV; a section export can select native samples within its span.

## Distance scans

Each scan propagates the same input field directly to each distance, rather than
repeatedly propagating a previous output. Free-space methods retain one output
pitch, so a central horizontal cut at `y=0` can form an `x`–`z` heatmap.
The default scan has 21 uniformly spaced planes. A central cut can miss off-axis
structure; use full-plane simulations where that matters.

The browser heatmap and browser sweep CSV use one peak over **all sampled
central-section rows**. The CSV column is `global_normalized_intensity`;
changes in relative peak irradiance remain visible. Its log display spans eight
decades. This peak can differ from a maximum over the full 2D planes when the
brightest features lie off the central cut.

The CLI's `scan.csv` instead exports `normalized_intensity`, divided by each
plane's full-grid peak. Those per-plane normalized values remove changes in
peak irradiance. Both CSV formats preserve raw `intensity` for comparisons
between distances. See [reference.md](reference.md) for their separate schemas.

For a paraxial Gaussian waist:

```text
z_R = π w₀²/λ
w(z) = w₀ sqrt[1+(z/z_R)²]
```

This relation provides a quantitative test of beam spreading. A peak-normalized
picture alone cannot test the drop in peak irradiance, so check raw field values
or second moments as well.

## Diagnostics and numerical limits

Free-space FFT propagation assumes a periodic field on a finite square window.
There is no automatic absorbing boundary or infinite-domain guarantee. Light
reaching an edge can wrap around. Increasing `N` at fixed `L` improves sampling
but does not move the boundary farther away.

The implemented diagnostics use these thresholds:

| Code                                        | Trigger                                                                                                                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source-undersampled`                       | A known source feature spans fewer than 6 input samples: Gaussian waist, slit width/height, circle/vortex diameter, or annular radial thickness `(outer-inner)/2` |
| `transfer-undersampled`                     | Unwrapped transfer phase changes by more than π between adjacent frequency bins near significant input modes                                                      |
| `paraxial-angle`                            | Significant modes reach `λ sqrt(fx²+fy²) > 0.1` in Fresnel, or the analogous coordinate/focal-length ratio in the lens model                                      |
| `border-energy`                             | More than 1% of the intensity integral occupies the outer 5% of grid width; checks input/output for free space, input only for the lens model                     |
| `evanescent-decay` / `evanescent-truncated` | More than `10⁻¹⁰` of the spectral norm is evanescent in forward/backward angular-spectrum propagation                                                             |

Significant modes have spectral intensity at least `10⁻⁶` of the peak. These are
risk estimates, not error bounds or convergence certificates. The source-feature
check belongs to `simulateExperiment`; the arbitrary-field `propagateField` API
has no aperture geometry metadata. It does not infer structure inside custom
masks or resolve vortex phase features; absence of a warning does not establish
convergence. An intentionally
periodic plane wave can trigger the border warning without an error. A dark edge
at the final plane can still follow an earlier wrap event; scans and larger-window
calculations can help diagnose it.

The instrument fixes the input window at 8 mm; the low-level propagation API can
use another positive window width. For convergence checks, hold the physical
source fixed while changing the grid and window separately. Verify that the
source is resolved, significant output remains away from the boundary, and the
observables converge.

Other limitations include aperture clipping, cell-averaged boundary errors,
underresolved phase, transfer-function aliasing, and the monochromatic scalar
assumption. The model omits lens aberrations, material dispersion, partial
coherence, multiple wavelengths, and detector response.

## Validation evidence

Numerical checks in `tests/` target independently known behavior:

| Check                               | Reference or invariant                                  |
| ----------------------------------- | ------------------------------------------------------- |
| FFT impulse, frequency bin, inverse | DFT convention and reconstruction                       |
| Parseval                            | Forward FFT energy divided by `N²` equals input energy  |
| Single slit                         | `sinc²(π a X/(λ f))`, first zero `λ f/a`                |
| Double slit                         | Single-slit envelope × `cos²(π d X/(λ f))`              |
| Circular aperture                   | Airy first zero `1.22 λ f/D`                            |
| Vortex                              | On-axis cancellation and charge-sign intensity symmetry |
| Free-space identity                 | `z=0` preserves complex samples                         |
| FFT-bin plane wave                  | Analytical Fresnel / angular-spectrum phase factor      |
| Free-space power                    | Discrete integral conservation for propagating spectra  |
| Gaussian beam                       | Analytical width evolution and relative peak behavior   |
| Paraxial comparison                 | Fresnel and angular-spectrum fields approach agreement  |

Quantitative propagation cases are specified in the tests:

- Fresnel Gaussian: `N=256`, `L=4 mm`, `λ=532 nm`, `w₀=0.2 mm`, `z=350 mm`.
  Beam width and on-axis irradiance must agree with Gaussian-beam theory to
  `10⁻⁷` relative tolerance; power uses `10⁻¹¹` relative tolerance.
- Fresnel/AS comparison: the same source and grid at `z=150 mm`. The relative
  complex-field RMS difference must be below `5×10⁻⁶`.
- CLI Gaussian scan: `w₀=0.2 mm`, `λ=532 nm`, at `z=10,255,500 mm`. The central-row
  RMS width must match `w(z)/2` to `10⁻⁵ mm`; exported field integration is also
  checked against the manifest's power.

Tests establish these cases on their stated grids and tolerances. They do not
validate every parameter combination or certify optical design accuracy. See
[reference.md](reference.md) for API and file conventions.
