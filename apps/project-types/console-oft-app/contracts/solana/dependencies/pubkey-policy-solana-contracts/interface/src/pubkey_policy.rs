//! Consumer-side policy reads: validated records and blocking.
//!
//! A consumer trusts one policy account, the one its admin selected. The program that owns that
//! account is the policy program for it: records must be owned and derived by that program, and
//! share this crate's layout. The program is always read from the policy account, never passed
//! separately, so a stale or wrong program elsewhere (a manifest's) fails the record check rather
//! than reading every record as empty. Nothing here pins a program ID, so a consumer can move to a
//! policy under a new program by selecting it.
use crate::{subject_address_in, Membership, PolicyError, PubkeyPolicy, SubjectRecord};
use anchor_lang::prelude::*;

/// `subject`'s membership under `policy`, owned by `program`. `record` must be at the canonical
/// address; an unallocated system account there (even one holding lamports) is no membership, and
/// a record owned by another program or failing to decode is an error. Absence never permits
/// omitting or substituting the account.
fn read_membership(
    record: &AccountInfo<'_>,
    policy: &Pubkey,
    subject: &Pubkey,
    program: &Pubkey,
) -> Result<Membership> {
    require_keys_eq!(
        *record.key,
        subject_address_in(policy, subject, program).0,
        PolicyError::WrongRecord
    );
    if record.owner == &System::id() && record.data_is_empty() {
        return Ok(Membership::default());
    }

    require_keys_eq!(*record.owner, *program, PolicyError::WrongOwner);
    let decoded = SubjectRecord::try_deserialize(&mut &record.try_borrow_data()?[..])
        .map_err(|_| error!(PolicyError::InvalidRecord))?;
    Ok(decoded.membership)
}

/// One subject's answer from [`Self::read`], with its record authenticated. Fields are private so
/// the value can only come from that read. It does not prove the caller bound the policy, and it
/// is not a token-operation authorization.
#[derive(Clone, Copy, Debug)]
pub struct ValidatedPubkeyPolicy {
    pub(crate) policy: Pubkey,
    pub(crate) mint: Pubkey,
    pub(crate) subject: Pubkey,
    /// The subject's canonical record address, already checked by the read.
    pub(crate) record: Pubkey,
    pub(crate) blocked: bool,
}

impl ValidatedPubkeyPolicy {
    pub fn policy(&self) -> Pubkey {
        self.policy
    }

    pub fn mint(&self) -> Pubkey {
        self.mint
    }

    pub fn subject(&self) -> Pubkey {
        self.subject
    }

    pub fn record(&self) -> Pubkey {
        self.record
    }

    /// Read `subject`'s answer from `policy`, trusting the program that owns it, whose records
    /// `record` must be. `policy` must be a created `PubkeyPolicy`; an uncreated one is rejected.
    ///
    /// Only the record is authenticated here. The caller must already have bound `policy` as the
    /// one it accepts; another valid policy is not a substitute. An error is never an "allowed"
    /// answer. This is pubkey policy only; native frozen state and other token-operation checks
    /// are the consumer's to compose.
    pub fn read(policy: &AccountInfo, record: &AccountInfo, subject: &Pubkey) -> Result<Self> {
        let state = PubkeyPolicy::try_deserialize(&mut &policy.try_borrow_data()?[..])?;
        let membership = read_membership(record, &policy.key(), subject, policy.owner)?;
        Ok(Self {
            policy: policy.key(),
            mint: state.mint,
            subject: *subject,
            record: record.key(),
            blocked: !state.mode.allows(membership),
        })
    }

