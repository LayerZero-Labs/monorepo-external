//! Mollusk BPF tests for the Triangle shapes program.
//!
//! Positive tests (happy-path):
//!   - `initialize`          — creates ShapeState with correct dimensions
//!   - `get_name`            — view: returns "Triangle"
//!   - `get_dimension`       — view: returns width (index 0) and height (index 1)
//!   - `clear`               — zeros both dimensions
//!   - `compute_area`        — override: w * h / 2 with verifier signer (ExtComputeArea)
//!   - `compute_perimeter`   — override: w + w + h (isoceles triangle)
//!   - `scale`               — override: isoceles — only height scales, base stays fixed
//!   - `reset`               — default: sets both dimensions to 1
//!   - `get_dimension_count` — default: always returns 2
//!
//! Negative tests (rejection):
//!   - `initialize`          — double-init rejected
//!   - `get_dimension`       — out-of-bounds index rejected

#[path = "triangle/helpers.rs"]
mod helpers;
#[path = "triangle/negative.rs"]
mod negative;
#[path = "triangle/positive.rs"]
mod positive;
