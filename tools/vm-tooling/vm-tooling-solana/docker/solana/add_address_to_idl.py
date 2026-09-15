#!/usr/bin/env python3
"""
Script to extract program addresses by expanding macros using cargo expand and update IDL files.

Usage: python add_address_to_idl.py [--idl-dir IDL_DIR] [--verbose]
"""

import argparse
import json
import logging
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import List, Optional

try:
    import base58
except ImportError:
    print("❌ Error: base58 library is required. Install it with: pip install base58")
    sys.exit(1)


def is_valid_solana_address(address: Optional[str]) -> bool:
    if not address:
        return False
    try:
        return len(base58.b58decode(address)) == 32
    except ValueError:
        return False


class AddressExtractionError(RuntimeError):
    """The compiled program address could not be established."""


# cargo expand dumps macro-expanded Rust as text. This helper is Python inside
# the anchor image, so we match the two `pub static ID` forms Anchor emits
# instead of parsing with syn. Unknown shapes must fail, not fall back to the IDL.

# Anchor 1.x `declare_id!("CtrMac...")` →
#   pub static ID: ...::Pubkey = ...::Pubkey::from_str_const("CtrMac...")
_FROM_STR_CONST = re.compile(
    r'pub static ID:\s*(?:\w+::)*Pubkey\s*=\s*(?:\w+::)*Pubkey::from_str_const\(\s*"([^"]+)"\s*,?\s*\)'
)


def address_from_str_const(expand_output: str) -> Optional[str]:
    match = _FROM_STR_CONST.search(expand_output)
    if match and is_valid_solana_address(match.group(1)):
        return match.group(1)
    return None


# Literal `declare_id!("...")` on Anchor ≤0.32, and env-derived
# `declare_id!(Pubkey::new_from_array(program_id_from_env!(...)))` on every version →
#   pub static ID: ...::Pubkey = ...::Pubkey::new_from_array([0u8, 1u8, ...])
_FROM_NEW_FROM_ARRAY = re.compile(
    r'pub static ID:\s*(?:\w+::)*Pubkey\s*=\s*(?:\w+::)*Pubkey::new_from_array\(\[([^\]]+)\]\)'
)


def address_from_new_from_array(expand_output: str) -> Optional[str]:
    match = _FROM_NEW_FROM_ARRAY.search(expand_output)
    if not match:
        return None
    byte_values = re.findall(r'(\d+)u8', match.group(1))
    if len(byte_values) != 32:
        return None
    try:
        return base58.b58encode(bytes(int(b) for b in byte_values)).decode('utf-8')
    except ValueError:
        return None


def compiled_program_address(expand_output: str) -> Optional[str]:
    return address_from_str_const(expand_output) or address_from_new_from_array(expand_output)


class Colors:
    """ANSI color codes for terminal output."""
    RED = '\033[0;31m'
    GREEN = '\033[0;32m'
    YELLOW = '\033[1;33m'
    BLUE = '\033[0;34m'
    NC = '\033[0m'  # No Color


# This script usually runs after `anchor idl build`, so cargo expand is a warm compile. The
# cap exists so a stuck cargo fails with a legible message instead of hanging until CI kills the job.
CARGO_EXPAND_TIMEOUT_SECONDS = 300


class CargoExpander:
    """Handles cargo expand operations to extract program addresses."""
    
    def __init__(self):
        self.logger = logging.getLogger(__name__)
    
    def get_program_names(self) -> List[str]:
        """Extract program names from anchor keys list."""
        try:
            result = subprocess.run(['anchor', 'keys', 'list'], 
                                  capture_output=True, text=True, check=True)
            
            program_names = []
            for line in result.stdout.strip().split('\n'):
                if ':' in line:
                    program_name = line.split(':')[0].strip()
                    if program_name:
                        program_names.append(program_name)
            
            return program_names
        except subprocess.CalledProcessError as e:
            self.logger.error(f"Failed to get program names from anchor keys list: {e}")
            return []
        except FileNotFoundError:
            self.logger.error("anchor command not found. Please install Anchor CLI.")
            return []
    
    def convert_program_name_for_cargo(self, program_name: str) -> str:
        """Convert program name for cargo expand (underscores to hyphens)."""
        return program_name.replace('_', '-')
    
    def extract_program_address(self, program_name: str) -> str:
        """Compiled program ID from `pub static ID` in the cargo-expand output."""
        cargo_program_name = self.convert_program_name_for_cargo(program_name)

        try:
            self.logger.info(f"Running: cargo expand -p {cargo_program_name}")
            result = subprocess.run(['cargo', 'expand', '-p', cargo_program_name],
                                  capture_output=True, text=True, check=True,
                                  timeout=CARGO_EXPAND_TIMEOUT_SECONDS)
        except subprocess.CalledProcessError as e:
            raise AddressExtractionError(
                f"cargo expand failed for {cargo_program_name}: {e.stderr or e}"
            ) from e
        except subprocess.TimeoutExpired as e:
            raise AddressExtractionError(
                f"cargo expand for {cargo_program_name} exceeded "
                f"{CARGO_EXPAND_TIMEOUT_SECONDS}s and was killed"
            ) from e
        except FileNotFoundError as e:
            raise AddressExtractionError(
                "cargo command not found. Please install Rust and Cargo."
            ) from e

        address = compiled_program_address(result.stdout)
        if address is None:
            raise AddressExtractionError(
                f"could not establish compiled program ID for {program_name}"
            )

        self.logger.info(f"✅ Extracted address: {address}")
        return address


