use anchor_lang::prelude::*;

declare_id!("ELp1111111111111111111111111111111111111111");

// --- Account structs ---

#[derive(Accounts)]
#[instruction(params: InitParams)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + ShapeState::INIT_SPACE,
        seeds = [b"shape"],
        bump,
    )]
    pub shape: Account<'info, ShapeState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GetName<'info> {
    pub shape: Account<'info, ShapeState>,
}

/// Custom accounts — ellipse perimeter reads state differently.
#[derive(Accounts)]
pub struct EllipseAccounts<'info> {
    pub shape: Account<'info, ShapeState>,
}

#[derive(Accounts)]
pub struct GetDimension<'info> {
    pub shape: Account<'info, ShapeState>,
}

#[derive(Accounts)]
pub struct Clear<'info> {
    #[account(mut)]
    pub shape: Account<'info, ShapeState>,
}
// --- Param types ---

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct InitParams {
    pub width: u64,
    pub height: u64,
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct ComputeParams {}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct ScaleParams {
    pub factor: u64,
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct DimensionParams {
    pub index: u8,
}

// --- Program module ---
// ShapeState — generated in prelude by #[shapes]
//
// Required:   initialize, get_name, get_dimension, clear
// Override:   compute_area (reuses StdComputeArea, π*w*h/4)
// Override:   compute_perimeter (custom EllipseAccounts)
// Override:   reset (reuses StdReset, restores to unit circle: width=height=10)
// Default:    scale, get_dimension_count

#[shapes_macros::shapes]
pub mod shapes_ellipse {

    #[shapes_instruction]
    pub fn initialize(ctx: &mut Context<Initialize>, params: &InitParams) -> Result<()> {
        // This is a dummy check to ensure the audit macro is working.
        let _ = SHAPES_AUDIT_ENABLED;

        ctx.accounts.shape.width = params.width;
        ctx.accounts.shape.height = params.height;
        ctx.accounts.shape.bump = ctx.bumps.shape;
        Ok(())
    }

    #[shapes_instruction]
    pub fn get_name(_ctx: &Context<GetName>) -> Result<String> {
        Ok("Ellipse".to_string())
    }

    #[shapes_instruction]
    pub fn get_dimension(ctx: &Context<GetDimension>, params: &DimensionParams) -> Result<u64> {
        let s = &ctx.accounts.shape;
        match params.index {
            0 => Ok(s.width),  // semi-axis a
            1 => Ok(s.height), // semi-axis b
            _ => err!(anchor_lang::error::ErrorCode::InvalidProgramId),
        }
    }

    #[shapes_instruction]
    pub fn clear(ctx: &mut Context<Clear>) -> Result<()> {
        let s = &mut ctx.accounts.shape;
        s.width = 0;
        s.height = 0;
        Ok(())
    }

    // OVERRIDE — reuses StdComputeArea accounts, ellipse formula.
    #[shapes_instruction]
    pub fn compute_area(ctx: &Context<StdComputeArea>, _params: &ComputeParams) -> Result<u64> {
        let s = &ctx.accounts.shape;
        // Ellipse area = π * a * b where a=w/2, b=h/2 → π * w * h / 4
        Ok(314_159 * s.width * s.height / 400_000)
    }

    // OVERRIDE — custom EllipseAccounts, ellipse perimeter approximation.
    #[shapes_instruction]
    pub fn compute_perimeter(
        ctx: &Context<EllipseAccounts>,
        _params: &ComputeParams,
    ) -> Result<u64> {
        let s = &ctx.accounts.shape;
        // Simple approximation: π * (w + h) / 2
        Ok(314_159 * (s.width + s.height) / 200_000)
    }

    // OVERRIDE — reuses StdReset, ellipse resets to unit circle (equal axes).
    #[shapes_instruction]
    pub fn reset(ctx: &mut Context<StdReset>) -> Result<()> {
        let s = &mut ctx.accounts.shape;
        s.width = 10;
        s.height = 10;
        Ok(())
    }

    // DEFAULT — get_dimension_count returns 2, correct for any 2D shape.
}
