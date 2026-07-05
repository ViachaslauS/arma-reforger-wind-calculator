# Arma Reforger Wind Correction

Wind correction helper for Arma Reforger sniper scopes (PSO-1 and ART II).

Open `index.html` in a browser (double-click or drag into a tab). No build step or server required.

---

# Technical Notes — Version 1.0 (Experimental)

This document summarizes the mathematical model derived experimentally from Arma Reforger. It is **not based on game files** and does **not represent official Bohemia Interactive documentation**.

All constants below were verified through repeated in-game testing.

## 1. Wind Correction

### 1.1 Relative wind angle

```
RelativeAngle = TargetAzimuth − WindDirection
```

Both values are measured in degrees.

### 1.2 Crosswind component

```
Crosswind = WindSpeed × sin(RelativeAngle)
```

WindSpeed and Crosswind are in m/s.

- Positive value → wind pushes the bullet to the **left**
- Negative value → wind pushes the bullet to the **right**

Only the crosswind component affects horizontal drift.

| Relative angle | Crosswind         |
| -------------- | ----------------- |
| 90°            | WindSpeed         |
| 45°            | WindSpeed × 0.707 |
| 0°             | 0                 |

### 1.3 Bullet drift

```
Hold(mrad) = Distance × Crosswind / 1400
```

Distance is measured in meters.

The constant **1400** is empirical. It was obtained by firing test shots with the SVD and M21. At the moment it appears universal for every tested rifle.

### 1.4 Examples

Full crosswind:

```
Distance = 600 m, Wind = 10 m/s

Hold = 600 × 10 / 1400 = 4.29 mrad
```

Wind from 45°:

```
Crosswind = 10 × sin(45°) = 7.07 m/s

Hold = 600 × 7.07 / 1400 = 3.03 mrad
```

## 2. PSO-1 Reticle

The PSO reticle is straightforward:

```
1 horizontal division = 1 mrad
```

Therefore the hold in mrad equals the number of PSO divisions.

Example: 3.2 mrad → hold 3.2 divisions.

## 3. ART II Reticle

The ART II reticle changes angular size with magnification. Every measured element follows

```
AngularSize = Constant / Zoom
```

where Zoom is the optical magnification.

### 3.1 Center → dot

```
DotValue(mrad) = 7.5 / Zoom
```

| Zoom | Dot value |
| ---- | --------- |
| 3×   | 2.50 mrad |
| 4×   | 1.88 mrad |
| 4.5× | 1.67 mrad |
| 5×   | 1.50 mrad |
| 6×   | 1.25 mrad |
| 7×   | 1.07 mrad |
| 8×   | 0.94 mrad |
| 9×   | 0.83 mrad |

Confirmed experimentally.

### 3.2 Center → inner edge of thick horizontal bar

```
InnerBar(mrad) = 40.5 / Zoom
```

| Zoom | Distance  |
| ---- | --------- |
| 3×   | 13.5 mrad |
| 4.5× | 9.0 mrad  |
| 9×   | 4.5 mrad  |

Confirmed experimentally.

### 3.3 Center → top of lower thick post

```
LowerPost(mrad) = 45 / Zoom
```

| Zoom | Distance   |
| ---- | ---------- |
| 4×   | 11.25 mrad |
| 8×   | 5.63 mrad  |
| 9×   | 5.00 mrad  |

Confirmed experimentally.

## 4. Holding with ART II

The required hold expressed in "dot distances" is

```
DotHold = Hold(mrad) / DotValue(mrad) = Hold × Zoom / 7.5
```

Example:

```
Hold = 2.0 mrad, Zoom = 6×

DotValue = 7.5 / 6 = 1.25 mrad

DotHold = 2 / 1.25 = 1.60
```

Aim **1.6 dot distances** into the wind.

## 5. Choosing Optimal Zoom

For the cleanest aiming picture, choose the **highest magnification** for which

```
DotHold ≤ 1
```

This keeps the hold inside the first reference dot while maximizing precision.

If `DotHold > 1`, reduce magnification until the hold fits within the first dot distance.

## 6. ART II Rangefinding

The original ART II concept uses magnification as a rangefinder. Adjust magnification until an average-height soldier exactly fits between the thick horizontal bars. Approximate range:

```
Distance (m) ≈ Zoom × 100
```

Examples: 4.5× ≈ 450 m, 6× ≈ 600 m.

This behavior matches the original Leatherwood ART II operating principle and appears to be implemented in Arma Reforger.

## 7. Summary of Confirmed Formulas

Wind:

```
RelativeAngle = TargetAzimuth − WindDirection

Crosswind = WindSpeed × sin(RelativeAngle)

Hold(mrad) = Distance × Crosswind / 1400
```

PSO-1:

```
1 division = 1 mrad
```

ART II:

```
DotValue  = 7.5 / Zoom

InnerBar  = 40.5 / Zoom

LowerPost = 45 / Zoom

DotHold   = Hold × Zoom / 7.5
```

## 8. Experimental Status

| Formula                            | Status                                                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crosswind                          | ✅ Confirmed                                                                                                                                          |
| 1400 coefficient                   | ✅ Confirmed                                                                                                                                          |
| PSO 1 division = 1 mrad            | ✅ Confirmed                                                                                                                                          |
| ART II dot value                   | ✅ Confirmed                                                                                                                                          |
| ART II inner bar position          | ✅ Confirmed                                                                                                                                          |
| ART II lower post position         | ✅ Confirmed                                                                                                                                          |
| ART II rangefinding (`Zoom × 100`) | ⚠ Matches the original ART II design and appears consistent with in-game behavior, but has not yet been fully validated experimentally in Reforger. |
