use anchor_lang::prelude::*;

declare_id!("Tri1111111111111111111111111111111111111111");

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
// Override:   compute_area (EXTEND — adds verifier signer to default accounts)
// Override:   compute_perimeter (reuses StdComputePerimeter, isoceles triangle)
// Override:   scale (reuses StdScale, isoceles: only scale height)
// Default:    reset, get_dimension_count

#[shapes_macros::shapes]
pub mod shapes_triangle {

    #[shapes_instruction]
    pub fn initialize(ctx: &mut Context<Initialize>, params: &InitParams) -> Result<()> {
        ctx.accounts.shape.width = params.width;
        ctx.accounts.shape.height = params.height;
        ctx.accounts.shape.bump = ctx.bumps.shape;
        Ok(())
    }

    #[shapes_instruction]
    pub fn get_name(_ctx: &Context<GetName>) -> Result<String> {
        Ok("Triangle".to_string())
    }

    #[shapes_instruction]
    pub fn get_dimension(ctx: &Context<GetDimension>, params: &DimensionParams) -> Result<u64> {
        let s = &ctx.accounts.shape;
        match params.index {
            0 => Ok(s.width),
            1 => Ok(s.height),
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

    #[shapes_instruction]
    pub fn compute_area(ctx: &Context<ExtComputeArea>, _params: &ComputeParams) -> Result<u64> {
        msg!("Verified by: {}", ctx.accounts.verifier.key());
        let s = &ctx.accounts.shape;
        Ok(s.width * s.height / 2)
    }

    // OVERRIDE — reuses StdComputePerimeter accounts, isoceles triangle.
    #[shapes_instruction]
    pub fn compute_perimeter(
        ctx: &Context<StdComputePerimeter>,
        _params: &ComputeParams,
    ) -> Result<u64> {
        let s = &ctx.accounts.shape;
        Ok(s.width + s.width + s.height)
    }

    // OVERRIDE — reuses StdScale accounts, isoceles: only scale height (base stays fixed).
    #[shapes_instruction]
    pub fn scale(ctx: &mut Context<StdScale>, params: &ScaleParams) -> Result<()> {
        ctx.accounts.shape.height = ctx.accounts.shape.height.saturating_mul(params.factor);
        Ok(())
    }

    // DEFAULT — get_dimension_count returns 2, correct for any 2D shape.
    // DEFAULT — reset sets width=1, height=1.
}

// EXTEND — extend StdComputeArea with a verifier signer, inside the module
// so ExtComputeArea can reference ShapeState from the prelude.
shapes_extend_accounts!(compute_area, ExtComputeArea, {
    #[account(mut)]
    pub verifier: Signer<'info>,
});
