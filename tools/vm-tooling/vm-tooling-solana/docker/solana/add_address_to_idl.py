#!/usr/bin/env python3
"""
Script to extract program addresses by expanding macros using cargo expand and update IDL files.
Optionally exports keypairs from local files and adds them to IDL if public key matches program address.

Usage: python add_address_to_idl.py [--keypair KEYPAIR_FILE] [--idl-dir IDL_DIR] [--verbose]
"""

import argparse
import json
import logging
import re
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

try:
    import base58
except ImportError:
    print("❌ Error: base58 library is required. Install it with: pip install base58")
    sys.exit(1)


class Colors:
    """ANSI color codes for terminal output."""
    RED = '\033[0;31m'
    GREEN = '\033[0;32m'
    YELLOW = '\033[1;33m'
    BLUE = '\033[0;34m'
    NC = '\033[0m'  # No Color


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
    
    def extract_program_address(self, program_name: str) -> Optional[str]:
        """Extract program address using cargo expand."""
        cargo_program_name = self.convert_program_name_for_cargo(program_name)
        
        try:
            self.logger.info(f"Running: cargo expand -p {cargo_program_name}")
            result = subprocess.run(['cargo', 'expand', '-p', cargo_program_name],
                                  capture_output=True, text=True, check=True)
            
            # Extract pubkey bytes from the expand output
            pubkey_bytes = self._extract_pubkey_from_output(result.stdout)
            if pubkey_bytes:
                # Convert bytes to base58
                base58_address = base58.b58encode(bytes(pubkey_bytes)).decode('utf-8')
                self.logger.info(f"✅ Extracted address: {base58_address}")
                return base58_address
            else:
                self.logger.error(f"Failed to extract pubkey from expand output for {program_name}")
                return None
                
        except subprocess.CalledProcessError as e:
            self.logger.error(f"cargo expand failed for {cargo_program_name}: {e}")
            return None
        except FileNotFoundError:
            self.logger.error("cargo command not found. Please install Rust and Cargo.")
            return None
    
    def _extract_pubkey_from_output(self, expand_output: str) -> Optional[List[int]]:
        """Extract pubkey bytes from cargo expand output."""
        # Look for the pubkey definition pattern - support multiple formats
        patterns = [
            # Full path: anchor_lang::solana_program::pubkey::Pubkey::new_from_array
            r'pub static ID:.*?anchor_lang::solana_program::pubkey::Pubkey::new_from_array\(\[(.*?)\]\);',
            # Short path: Pubkey::new_from_array
            r'pub static ID:.*?Pubkey::new_from_array\(\[(.*?)\]\);'
        ]
        
        for pattern in patterns:
            match = re.search(pattern, expand_output, re.DOTALL)
            if match:
                bytes_str = match.group(1)
                # Extract numbers from the bytes string (remove u8 suffixes)
                byte_values = re.findall(r'(\d+)u8', bytes_str)
                if len(byte_values) == 32:  # Should be exactly 32 bytes
                    self.logger.debug(f"Found pubkey using pattern: {pattern[:50]}...")
                    return [int(b) for b in byte_values]
        
        self.logger.error("Failed to find pubkey in cargo expand output")
        self.logger.debug("Searched for patterns:")
        for i, pattern in enumerate(patterns, 1):
            self.logger.debug(f"  {i}. {pattern}")
        
        return None


class KeypairHandler:
    """Handles keypair loading and validation."""
    
    def __init__(self, keypair_file: Optional[Path] = None):
        self.keypair_file = keypair_file
        self.logger = logging.getLogger(__name__)
    
    def load_keypair(self, program_name: str) -> Optional[List[int]]:
        """Load keypair from file."""
        if not self.keypair_file:
            return None
        
        if not self.keypair_file.exists():
            self.logger.warning(f"⚠️  Keypair file not found: {self.keypair_file}")
            return None
        
        try:
            with open(self.keypair_file, 'r') as f:
                keypair = json.load(f)
            
            if not isinstance(keypair, list) or len(keypair) != 64:
                self.logger.error(f"Invalid keypair format in {self.keypair_file}")
                return None
            
            return keypair
        except (json.JSONDecodeError, IOError) as e:
            self.logger.error(f"Failed to load keypair from {self.keypair_file}: {e}")
            return None
    
    def extract_public_key(self, keypair: List[int]) -> List[int]:
        """Extract public key (last 32 bytes) from keypair."""
        # Solana keypair format: [private_key (32 bytes), public_key (32 bytes)]
        return keypair[32:64]
    
    def validate_keypair_match(self, program_address: str, keypair: List[int]) -> bool:
        """Validate if keypair's public key matches the program address."""
        public_key_bytes = self.extract_public_key(keypair)
        keypair_address = base58.b58encode(bytes(public_key_bytes)).decode('utf-8')
        
        if keypair_address == program_address:
            self.logger.info("🔑 Keypair public key matches program address")
            return True
        else:
            self.logger.error(f"{Colors.RED}❌ Keypair public key doesn't match program address{Colors.NC}")
            self.logger.error(f"   📍 Program address: {program_address}")
            self.logger.error(f"   🔑 Keypair pubkey:  {keypair_address}")
            raise ValueError(f"Keypair mismatch: expected {program_address}, got {keypair_address}")