    pub fn is_blocked(&self) -> bool {
        self.blocked
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{pubkey_policy_address, subject_address, PubkeyPolicyMode, ID};

    fn encoded(record: &SubjectRecord) -> Vec<u8> {
        let mut data = Vec::new();
        record.try_serialize(&mut data).unwrap();
        data
    }

    fn is_blocked(
        record: &AccountInfo,
        policy: &Pubkey,
        subject: &Pubkey,
        program: &Pubkey,
        mode: PubkeyPolicyMode,
    ) -> Result<bool> {
        Ok(!mode.allows(read_membership(record, policy, subject, program)?))
    }

    #[test]
    fn missing_is_allowed_but_wrong_address_and_owner_are_not() {
        let policy = pubkey_policy_address(&Pubkey::new_unique(), &Pubkey::new_unique()).0;
        let subject = Pubkey::new_unique();
        let address = subject_address(&policy, &subject).0;
        let mut lamports = 1;
        let mut data = [];
        let system = System::id();
        let info =
            AccountInfo::new(&address, false, false, &mut lamports, &mut data, &system, false);
        assert!(!is_blocked(&info, &policy, &subject, &ID, PubkeyPolicyMode::Blacklist).unwrap());
        assert!(is_blocked(&info, &policy, &subject, &ID, PubkeyPolicyMode::Whitelist).unwrap());
        assert_eq!(
            is_blocked(&info, &policy, &Pubkey::new_unique(), &ID, PubkeyPolicyMode::Open)
                .unwrap_err(),
            error!(PolicyError::WrongRecord)
        );
        let other = Pubkey::new_unique();
        let info =
            AccountInfo::new(&address, false, false, &mut lamports, &mut data, &other, false);
        assert_eq!(
            is_blocked(&info, &policy, &subject, &ID, PubkeyPolicyMode::Open).unwrap_err(),
            error!(PolicyError::WrongOwner)
        );
    }

    #[test]
    fn records_are_policy_scoped_and_typed() {
        let policy = pubkey_policy_address(&Pubkey::new_unique(), &Pubkey::new_unique()).0;
        let other_policy = pubkey_policy_address(&Pubkey::new_unique(), &Pubkey::new_unique()).0;
        let subject = Pubkey::new_unique();
        let address = subject_address(&policy, &subject).0;
        let blacklisted = Membership { blacklisted: true, whitelisted: false };
        let read = |key: &Pubkey, mut data: Vec<u8>| {
            let mut lamports = 1;
            let info = AccountInfo::new(key, false, false, &mut lamports, &mut data, &ID, false);
            is_blocked(&info, &policy, &subject, &ID, PubkeyPolicyMode::Blacklist)
        };
        let record = encoded(&SubjectRecord { policy, subject, membership: blacklisted });
        assert!(read(&address, record.clone()).unwrap());
        // Even a well-formed policy-program-owned record cannot cross policy scopes.
        assert_eq!(
            read(&subject_address(&other_policy, &subject).0, record.clone()).unwrap_err(),
            error!(PolicyError::WrongRecord)
        );
        // A record whose bits were all cleared answers exactly like an absent one.
        let cleared =
            encoded(&SubjectRecord { policy, subject, membership: Membership::default() });
        let whitelist = |data: Vec<u8>| {
            let (mut lamports, mut data) = (1, data);
            let info =
                AccountInfo::new(&address, false, false, &mut lamports, &mut data, &ID, false);
            is_blocked(&info, &policy, &subject, &ID, PubkeyPolicyMode::Whitelist)
        };
        assert!(whitelist(cleared).unwrap());
        let mut wrong_type = record;
        wrong_type[0] ^= 0xff;
        assert_eq!(read(&address, wrong_type).unwrap_err(), error!(PolicyError::InvalidRecord));
    }

    #[test]
    fn a_policy_under_another_program_is_read_through_that_program() {
        let program = Pubkey::new_unique();
        let (policy, subject) = (Pubkey::new_unique(), Pubkey::new_unique());
        let address = subject_address_in(&policy, &subject, &program).0;
        let membership = Membership { blacklisted: true, whitelisted: false };
        let mut data = encoded(&SubjectRecord { policy, subject, membership });
        let mut lamports = 1;
        let info =
            AccountInfo::new(&address, false, false, &mut lamports, &mut data, &program, false);
        assert!(
            is_blocked(&info, &policy, &subject, &program, PubkeyPolicyMode::Blacklist).unwrap()
        );
        // The same record is foreign to this crate's own program.
        assert_eq!(
            is_blocked(&info, &policy, &subject, &ID, PubkeyPolicyMode::Blacklist).unwrap_err(),
            error!(PolicyError::WrongRecord)
        );
    }

    fn policy_data(mint: Pubkey, mode: PubkeyPolicyMode) -> Vec<u8> {
        let mut data = Vec::new();
        PubkeyPolicy {
            mint,
            current_default_admin: Pubkey::new_unique(),
            pending_default_admin: Pubkey::default(),
            mode,
        }
        .try_serialize(&mut data)
        .unwrap();
        data
    }

    /// The program records must live under comes from the policy account's owner, so a policy
    /// that was not created yet, or one another program owns, can never read as "no records".
    #[test]
    fn read_takes_the_program_from_the_policy_and_rejects_an_uncreated_one() {
        let (mint, subject) = (Pubkey::new_unique(), Pubkey::new_unique());
        let policy = pubkey_policy_address(&mint, &Pubkey::new_unique()).0;
        let record = subject_address(&policy, &subject).0;
        let read = |owner: Pubkey, data: Vec<u8>| {
            let (mut policy_lamports, mut policy_data) = (1, data);
            let (mut record_lamports, mut record_data): (u64, Vec<u8>) = (1, vec![]);
            let system = System::id();
            let policy_info = AccountInfo::new(
                &policy,
                false,
                false,
                &mut policy_lamports,
                &mut policy_data,
                &owner,
                false,
            );
            let record_info = AccountInfo::new(
                &record,
                false,
                false,
                &mut record_lamports,
                &mut record_data,
                &system,
                false,
            );
            ValidatedPubkeyPolicy::read(&policy_info, &record_info, &subject)
        };

        let validated = read(ID, policy_data(mint, PubkeyPolicyMode::Whitelist)).unwrap();
        assert_eq!((validated.mint(), validated.record()), (mint, record));
        assert!(validated.is_blocked(), "an absent record is not whitelisted");
        // Not created yet: the System Program owns an empty account.
        assert_eq!(
            read(System::id(), vec![]).unwrap_err(),
            error!(ErrorCode::AccountDiscriminatorNotFound)
        );
        let mut wrong_type = policy_data(mint, PubkeyPolicyMode::Open);
        wrong_type[0] ^= 0xff;
        assert_eq!(
            read(ID, wrong_type).unwrap_err(),
            error!(ErrorCode::AccountDiscriminatorMismatch)
        );
        // Another program's policy: its records live under that program, not this record's.
        assert_eq!(
            read(Pubkey::new_unique(), policy_data(mint, PubkeyPolicyMode::Open)).unwrap_err(),
            error!(PolicyError::WrongRecord)
        );
    }
}
