//! Mollusk BPF tests for the Ellipse shapes program.
//!
//! Positive tests (happy-path):
//!   - `initialize`          — creates ShapeState with correct dimensions
//!   - `get_name`            — view: returns "Ellipse"
//!   - `get_dimension`       — view: returns semi-axis a (index 0) and b (index 1)
//!   - `clear`               — zeros both dimensions
//!   - `compute_area`        — override: π * w * h / 4 (StdComputeArea accounts)
//!   - `compute_perimeter`   — override: π * (w + h) / 2 (custom EllipseAccounts)
//!   - `scale`               — default: scales both axes equally
//!   - `reset`               — override: restores to unit circle (width = height = 10)
//!   - `get_dimension_count` — default: always returns 2
//!
//! Negative tests (rejection):
//!   - `initialize`          — double-init rejected
//!   - `get_dimension`       — out-of-bounds index rejected

#[path = "ellipse/helpers.rs"]
mod helpers;
#[path = "ellipse/negative.rs"]
mod negative;
#[path = "ellipse/positive.rs"]
mod positive;
