use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use soroban_spec_typescript::generate_from_file;
use std::{env, fs, path::Path};

const IMPORTS_HEADER: &str = r#"import { Buffer } from "buffer";
import { Address } from '@stellar/stellar-sdk';
import {
  AssembledTransaction,
  AssembledTransactionOptions,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from '@stellar/stellar-sdk/contract';
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Typepoint,
  Duration,
} from '@stellar/stellar-sdk/contract';
export * from '@stellar/stellar-sdk'
export * as contract from '@stellar/stellar-sdk/contract'
export * as rpc from '@stellar/stellar-sdk/rpc'

// Soroban SDK types referenced in contract specs but not defined in the contract itself.
// InvokerContractAuthEntry is a Soroban built-in encoded as ScVal:
//   scvVec([symbol("Contract"), scvMap({
//     context: scvMap({ args, contract, fn_name }),
//     sub_invocations: scvVec([...])
//   })])
// Must be manually constructed — the contract spec's nativeToScVal cannot serialize it.
import type { xdr } from '@stellar/stellar-sdk';
export type InvokerContractAuthEntry = xdr.ScVal;

"#;

#[derive(Deserialize)]
struct Config {
    /// Path to the directory containing compiled `.wasm` files
    #[serde(default = "default_wasm_dir")]
    wasm_dir: String,
    /// Path to the output directory for generated `.ts` files
    #[serde(default = "default_output_dir")]
    output_dir: String,
    /// List of contracts to generate bindings for
    contracts: Vec<ContractEntry>,
}

#[derive(Deserialize)]
struct ContractEntry {
    /// The WASM filename without extension (e.g., "endpoint_v2")
    wasm_name: String,
    /// The output TypeScript filename (e.g., "endpoint.ts")
    output_name: String,
}

fn default_wasm_dir() -> String {
    "target/wasm32v1-none/release".to_string()
}

fn default_output_dir() -> String {
    "sdk/src/generated".to_string()
}

/// Generate embedded WASM code section containing base64-encoded bytecode,
/// pre-computed SHA-256 hash, and a helper function to decode the buffer.
fn generate_wasm_embed(wasm_bytes: &[u8]) -> String {
    let wasm_hash = Sha256::digest(wasm_bytes);
    let wasm_hash_hex = format!("{:x}", wasm_hash);
    let wasm_base64 = BASE64.encode(wasm_bytes);

    format!(
        r#"/**
 * Embedded WASM bytecode (base64-encoded)
 * Size: {} bytes ({:.2} KB)
 */
export const WASM_BASE64 = "{}";

/**
 * Pre-computed WASM hash (SHA-256)
 * Use this when the WASM is already uploaded on-chain
 */
export const WASM_HASH = "{}";

/**
 * Get the WASM bytecode as a Buffer
 * Use this to upload the WASM to the network
 */
export function getWasmBuffer(): Buffer {{
  return Buffer.from(WASM_BASE64, 'base64');
}}

"#,
        wasm_bytes.len(),
        wasm_bytes.len() as f64 / 1024.0,
        wasm_base64,
        wasm_hash_hex
    )
}

/// Replace `options?` parameter names with `txnOptions?` in generated TypeScript
/// to avoid naming conflicts with user-defined `options` parameters.
fn rename_options_parameter(ts_code: &str) -> String {
    let ts_code = ts_code.replace(
        r#"options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }"#,
        r#"txnOptions?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }"#,
    );

    ts_code.replace(
        ", options?: MethodOptions)",
        ", txnOptions?: MethodOptions)",
    )
}

fn print_usage() {
    eprintln!("Usage: stellar-ts-bindings-gen --config <path>");
    eprintln!();
    eprintln!("Flags:");
    eprintln!("  --config <path>   Path to TOML config file (required)");
}

fn main() -> Result<()> {
    let args: Vec<String> = env::args().collect();

    let config_path = match args.iter().position(|a| a == "--config") {
        Some(i) => args
            .get(i + 1)
            .context("--config requires a path argument")?,
        None => {
            print_usage();
            anyhow::bail!("--config flag is required");
        }
    };

    let config_content =
        fs::read_to_string(config_path).context(format!("Failed to read config: {}", config_path))?;
    let config: Config =
        toml::from_str(&config_content).context(format!("Failed to parse config: {}", config_path))?;

    let wasm_base = Path::new(&config.wasm_dir);
    let output_dir = Path::new(&config.output_dir);

    println!(
        "Generating TypeScript bindings for {} contract(s)...\n",
        config.contracts.len()
    );

    fs::create_dir_all(output_dir)?;

    let mut generated = Vec::new();

    for entry in &config.contracts {
        let wasm_path = wasm_base.join(format!("{}.wasm", entry.wasm_name));
        let output_file = output_dir.join(&entry.output_name);

        println!("Processing contract: {}", entry.wasm_name);
        println!("   WASM: {}", wasm_path.display());
        println!("   Output: {}", output_file.display());

        if !wasm_path.exists() {
            eprintln!("   WASM file not found: {}", wasm_path.display());
            eprintln!(
                "   Skipping {}. Build the contract first with:",
                entry.wasm_name
            );
            eprintln!("   stellar contract build -p {}\n", entry.wasm_name);
            continue;
        }

        let wasm_bytes = fs::read(&wasm_path)?;
        println!(
            "   WASM size: {} bytes ({:.2} KB)",
            wasm_bytes.len(),
            wasm_bytes.len() as f64 / 1024.0
        );

        let wasm_embed = generate_wasm_embed(&wasm_bytes);

        println!("   Generating bindings...");
        let wasm_path_str = wasm_path
            .to_str()
            .ok_or_else(|| anyhow::anyhow!("Invalid path: {}", wasm_path.display()))?;
        let ts_code = generate_from_file(wasm_path_str, None)?;
        let ts_code = rename_options_parameter(&ts_code);

        let complete_code = format!("{}{}{}", IMPORTS_HEADER, wasm_embed, ts_code);
        fs::write(&output_file, &complete_code)?;
        println!("   Generated: {}", output_file.display());

        let module_name = entry.output_name.trim_end_matches(".ts");
        generated.push(module_name.to_string());
    }

    println!(
        "\nTypeScript binding generation complete! Generated {} contract(s) with embedded WASM",
        generated.len()
    );

    if generated.is_empty() {
        println!("\nTip: Build your contracts first before generating bindings.");
    } else {
        println!("\nGenerated files in {}:", output_dir.display());
        for name in &generated {
            println!("   - {}.ts", name);
        }
    }

    Ok(())
}