class IDLUpdater:
    """Handles IDL file updates."""
    
    def __init__(self, idl_dir: Path):
        self.idl_dir = idl_dir
        self.logger = logging.getLogger(__name__)
    
    def update_idl_file(self, program_name: str, address: str, keypair: Optional[List[int]] = None) -> bool:
        """Update IDL file with address and optionally keypair."""
        idl_file = self.idl_dir / f"{program_name}.json"
        
        if not idl_file.exists():
            self.logger.error(f"⚠️  IDL file not found: {idl_file}")
            return False
        
        try:
            # Load existing IDL
            with open(idl_file, 'r') as f:
                idl_data = json.load(f)
            
            # Check current state
            current_address = idl_data.get('address')
            has_keypair = 'keypair' in idl_data
            
            if current_address == address:
                self.logger.info(f"✅ IDL already has correct address: {current_address}")
            elif current_address:
                self.logger.info(f"🔄 Updating address in IDL from {current_address} to {address}")
            else:
                self.logger.info(f"📝 Adding address to IDL: {address}")
            
            # Update IDL data
            idl_data['address'] = address
            
            if keypair:
                idl_data['keypair'] = keypair
                self.logger.info("🔑 Adding keypair to IDL")
            elif has_keypair and not keypair:
                # Remove keypair if it existed but we're not providing one now
                del idl_data['keypair']
                self.logger.info("🗑️  Removed keypair from IDL")
            
            # Write updated IDL
            with open(idl_file, 'w') as f:
                json.dump(idl_data, f, indent=2)
            
            self.logger.info(f"✅ Successfully updated IDL file: {idl_file}")
            return True
            
        except (json.JSONDecodeError, IOError) as e:
            self.logger.error(f"Failed to update IDL file {idl_file}: {e}")
            return False


class AddressToIDLProcessor:
    """Main processor that orchestrates the workflow."""
    
    def __init__(self, idl_dir: Path, keypair_file: Optional[Path] = None, verbose: bool = False):
        self.idl_dir = idl_dir
        self.keypair_file = keypair_file
        self.verbose = verbose
        
        # Setup logging
        level = logging.DEBUG if verbose else logging.INFO
        logging.basicConfig(
            level=level,
            format='%(message)s',
            handlers=[logging.StreamHandler()]
        )
        self.logger = logging.getLogger(__name__)
        
        # Initialize components
        self.cargo_expander = CargoExpander()
        self.keypair_handler = KeypairHandler(keypair_file) if keypair_file else None
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
        
        if self.keypair_file and not self.keypair_file.exists():
            self.logger.warning(f"⚠️  Keypair file not found: {self.keypair_file}")
            self.keypair_handler = None
        
        return True
    
    def process(self) -> bool:
        """Main processing workflow."""
        # Print startup message
        if self.keypair_handler:
            self.logger.info(f"{Colors.GREEN}🚀 Extracting program addresses from expanded macros, exporting keypairs, and updating IDL files...{Colors.NC}")
            self.logger.info(f"{Colors.BLUE}📄 Using keypair file: {self.keypair_file}{Colors.NC}")
        else:
            self.logger.info(f"{Colors.GREEN}🚀 Extracting program addresses from expanded macros and updating IDL files...{Colors.NC}")
            self.logger.info(f"{Colors.YELLOW}⚠️  Keypair export disabled. Use --keypair to enable keypair functionality.{Colors.NC}")
        
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
            
            # Extract program address
            address = self.cargo_expander.extract_program_address(program_name)
            if not address:
                self.logger.error(f"❌ Failed to extract address for {program_name}")
                continue
            
            # Handle keypair if enabled
            keypair = None
            if self.keypair_handler:
                keypair_data = self.keypair_handler.load_keypair(program_name)
                if keypair_data:
                    try:
                        if self.keypair_handler.validate_keypair_match(address, keypair_data):
                            keypair = keypair_data
                    except ValueError as e:
                        self.logger.error(f"❌ Keypair validation failed for {program_name}: {e}")
                        return False
            
            # Update IDL
            if self.idl_updater.update_idl_file(program_name, address, keypair):
                success_count += 1
        
        # Final summary
        self.logger.info(f"\n{Colors.GREEN}🏁 Processing complete! Successfully updated {success_count}/{len(program_names)} programs.{Colors.NC}")
        return success_count > 0


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Extract program addresses and update IDL files with optional keypair support",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    
    parser.add_argument(
        '--keypair',
        type=Path,
        help='Optional path to keypair JSON file'
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
        keypair_file=args.keypair,
        verbose=args.verbose
    )
    
    success = processor.process()
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
