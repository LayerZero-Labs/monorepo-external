# Munge patches for Certora verification
#
# These patches modify the source code to work around Certora prover limitations
# (e.g., replacing abi.encodePacked with abi.encode to reduce hashing complexity)
#
# Usage:
#   make munge    - Apply all munge-*.patch files
#   make unmunge  - Reverse all munge-*.patch files
#
# To create a new munge:
#   1. Make the changes to the source file
#   2. git diff packages/onesig/onesig-evm/contracts/YourFile.sol > munge-YourChange.patch
#   3. Revert the source file changes
#   4. Test with: make munge && certoraRun ... && make unmunge

# Get the git root and current directory relative to it
GIT_ROOT := $(shell git rev-parse --show-toplevel)
MUNGES_DIR := packages/onesig/onesig-evm/certora/munges

.PHONY: munge unmunge

munge:
	@set -e; cd $(GIT_ROOT) && \
	for f in $(MUNGES_DIR)/munge-*.patch; do \
		if [ -f "$$f" ]; then \
			echo "Applying $$f" ; \
			git apply "$$f" ; \
		fi \
	done

unmunge:
	@set -e; cd $(GIT_ROOT) && \
	for f in $(MUNGES_DIR)/munge-*.patch; do \
		if [ -f "$$f" ]; then \
			echo "Reverting $$f" ; \
			git apply -R "$$f" ; \
		fi \
	done
