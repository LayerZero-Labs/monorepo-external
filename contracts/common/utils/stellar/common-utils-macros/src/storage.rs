//! Storage macro implementation for Stellar smart contracts.
//!
//! Generates strongly-typed storage API from enum variants with automatic TTL management.

use heck::ToSnakeCase;
use itertools::Itertools;
use proc_macro2::{Ident, TokenStream};
use quote::{format_ident, quote};
use syn::{Attribute, Expr, Fields, FieldsNamed, Meta, Type, Variant};

// ============================================================================
// Public API
// ============================================================================

/// Generates the storage API from the `#[storage]` attribute macro.
pub fn generate_storage(input: TokenStream) -> TokenStream {
    let item_enum: syn::ItemEnum = syn::parse2(input).unwrap_or_else(|e| panic!("failed to parse enum: {}", e));
    let enum_name = &item_enum.ident;
    let vis = &item_enum.vis;

    let variants: Vec<_> = item_enum.variants.iter().map(gen_enum_variant).collect();
    let methods: Vec<_> = item_enum.variants.iter().map(|v| gen_accessor_methods(enum_name, v)).collect();

    quote! {
        #[soroban_sdk::contracttype]
        #vis enum #enum_name { #(#variants,)* }

        impl #enum_name { #(#methods)* }
    }
}

// ============================================================================
// Types
// ============================================================================

/// Storage kind: instance, persistent, or temporary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StorageKind {
    Instance,
    Persistent,
    Temporary,
}

impl StorageKind {
    fn name(self) -> &'static str {
        match self {
            Self::Instance => "instance",
            Self::Persistent => "persistent",
            Self::Temporary => "temporary",
        }
    }

    /// Generates `env.storage().{kind}()`.
    fn accessor(self) -> TokenStream {
        let method = format_ident!("{}", self.name());
        quote! { env.storage().#method() }
    }
}

/// Parsed configuration for a storage enum variant.
#[derive(Debug, Clone)]
struct VariantConfig {
    name: String,
    kind: StorageKind,
    value_type: Type,
    default_value: Option<Expr>,
    auto_ttl: bool,
}

impl VariantConfig {
    /// Returns (getter, setter, remover, set_or_remove, has, ttl_extender) function names.
    fn method_names(&self) -> (Ident, Ident, Ident, Ident, Ident, Ident) {
        let base = &self.name;
        (
            format_ident!("{}", base),
            format_ident!("set_{}", base),
            format_ident!("remove_{}", base),
            format_ident!("set_or_remove_{}", base),
            format_ident!("has_{}", base),
            format_ident!("extend_{}_ttl", base),
        )
    }
}

// ============================================================================
// Enum Variant Code Generation
// ============================================================================