class IDLUpdater:
    """Handles IDL file updates."""
    
    def __init__(self, idl_dir: Path):
        self.idl_dir = idl_dir
        self.logger = logging.getLogger(__name__)

    def _idl_path(self, program_name: str) -> Path:
        return self.idl_dir / f"{program_name}.json"

    def idl_exists(self, program_name: str) -> bool:
        return self._idl_path(program_name).exists()

    def _load_idl(self, program_name: str) -> Optional[dict]:
        idl_file = self._idl_path(program_name)
        if not idl_file.exists():
            return None
        with open(idl_file, 'r') as f:
            return json.load(f)
    
    def update_idl_file(self, program_name: str, address: str) -> bool:
        """Update IDL file with address."""
        idl_file = self._idl_path(program_name)
        try:
            idl_data = self._load_idl(program_name)
        # ValueError covers JSONDecodeError and the UnicodeDecodeError a non-UTF-8 file raises.
        except (ValueError, OSError) as e:
            self.logger.error(f"Failed to read IDL file {idl_file}: {e}")
            return False

        if idl_data is None:
            self.logger.error(f"⚠️  IDL file not found: {idl_file}")
            return False

        current_address = idl_data.get('address')
        if current_address == address:
            self.logger.info(f"✅ IDL already up to date: {current_address}")
            return True

        if current_address:
            self.logger.info(f"🔄 Updating address in IDL from {current_address} to {address}")
        else:
            self.logger.info(f"📝 Adding address to IDL: {address}")

        idl_data['address'] = address
        # Write beside the target and rename, so an interrupted write cannot leave a truncated IDL
        # that later runs would fail to parse.
        tmp_file = idl_file.with_suffix('.json.tmp')
        try:
            with open(tmp_file, 'w') as f:
                json.dump(idl_data, f, indent=2)
            os.replace(tmp_file, idl_file)
        except OSError as e:
            tmp_file.unlink(missing_ok=True)
            self.logger.error(f"Failed to update IDL file {idl_file}: {e}")
            return False

        self.logger.info(f"✅ Successfully updated IDL file: {idl_file}")
        return True


class AddressToIDLProcessor:
    """Main processor that orchestrates the workflow."""
    
    def __init__(self, idl_dir: Path, verbose: bool = False):
        self.idl_dir = idl_dir
        self.verbose = verbose
        
        # Setup logging
        level = logging.DEBUG if verbose else logging.INFO
        logging.basicConfig(
            level=level,
            format='%(message)s',
            handlers=[logging.StreamHandler()]
        )
        self.logger = logging.getLogger(__name__)
        
        self.cargo_expander = CargoExpander()
        self.idl_updater = IDLUpdater(idl_dir)
    
    def validate_dependencies(self) -> bool:
        """Validate required dependencies are available."""
        dependencies = ['cargo', 'anchor']
        missing = []
        
        for dep in dependencies:
            try:
                subprocess.run([dep, '--help'], capture_output=True, check=True)
            except (subprocess.CalledProcessError, FileNotFoundError):
                missing.append(dep)
        
        if missing:
            self.logger.error(f"❌ Missing dependencies: {', '.join(missing)}")
            return False
        
        return True
    
    def validate_directories(self) -> bool:
        """Validate required directories and files exist."""
        if not self.idl_dir.exists():
            self.logger.error(f"❌ IDL directory not found: {self.idl_dir}")
            return False
        
        return True

    def process(self) -> bool:
        """Main processing workflow."""
        self.logger.info(f"{Colors.GREEN}🚀 Extracting program addresses from expanded macros and updating IDL files...{Colors.NC}")
        
        # Validate dependencies and directories
        if not self.validate_dependencies() or not self.validate_directories():
            return False
        
        # Get program names
        program_names = self.cargo_expander.get_program_names()
        if not program_names:
            self.logger.error("❌ No programs found from anchor keys list")
            return False
        
        self.logger.info(f"{Colors.BLUE}📋 Found {len(program_names)} programs: {', '.join(program_names)}{Colors.NC}")
        
        # Process each program
        success_count = 0
        for program_name in program_names:
            self.logger.info(f"\n{Colors.YELLOW}🔧 Processing program: {program_name}{Colors.NC}")
            # A caller may build a subset of the workspace's IDLs, so an absent one is not a
            # failure; every other outcome is, since the address it would have written is wrong.
            if not self.idl_updater.idl_exists(program_name):
                self.logger.warning(f"⚠️  No IDL built for {program_name}, skipping")
                continue

            try:
                address = self.cargo_expander.extract_program_address(program_name)
            except AddressExtractionError as e:
                self.logger.error(f"❌ {e}")
                return False

            if not self.idl_updater.update_idl_file(program_name, address):
                return False

            success_count += 1

        if not success_count:
            self.logger.error(f"❌ No IDL files found in {self.idl_dir}")
            return False

        # Final summary
        self.logger.info(f"\n{Colors.GREEN}🏁 Processing complete! Successfully updated {success_count}/{len(program_names)} programs.{Colors.NC}")
        return True


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Extract program addresses and update IDL files",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    
    parser.add_argument(
        '--idl-dir',
        type=Path,
        default=Path('target/idl'),
        help='Path to IDL directory (default: target/idl)'
    )
    
    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Enable verbose logging'
    )
    
    args = parser.parse_args()
    
    # Create processor and run
    processor = AddressToIDLProcessor(
        idl_dir=args.idl_dir,
        verbose=args.verbose
    )
    
    success = processor.process()
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
