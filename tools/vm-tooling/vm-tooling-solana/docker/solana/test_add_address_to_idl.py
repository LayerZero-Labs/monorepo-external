#!/usr/bin/env python3
"""Matcher tests for add_address_to_idl.py. Not copied into the image.

    python3 -m unittest discover -s docker/solana -p 'test_*.py'
"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from add_address_to_idl import (
    AddressExtractionError,
    AddressToIDLProcessor,
    CARGO_EXPAND_TIMEOUT_SECONDS,
    CargoExpander,
    IDLUpdater,
    compiled_program_address,
    is_valid_solana_address,
)

_OMNI = "CtrMac1111111111111111111111111111111111111"
_ZEROS = "11111111111111111111111111111111"
_ZERO_U8S = ", ".join(["0u8"] * 32)


class CompiledProgramAddressTests(unittest.TestCase):
    def test_from_str_const_multiline_trailing_comma(self):
        expand = (
            "pub static ID: anchor_lang::solana_program::pubkey::Pubkey = "
            "anchor_lang::solana_program::pubkey::Pubkey::from_str_const(\n"
            f'    "{_OMNI}",\n'
            ");"
        )
        self.assertEqual(compiled_program_address(expand), _OMNI)

    def test_from_str_const_single_line(self):
        expand = f'pub static ID: Pubkey = Pubkey::from_str_const("{_OMNI}")'
        self.assertEqual(compiled_program_address(expand), _OMNI)

    def test_new_from_array_zero_bytes(self):
        expand = (
            "pub static ID: anchor_lang::solana_program::pubkey::Pubkey = "
            "anchor_lang::solana_program::pubkey::Pubkey::new_from_array([\n"
            f"    {_ZERO_U8S}\n"
            "])"
        )
        self.assertEqual(compiled_program_address(expand), _ZEROS)

    def test_id_const_is_not_matched(self):
        expand = f'pub static ID_CONST: Pubkey = Pubkey::from_str_const("{_OMNI}")'
        self.assertIsNone(compiled_program_address(expand))

    def test_unknown_shape(self):
        self.assertIsNone(compiled_program_address("pub static ID: Pubkey = something_else();"))

    def test_from_str_const_rejects_garbage(self):
        expand = 'pub static ID: Pubkey = Pubkey::from_str_const("not-a-pubkey")'
        self.assertIsNone(compiled_program_address(expand))

    def test_new_from_array_wrong_length(self):
        expand = "pub static ID: Pubkey = Pubkey::new_from_array([0u8, 1u8])"
        self.assertIsNone(compiled_program_address(expand))


class ValidSolanaAddressTests(unittest.TestCase):
    def test_garbage_base58_is_not_an_address(self):
        self.assertFalse(is_valid_solana_address("not-a-pubkey"))

    def test_wrong_length_decode_is_not_an_address(self):
        self.assertFalse(is_valid_solana_address("1"))


class CargoExpanderTests(unittest.TestCase):
    def test_timeout_is_passed_to_cargo_expand(self):
        expander = CargoExpander()
        expand = f'pub static ID: Pubkey = Pubkey::from_str_const("{_OMNI}")'
        with patch("add_address_to_idl.subprocess.run") as run:
            run.return_value = MagicMock(stdout=expand)
            self.assertEqual(expander.extract_program_address("my_program"), _OMNI)
            self.assertEqual(run.call_args.kwargs["timeout"], CARGO_EXPAND_TIMEOUT_SECONDS)

    def test_timeout_expired_raises_address_extraction_error(self):
        expander = CargoExpander()
        with patch("add_address_to_idl.subprocess.run") as run:
            run.side_effect = subprocess.TimeoutExpired(cmd="cargo", timeout=CARGO_EXPAND_TIMEOUT_SECONDS)
            with self.assertRaises(AddressExtractionError) as ctx:
                expander.extract_program_address("my_program")
            self.assertIn("exceeded", str(ctx.exception))


class IDLUpdaterTests(unittest.TestCase):
    def test_atomic_write_updates_address_and_leaves_no_tmp(self):
        with tempfile.TemporaryDirectory() as tmp:
            idl_dir = Path(tmp)
            (idl_dir / "prog.json").write_text('{"name": "prog"}')
            self.assertTrue(IDLUpdater(idl_dir).update_idl_file("prog", _OMNI))
            data = json.loads((idl_dir / "prog.json").read_text())
            self.assertEqual(data["address"], _OMNI)
            self.assertFalse((idl_dir / "prog.json.tmp").exists())

    def test_invalid_json_returns_false(self):
        with tempfile.TemporaryDirectory() as tmp:
            idl_dir = Path(tmp)
            (idl_dir / "prog.json").write_text("{not json")
            self.assertFalse(IDLUpdater(idl_dir).update_idl_file("prog", _OMNI))

    def test_non_utf8_returns_false(self):
        with tempfile.TemporaryDirectory() as tmp:
            idl_dir = Path(tmp)
            (idl_dir / "prog.json").write_bytes(b"\xff\xfe{\"name\": \"prog\"}")
            self.assertFalse(IDLUpdater(idl_dir).update_idl_file("prog", _OMNI))

    def test_write_failure_removes_tmp_and_leaves_original(self):
        with tempfile.TemporaryDirectory() as tmp:
            idl_dir = Path(tmp)
            original = '{"name": "prog"}'
            (idl_dir / "prog.json").write_text(original)
            with patch("add_address_to_idl.os.replace", side_effect=OSError("disk full")):
                self.assertFalse(IDLUpdater(idl_dir).update_idl_file("prog", _OMNI))
            self.assertEqual((idl_dir / "prog.json").read_text(), original)
            self.assertFalse((idl_dir / "prog.json.tmp").exists())


class ProcessTests(unittest.TestCase):
    def _processor(self, program_names, *, extract=None, update=None, exists=None):
        processor = AddressToIDLProcessor(Path("/idl"))
        processor.validate_dependencies = lambda: True
        processor.validate_directories = lambda: True
        processor.cargo_expander.get_program_names = lambda: program_names
        processor.cargo_expander.extract_program_address = extract or MagicMock(return_value=_OMNI)
        processor.idl_updater.update_idl_file = update or MagicMock(return_value=True)
        processor.idl_updater.idl_exists = exists or MagicMock(return_value=True)
        return processor

    def test_failed_write_is_fatal_even_if_another_program_succeeded(self):
        extract = MagicMock(return_value=_OMNI)
        update = MagicMock(side_effect=[True, False])
        processor = self._processor(["a", "b"], extract=extract, update=update)
        self.assertFalse(processor.process())
        self.assertEqual(update.call_count, 2)

    def test_missing_idl_is_skipped_without_expanding(self):
        extract = MagicMock(return_value=_OMNI)
        exists = MagicMock(side_effect=lambda name: name == "built")
        processor = self._processor(["missing", "built"], extract=extract, exists=exists)
        self.assertTrue(processor.process())
        extract.assert_called_once_with("built")

    def test_zero_built_idls_is_an_error(self):
        extract = MagicMock()
        exists = MagicMock(return_value=False)
        processor = self._processor(["a", "b"], extract=extract, exists=exists)
        self.assertFalse(processor.process())
        extract.assert_not_called()


if __name__ == "__main__":
    unittest.main()
