use bolt_lang::*;
use anteroom::Anteroom;
use player::Player;
use anchor_spl::token::{TokenAccount, Transfer};

declare_id!("HnT1pk8zrLfQ36LjhGXVdG3UgcHQXQdFxdAWK26bw5bS");

#[error_code]
pub enum SupersizeError {
    #[msg("Not owner of this player.")]
    NotOwner,
    #[msg("Player still in game.")]
    StillInGame,
    #[msg("Invalid game vault.")]
    InvalidGameVault,
    #[msg("Payout account mismatch.")]
    InvalidPayoutAccount,
    #[msg("Invalid pda.")]
    InvalidPda,
    #[msg("Invalid game vault owner.")]
    InvalidGameVaultOwner,
    #[msg("Invalid supersize payout account.")]
    InvalidSupersizeTokenAccount,
    #[msg("Invalid game owner payout account.")]
    InvalidGameOwnerTokenAccount,
    #[msg("Token decimals not set.")]
    MissingTokenDecimals,
    #[msg("Token mint mismatch.")]
    InvalidMint,
    #[msg("Component doesn't belong to map.")]
    MapKeyMismatch,
}

#[system]
pub mod cash_out {

    pub fn execute(ctx: Context<Components>, _args_p: Vec<u8>) -> Result<Components> {

        let authority = *ctx.accounts.authority.key;

        require!(ctx.accounts.player.authority == Some(authority), SupersizeError::NotOwner);
        require!(ctx.accounts.player.map == ctx.accounts.anteroom.map, SupersizeError::MapKeyMismatch);
        require!(ctx.accounts.player.mass == 0, SupersizeError::StillInGame);

        require!(
            ctx.sender_token_account()?.key() == ctx.accounts.player.payout_token_account.expect("Player payout account not set"),
            SupersizeError::InvalidPayoutAccount
        );
        require!(
            ctx.accounts.anteroom.vault_token_account.expect("Vault token account not set") == ctx.vault_token_account()?.key(),
            SupersizeError::InvalidGameVault
        );

        let vault_token_account: TokenAccount = TokenAccount::try_deserialize_unchecked(
            &mut (ctx.vault_token_account()?.to_account_info().data.borrow()).as_ref()
        )?;
        let exit_pid: Pubkey = pubkey!("HnT1pk8zrLfQ36LjhGXVdG3UgcHQXQdFxdAWK26bw5bS"); 
        let map_pubkey = ctx.accounts.anteroom.map.expect("Expected map Pubkey to be Some");
        let token_account_owner_pda_seeds = &[b"token_account_owner_pda", map_pubkey.as_ref()];
        let (derived_token_account_owner_pda, bump) = Pubkey::find_program_address(token_account_owner_pda_seeds, &exit_pid);
        
        require!(
            derived_token_account_owner_pda == ctx.token_account_owner_pda()?.key(),
            SupersizeError::InvalidPda
        );
        require!(
            derived_token_account_owner_pda == vault_token_account.owner,
            SupersizeError::InvalidGameVaultOwner
        );
        require!(
            vault_token_account.mint == ctx.accounts.anteroom.token.expect("Vault mint not set"),
            SupersizeError::InvalidMint
        );

        let supersize_parent_account: Pubkey = pubkey!("DdGB1EpmshJvCq48W1LvB1csrDnC4uataLnQbUVhp6XB");
        let supersize_token_account: TokenAccount = TokenAccount::try_deserialize_unchecked(
            &mut (ctx.supersize_token_account()?.to_account_info().data.borrow()).as_ref()
        )?;
        require!(
            supersize_parent_account == supersize_token_account.owner,
            SupersizeError::InvalidSupersizeTokenAccount
        );
        require!(
            ctx.game_owner_token_account()?.key() == ctx.accounts.anteroom.gamemaster_token_account.expect("Game owner token account not set"),
            SupersizeError::InvalidGameOwnerTokenAccount
        );

        let seeds = &[b"token_account_owner_pda".as_ref(), map_pubkey.as_ref(), &[bump]];
        let pda_signer = &[&seeds[..]];
        
        let decimals = ctx.accounts.anteroom.token_decimals.ok_or(SupersizeError::MissingTokenDecimals)?;
        let scale_factor = 10_u64.pow(decimals);
        let final_score = ctx.accounts.player.score;
        let player_amount = (final_score * 95.0) / 100.0;
        let game_owner_amount = (final_score * 2.0) / 100.0;
        let supersize_amount = (final_score * 3.0) / 100.0;
        let scaled_final_score = (player_amount * scale_factor as f64).round() as u64;  
        let scaled_game_owner_amount = (game_owner_amount * scale_factor as f64).round() as u64;  
        let scaled_supersize_amount = (supersize_amount * scale_factor as f64).round() as u64;  

        let transfer_instruction_player = Transfer {
            from: ctx.vault_token_account()?.to_account_info(),
            to: ctx.sender_token_account()?.to_account_info(),
            authority: ctx.token_account_owner_pda()?.to_account_info(),
        };
    
        let cpi_ctx_player = CpiContext::new_with_signer(
            ctx.token_program()?.to_account_info(),
            transfer_instruction_player,
            pda_signer,
        );
        
        let transfer_instruction_owner = Transfer {
            from: ctx.vault_token_account()?.to_account_info(),
            to: ctx.game_owner_token_account()?.to_account_info(),
            authority: ctx.token_account_owner_pda()?.to_account_info(),
        };
    
        let cpi_ctx_owner = CpiContext::new_with_signer(
            ctx.token_program()?.to_account_info(),
            transfer_instruction_owner,
            pda_signer,
        );

        let transfer_instruction_supersize = Transfer {
            from: ctx.vault_token_account()?.to_account_info(),
            to: ctx.supersize_token_account()?.to_account_info(),
            authority: ctx.token_account_owner_pda()?.to_account_info(),
        };
    
        let cpi_ctx_supersize = CpiContext::new_with_signer(
            ctx.token_program()?.to_account_info(),
            transfer_instruction_supersize,
            pda_signer,
        );
        anchor_spl::token::transfer(cpi_ctx_player, scaled_final_score)?;
        anchor_spl::token::transfer(cpi_ctx_owner, scaled_game_owner_amount)?;
        anchor_spl::token::transfer(cpi_ctx_supersize, scaled_supersize_amount)?;

        let player = &mut ctx.accounts.player;
        player.score = 0.0;
        player.authority = None;
        player.map = None;
        player.payout_token_account = None;

        Ok(ctx.accounts)
    }

    #[system_input]
    pub struct Components {
        pub player: Player,
        pub anteroom: Anteroom,
    }

    #[extra_accounts]
    pub struct ExtraAccounts {
        #[account(mut)]
        vault_token_account: Account<'info, TokenAccount>,
        #[account(mut)]
        sender_token_account: Account<'info, TokenAccount>,
        #[account(mut)]
        game_owner_token_account: Account<'info, TokenAccount>,
        #[account(mut)]
        supersize_token_account: Account<'info, TokenAccount>,
        #[account(mut)]
        token_account_owner_pda: AccountInfo<'info>,
        #[account(mut)]
        signer: Signer<'info>,
        system_program: Program<'info, System>,
        token_program: Program<'info, Token>,
        rent: Sysvar<'info, Rent>,
    }
}