/// Generates contracttype enum variant: `Variant` or `Variant(Type1, Type2, ...)`.
fn gen_enum_variant(variant: &Variant) -> TokenStream {
    let name = &variant.ident;
    match &variant.fields {
        Fields::Unit => quote! { #name },
        Fields::Named(FieldsNamed { named, .. }) => {
            let types = named.iter().map(|f| &f.ty);
            quote! { #name(#(#types),*) }
        }
        _ => panic!("only unit variants or named fields are supported in storage enums"),
    }
}

/// Generates all storage accessor methods for a variant.
fn gen_accessor_methods(enum_name: &Ident, variant: &Variant) -> TokenStream {
    let config = VariantConfig::try_from(variant)
        .unwrap_or_else(|e| panic!("failed to parse storage variant for {}: {}", variant.ident, e));

    let (getter, setter, remover, set_or_remove, has, ttl_extender) = config.method_names();
    let params = gen_params(variant);
    let args = gen_args(variant);
    let key = gen_key(enum_name, variant);
    let accessor = config.kind.accessor();
    let value_type = &config.value_type;

    // Auto TTL extension call — emitted after reads/writes for persistent storage.
    // `Option<TokenStream>` integrates directly with `quote!` (None emits nothing).
    let extend_ttl = config.auto_ttl.then(|| {
        quote! { utils::ttl_configurable::extend_persistent_ttl(env, &key); }
    });

    // Getter: returns the value directly (with default) or wrapped in Option.
    let (ret_type, ret_expr) = match &config.default_value {
        Some(default) => (quote! { #value_type }, quote! { value.unwrap_or_else(|| #default) }),
        None => (quote! { Option<#value_type> }, quote! { value }),
    };
    let ttl_on_get = extend_ttl.as_ref().map(|call| quote! { if value.is_some() { #call } });

    // Has: conditionally extend TTL when key exists.
    let has_body = match &extend_ttl {
        Some(call) => quote! { let exists = #accessor.has(&key); if exists { #call } exists },
        None => quote! { #accessor.has(&key) },
    };

    // TTL extender method — only for persistent/temporary storage (instance has no per-key TTL).
    let ttl_extender_method = (config.kind != StorageKind::Instance).then(|| {
        quote! {
            pub fn #ttl_extender(#params, threshold: u32, extend_to: u32) {
                let key = #key;
                #accessor.extend_ttl(&key, threshold, extend_to);
            }
        }
    });

    quote! {
        pub fn #getter(#params) -> #ret_type {
            let key = #key;
            let value = #accessor.get::<_, #value_type>(&key);
            #ttl_on_get
            #ret_expr
        }

        pub fn #setter(#params, value: &#value_type) {
            let key = #key;
            #accessor.set(&key, value);
            #extend_ttl
        }

        pub fn #remover(#params) {
            let key = #key;
            #accessor.remove(&key);
        }

        pub fn #set_or_remove(#params, value: &Option<#value_type>) {
            match value.as_ref() {
                Some(v) => Self::#setter(#args, v),
                None => Self::#remover(#args),
            }
        }

        pub fn #has(#params) -> bool {
            let key = #key;
            #has_body
        }

        #ttl_extender_method
    }
}

// ============================================================================
// Parameter & Key Generation Helpers
// ============================================================================

/// Extracts (name, type) pairs from variant fields.
fn extract_fields(variant: &Variant) -> Vec<(&Ident, &Type)> {
    match &variant.fields {
        Fields::Unit => vec![],
        Fields::Named(named) => named.named.iter().map(|f| (f.ident.as_ref().unwrap(), &f.ty)).collect(),
        _ => panic!("only unit variants or named fields are supported in storage enums"),
    }
}

/// Generates function parameters: `env: &Env` or `env: &Env, field1: Type1, ...`.
fn gen_params(variant: &Variant) -> TokenStream {
    let fields = extract_fields(variant);
    if fields.is_empty() {
        quote! { env: &soroban_sdk::Env }
    } else {
        let params = fields.iter().map(|(name, ty)| {
            if is_primitive_type(ty) {
                quote! { #name: #ty }
            } else {
                quote! { #name: &#ty }
            }
        });
        quote! { env: &soroban_sdk::Env, #(#params),* }
    }
}

/// Generates function arguments: `env` or `env, field1, field2, ...`.
fn gen_args(variant: &Variant) -> TokenStream {
    let fields = extract_fields(variant);
    if fields.is_empty() {
        quote! { env }
    } else {
        let names = fields.iter().map(|(name, _)| name);
        quote! { env, #(#names),* }
    }
}

/// Generates storage key: `Enum::Variant` or `Enum::Variant(field1.clone(), ...)`.
fn gen_key(enum_name: &Ident, variant: &Variant) -> TokenStream {
    let variant_ident = &variant.ident;
    let fields = extract_fields(variant);

    if fields.is_empty() {
        quote! { #enum_name::#variant_ident }
    } else {
        let args = fields.iter().map(|(name, ty)| {
            if is_primitive_type(ty) {
                quote! { #name }
            } else {
                quote! { #name.clone() }
            }
        });
        quote! { #enum_name::#variant_ident(#(#args),*) }
    }
}

/// Checks if a type is a primitive (pass-by-value) type.
fn is_primitive_type(ty: &Type) -> bool {
    // https://developers.stellar.org/docs/learn/fundamentals/contract-development/types/built-in-types#primitive-types
    const PRIMITIVES: &[&str] = &["u32", "i32", "u64", "i64", "u128", "i128", "bool"];
    matches!(ty, Type::Path(p) if p.path.segments.len() == 1
        && PRIMITIVES.contains(&p.path.segments[0].ident.to_string().as_str()))
}

// ============================================================================
// Attribute Parsing
// ============================================================================

/// Known attributes for storage variants ("doc" allows /// comments).
const KNOWN_ATTRS: &[&str] = &["doc", "instance", "persistent", "temporary", "default", "name", "no_ttl_extension"];

impl TryFrom<&Variant> for VariantConfig {
    type Error = String;

    fn try_from(variant: &Variant) -> Result<Self, Self::Error> {
        let attrs = &variant.attrs;
        validate_attrs(attrs, &variant.ident)?;

        let (kind, value_type) = parse_storage_type(attrs)?;
        let default_value = parse_default(attrs)?;
        let name = parse_name(attrs)?.unwrap_or_else(|| variant.ident.to_string().to_snake_case());
        let no_ttl_extension = parse_no_ttl_extension(attrs)?;

        if no_ttl_extension && kind != StorageKind::Persistent {
            return Err("#[no_ttl_extension] can only be used with #[persistent(...)] storage".to_string());
        }

        Ok(Self {
            name,
            kind,
            value_type,
            default_value,
            auto_ttl: kind == StorageKind::Persistent && !no_ttl_extension,
        })
    }
}

fn validate_attrs(attrs: &[Attribute], variant_ident: &Ident) -> Result<(), String> {
    for attr in attrs {
        let path = attr.path();
        let name = path.get_ident().map(|i| i.to_string()).unwrap_or_else(|| quote!(#path).to_string());

        if !KNOWN_ATTRS.contains(&name.as_str()) {
            return Err(format!(
                "unknown attribute '{}' on variant '{}'. Supported attributes are: {}",
                name,
                variant_ident,
                KNOWN_ATTRS.join(", ")
            ));
        }
    }
    Ok(())
}

fn parse_storage_type(attrs: &[Attribute]) -> Result<(StorageKind, Type), String> {
    attrs
        .iter()
        .filter_map(|attr| {
            let ident = attr.path().get_ident()?;
            let kind = match ident.to_string().as_str() {
                "instance" => StorageKind::Instance,
                "persistent" => StorageKind::Persistent,
                "temporary" => StorageKind::Temporary,
                _ => return None,
            };
            let value_type = attr
                .parse_args::<Type>()
                .unwrap_or_else(|e| panic!("failed to parse storage type for #[{}(...)] : {}", ident, e));
            Some((kind, value_type))
        })
        .exactly_one()
        .map_err(|e| {
            format!(
                "storage type must be specified exactly once as \
                 '#[instance(Type)]', '#[persistent(Type)]', or '#[temporary(Type)]': {}",
                e
            )
        })
}

fn parse_default(attrs: &[Attribute]) -> Result<Option<Expr>, String> {
    attrs
        .iter()
        .filter(|attr| attr.path().is_ident("default"))
        .at_most_one()
        .map_err(|e| format!("multiple default values specified: {}", e))?
        .map(|attr| attr.parse_args::<Expr>())
        .transpose()
        .map_err(|e| format!("failed to parse default value: {}", e))
}

fn parse_name(attrs: &[Attribute]) -> Result<Option<String>, String> {
    attrs
        .iter()
        .filter(|attr| attr.path().is_ident("name"))
        .at_most_one()
        .map_err(|e| format!("multiple name attributes specified: {}", e))?
        .map(|attr| attr.parse_args::<syn::LitStr>().map(|lit| lit.value()))
        .transpose()
        .map_err(|e| format!("failed to parse name attribute: {}", e))
}

fn parse_no_ttl_extension(attrs: &[Attribute]) -> Result<bool, String> {
    let attr = attrs
        .iter()
        .filter(|attr| attr.path().is_ident("no_ttl_extension"))
        .at_most_one()
        .map_err(|e| format!("multiple #[no_ttl_extension] attributes specified: {}", e))?;

    // Reject `#[no_ttl_extension(...)]` / `#[no_ttl_extension = ...]`
    match attr {
        None => Ok(false),
        Some(attr) if matches!(attr.meta, Meta::Path(_)) => Ok(true),
        Some(_) => Err("#[no_ttl_extension] does not accept arguments".to_string()),
    }
}

// ============================================================================
// Test-only Functions
// ============================================================================

#[cfg(test)]
pub(crate) mod test {
    use super::*;

    // ========================================================================
    // VariantConfigInfo - wrapper struct for test access
    // ========================================================================

    /// Test-only wrapper struct exposing VariantConfig data without exposing the type.
    #[derive(Debug, Clone)]
    pub struct VariantConfigInfo {
        pub name: String,
        pub kind_name: String,
        pub value_type: String,
        pub has_default: bool,
        pub auto_ttl: bool,
    }

    // ========================================================================
    // StorageKind wrapper functions
    // ========================================================================

    /// Returns the name for Instance storage kind.
    pub fn storage_kind_instance_name() -> &'static str {
        StorageKind::Instance.name()
    }

    /// Returns the name for Persistent storage kind.
    pub fn storage_kind_persistent_name() -> &'static str {
        StorageKind::Persistent.name()
    }

    /// Returns the name for Temporary storage kind.
    pub fn storage_kind_temporary_name() -> &'static str {
        StorageKind::Temporary.name()
    }

    /// Returns the accessor TokenStream for Instance storage kind.
    pub fn storage_kind_instance_accessor() -> TokenStream {
        StorageKind::Instance.accessor()
    }

    /// Returns the accessor TokenStream for Persistent storage kind.
    pub fn storage_kind_persistent_accessor() -> TokenStream {
        StorageKind::Persistent.accessor()
    }

    /// Returns the accessor TokenStream for Temporary storage kind.
    pub fn storage_kind_temporary_accessor() -> TokenStream {
        StorageKind::Temporary.accessor()
    }

    // ========================================================================
    // VariantConfig wrapper functions
    // ========================================================================

    /// Gets VariantConfig info from a Variant.
    pub fn get_variant_config_for_test(variant: &Variant) -> Result<VariantConfigInfo, String> {
        VariantConfig::try_from(variant).map(|c| {
            let value_type = c.value_type;
            VariantConfigInfo {
                name: c.name,
                kind_name: c.kind.name().to_string(),
                value_type: quote!(#value_type).to_string(),
                has_default: c.default_value.is_some(),
                auto_ttl: c.auto_ttl,
            }
        })
    }

    /// Gets method names from a Variant as strings.
    pub fn get_variant_method_names_for_test(
        variant: &Variant,
    ) -> Result<(String, String, String, String, String, String), String> {
        VariantConfig::try_from(variant).map(|c| {
            let (getter, setter, remover, set_or_remove, has, ttl_extender) = c.method_names();
            (
                getter.to_string(),
                setter.to_string(),
                remover.to_string(),
                set_or_remove.to_string(),
                has.to_string(),
                ttl_extender.to_string(),
            )
        })
    }

    // ========================================================================
    // parse_storage_type wrapper - returns kind name instead of enum
    // ========================================================================

    /// Test-only wrapper for parse_storage_type that returns kind name as string.
    pub fn parse_storage_type_for_test(attrs: &[Attribute]) -> Result<(String, Type), String> {
        parse_storage_type(attrs).map(|(kind, ty)| (kind.name().to_string(), ty))
    }

    // ========================================================================
    // Other wrapper functions
    // ========================================================================

    /// Test-only wrapper for is_primitive_type.
    pub fn is_primitive_type_for_test(ty: &Type) -> bool {
        is_primitive_type(ty)
    }

    /// Test-only wrapper for extract_fields.
    pub fn extract_fields_for_test(variant: &Variant) -> Vec<(&Ident, &Type)> {
        extract_fields(variant)
    }

    /// Test-only wrapper for gen_params.
    pub fn gen_params_for_test(variant: &Variant) -> TokenStream {
        gen_params(variant)
    }

    /// Test-only wrapper for gen_args.
    pub fn gen_args_for_test(variant: &Variant) -> TokenStream {
        gen_args(variant)
    }

    /// Test-only wrapper for gen_key.
    pub fn gen_key_for_test(enum_name: &Ident, variant: &Variant) -> TokenStream {
        gen_key(enum_name, variant)
    }

    /// Test-only wrapper for gen_enum_variant.
    pub fn gen_enum_variant_for_test(variant: &Variant) -> TokenStream {
        gen_enum_variant(variant)
    }

    /// Test-only wrapper for gen_accessor_methods.
    pub fn gen_accessor_methods_for_test(enum_name: &Ident, variant: &Variant) -> TokenStream {
        gen_accessor_methods(enum_name, variant)
    }

    /// Test-only wrapper for validate_attrs.
    pub fn validate_attrs_for_test(attrs: &[Attribute], variant_ident: &Ident) -> Result<(), String> {
        validate_attrs(attrs, variant_ident)
    }

    /// Test-only wrapper for parse_default.
    pub fn parse_default_for_test(attrs: &[Attribute]) -> Result<Option<Expr>, String> {
        parse_default(attrs)
    }

    /// Test-only wrapper for parse_name.
    pub fn parse_name_for_test(attrs: &[Attribute]) -> Result<Option<String>, String> {
        parse_name(attrs)
    }

    /// Test-only wrapper for parse_no_ttl_extension.
    pub fn parse_no_ttl_extension_for_test(attrs: &[Attribute]) -> Result<bool, String> {
        parse_no_ttl_extension(attrs)
    }

    /// Returns the list of known attributes for testing.
    pub fn known_attrs_for_test() -> &'static [&'static str] {
        KNOWN_ATTRS
    }
}
