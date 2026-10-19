//! Treasury component implementation

#[starknet::contract]
pub mod Treasury {
    use lz_utils::error::assert_with_byte_array;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
    use starknet::ContractAddress;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use crate::common::constants::BPS_DENOMINATOR;
    use crate::treasury::errors::{err_lz_token_not_enabled, err_transfer_failed};
    use crate::treasury::events::BasisPointsUpdated;
    use crate::treasury::interfaces::layerzero_treasury::ILayerZeroTreasury;
    use crate::treasury::interfaces::lz_token_fee_lib::{
        ILzTokenFeeLibDispatcher, ILzTokenFeeLibDispatcherTrait,
    };
    use crate::treasury::interfaces::treasury_admin::ITreasuryAdmin;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
        basis_points: u256,
        lz_token_fee_lib: Option<ContractAddress>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        BasisPointsUpdated: BasisPointsUpdated,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.ownable.initializer(owner);
    }

    #[abi(embed_v0)]
    impl TreasuryImpl of ILayerZeroTreasury<ContractState> {
        fn get_fee(
            self: @ContractState,
            sender: ContractAddress,
            dst_eid: u32,
            worker_fee: u256,
            pay_in_lz_token: bool,
        ) -> u256 {
            let native_fee = self._get_native_fee(worker_fee);

            if pay_in_lz_token {
                self
                    ._get_lz_token_library_dispatcher()
                    .get_fee(sender, dst_eid, worker_fee, native_fee)
            } else {
                native_fee
            }
        }

        fn pay_fee(
            ref self: ContractState,
            sender: ContractAddress,
            dst_eid: u32,
            worker_fee: u256,
            pay_in_lz_token: bool,
        ) -> u256 {
            let native_fee = self._get_native_fee(worker_fee);

            if pay_in_lz_token {
                self
                    ._get_lz_token_library_dispatcher()
                    .pay_fee(sender, dst_eid, worker_fee, native_fee)
            } else {
                native_fee
            }
        }
    }

    #[generate_trait]
    pub impl TreasuryInternalImpl of TreasuryInternalTrait {
        fn _get_native_fee(self: @ContractState, worker_fee: u256) -> u256 {
            worker_fee * self.basis_points.read() / BPS_DENOMINATOR
        }

        fn _get_lz_token_library_dispatcher(self: @ContractState) -> ILzTokenFeeLibDispatcher {
            let library = self.lz_token_fee_lib.read();
            assert_with_byte_array(library.is_some(), err_lz_token_not_enabled());

            ILzTokenFeeLibDispatcher {
                contract_address: library.expect('LZ token fee library exists'),
            }
        }
    }

    #[abi(embed_v0)]
    impl TreasuryAdminImpl of ITreasuryAdmin<ContractState> {
        fn set_fee_bp(ref self: ContractState, basis_points: u256) {
            self.ownable.assert_only_owner();
            let old_bp = self.basis_points.read();
            self.basis_points.write(basis_points);

            self.emit(BasisPointsUpdated { old_bp, new_bp: basis_points });
        }

        fn get_fee_bp(self: @ContractState) -> u256 {
            self.basis_points.read()
        }

        fn withdraw_tokens(
            ref self: ContractState,
            token_address: ContractAddress,
            to: ContractAddress,
            amount: u256,
        ) {
            self.ownable.assert_only_owner();
            let token_dispatcher = IERC20Dispatcher { contract_address: token_address };

            let success = token_dispatcher.transfer(to, amount);

            assert_with_byte_array(success, err_transfer_failed());
        }

        fn get_lz_token_fee_lib(self: @ContractState) -> Option<ContractAddress> {
            self.lz_token_fee_lib.read()
        }

        fn set_lz_token_fee_lib(ref self: ContractState, library: Option<ContractAddress>) {
            self.ownable.assert_only_owner();

            self.lz_token_fee_lib.write(library);
        }
    }
}
