# The model behind Wavebench

Wavebench calculates scalar Fraunhofer diffraction in the focal plane of an ideal
thin lens. It is intended for exploring patterns and checking simple optical
intuition. Its display is not an absolute irradiance calculation.

## Complex aperture and focal-plane field

Let the field immediately after the aperture be

```text
U₀(x, y) = A(x, y) exp[i φ(x, y)]
```

`A` is the amplitude transmission and `φ` is the phase in radians. Ordinary slit
and hole presets use an amplitude mask with uniform phase. The vortex uses a
circular opening with `φ = ℓ atan2(y, x)`, where `ℓ` is its integer charge.
Custom drawing edits an amplitude mask.

For wavelength `λ`, focal length `f`, and focal-plane position `(X, Y)`, the field
is proportional to the Fourier transform of the aperture:

```text
U_f(X, Y) ∝ ∬ U₀(x, y) exp[-i 2π (x X + y Y) / (λ f)] dx dy
I(X, Y) ∝ |U_f(X, Y)|²
```

The omitted prefactor and focal-plane phase do not change the normalized
intensity pattern. An ideal lens produces this Fourier relation at its focal
plane under the scalar, paraxial assumptions. The same pattern describes free
propagation in the far field when the Fraunhofer approximation is valid; an
arbitrary nearby observation plane requires another propagation model.

## Grid and physical coordinates

The default aperture window has width `L = 8 mm` and contains `N = 512` samples
per axis. The computation uses a 2D discrete Fourier transform, centered for
display. The sample pitches are

```text
aperture:   Δx = L / N
frequency:  Δν = 1 / L
focal plane: ΔX = λ f / L
```

At the default grid, the aperture pitch is `15.625 μm`. The initial light and
lens settings are `λ = 532 nm` and `f = 500 mm`, giving a focal-plane pitch of
`33.25 μm` and a sampled width of `N λ f / L = 17.024 mm`. A wavelength or
focal-length change therefore changes the physical distance assigned to each
output sample.

The displayed field starts at 4 mm across. The 2, 4, 8, and 16 mm view options
resample or crop the FFT output in physical coordinates. A requested field is
clamped to the available sample range. More screen pixels do not add optical
resolution; they interpolate the computed samples. The central section and CSV
use the displayed physical field.

These equations use SI units: convert nanometers and millimeters to meters
before multiplying. The UI may display distances in millimeters for readability.

## Normalization and display

Each computed intensity array is divided by its own maximum:

```text
I_normalized = I / max(I)
```

An empty aperture has zero intensity everywhere. Peak normalization preserves
the relative structure of a pattern but removes information needed to compare
absolute brightness or transmitted power between experiments.

Linear and logarithmic display alter the color mapping, not the underlying
calculation. The logarithmic view brings out weak side lobes. CSV export contains
the normalized central intensity section rather than color-mapped pixel values.

The center section is a horizontal cut through the optical axis. A single cut
can miss off-axis features in an asymmetric or custom aperture; read it alongside
the 2D image.

## Useful analytical checks

For the following expressions, `sinc(t) = sin(t) / t` with `sinc(0) = 1`, `a` is
slit width, `d` is center-to-center slit spacing, and `D` is circular diameter.
These are ideal continuous-aperture results; the sampled model approximates them.

| Aperture | Expected behavior along the relevant axis |
| --- | --- |
| Single slit | `I(X) ∝ sinc²(π a X / (λ f))`; first minima at `X = ±λ f / a` |
| Two equal slits | Single-slit envelope times `cos²(π d X / (λ f))`; fringe spacing `λ f / d` |
| M equal slits | Single-slit envelope times `[sin(Mβ) / sin(β)]²`, `β = π d X / (λ f)`; narrower principal peaks as M increases |
| Circular opening | `I(r) ∝ [2 J₁(q) / q]²`, `q = π D r / (λ f)`; first dark ring at `r ≈ 1.22 λ f / D` |
| Annular opening | Subtract the inner disk's complex field from the outer disk's before taking the squared magnitude |
| Integer vortex | Nonzero charge cancels the on-axis field for an ideal centered circular opening; discrete sampling leaves numerical residuals |

At a grating maximum, the ratio with a zero denominator is interpreted by its
limit, giving `M²` before normalization.

Finite-height slits also have a vertical diffraction envelope. Increasing slit
separation changes fringe spacing; changing slit width changes the envelope.
Those are separate effects.

## Sampling limits

- **Finite window:** an aperture clipped at the window edge represents a
  different opening. Keep the intended geometry inside the computational window.
- **Finite pitch:** boundaries are rasterized. Features only a few pixels wide,
  thin rings, or rapidly varying phase can be inaccurate. A slider value need
  not change the sampled mask until an edge crosses a sample.
- **Finite output range:** only the sampled focal-plane window is shown. Fine
  aperture structure can diffract light beyond that range.
- **Sharp boundaries:** FFT sampling can produce artifacts near hard edges and
  very weak lobes. A log display makes these more visible.
- **Vortex center:** phase is singular at the origin. The value assigned to the
  center sample has no continuous-area significance, but can affect discrete
  residuals.

The app does not model vector electromagnetic fields, polarization, coherence
between different wavelengths, lens aberrations, material dispersion, detector
response, or near-field Fresnel propagation. White-light photographs are not
directly comparable to a single-wavelength result.
