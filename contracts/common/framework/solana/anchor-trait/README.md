# Anchor Trait

## Overview

The Anchor framework provides no mechanism for defining or enforcing instruction-level interfaces across programs. When a standard requires a set of instructions — e.g., every OApp program must expose `set_peer` and `lz_receive` with specific signatures — there is no compile-time guarantee that a conforming program provides them all, uses the correct parameter types, or returns the expected types. Violations surface only at runtime, typically as CPI failures or deserialization errors.

`anchor-trait` introduces **instruction traits** to Anchor: compile-time enforceable instruction interfaces with optional default implementations. A trait author declares an instruction set — each instruction's parameter type, return type, and whether a default implementation is provided — and the framework ensures, during proc-macro expansion, that every implementing program satisfies the trait contract. Missing required instructions produce compile errors. View instructions additionally enforce **compile-time immutability**: handlers receive `&Context<T>` (not `&mut`), so read-only semantics are upheld by the type system rather than relying solely on Solana runtime protections.

The framework is domain-agnostic. It operates purely at the instruction-signature and accounts-struct level, with no knowledge of any specific application domain. Macro crates such as `oapp-macros` or `rbac-macros` integrate with `anchor-trait` to define their own domain-specific instruction traits.

### Correspondence to Rust traits

| Rust trait                                     | `anchor-trait`                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Required method (no default body)              | Instruction with `default_impl: None` — implementor must provide a handler                                |
| Default method (has body)                      | Instruction with `default_impl: Some(...)` — framework provides a complete implementation                 |
| `impl Trait for Type`                          | Applying the domain macro to a module (e.g., `#[oapp(...)] mod my_program { ... }`)                       |
| Overriding a default method                    | Annotating a handler with `#[oapp_instruction]` — the handler's `Context<T>` determines the accounts type |
| Compile error on unimplemented required method | Compile error on missing required instruction handler                                                     |

## Instruction Kinds

Each instruction in a trait is classified as one of two kinds:

**Required** — The trait provides no default implementation. The implementor must supply a handler annotated with the override attribute; omitting it produces a compile error. This is analogous to a required method in a Rust trait.

```rust
InstructionSpec {
    params_type: Some(quote!(LzReceiveParams)),
    return_type: quote!(()),
    is_view: false,
    default_impl: None,
}
```

**Provided** — The trait supplies a complete default implementation: an accounts struct and a handler `impl`. Both are emitted unconditionally. This is analogous to a default method in a Rust trait.

```rust
InstructionSpec {
    params_type: Some(quote!(SetPeerParams)),
    return_type: quote!(()),
    is_view: false,
    default_impl: Some(DefaultImpl {
        handler_ident: format_ident!("apply"),
        generator: generate_default_impl,
    }),
}
```

## Overriding Instructions

For provided instructions, the implementor may accept the default or supply a custom handler annotated with the override attribute (e.g., `#[oapp_instruction]`). The handler's `Context<T>` type determines the entrypoint's accounts type:

- To **reuse** the default accounts struct, declare `Context<StdSetPeer>`.
- To use **custom** accounts, declare `Context<MyCustomAccounts>`.

The framework does not distinguish between these cases — both the default struct and its `apply` impl are always emitted, so an override handler can reuse the default by calling `<accounts>::apply(ctx, params)?`. For example, with `Context<StdSetPeer>` the override can run `StdSetPeer::apply(ctx, params)?` before or after its own logic.

For required instructions, no default exists. The implementor must provide a handler.

### Resolution algorithm

1. **Handler present** → dispatch to the handler (entrypoint uses the handler's declared context type)
2. **No handler, default exists** → dispatch to the default handler
3. **No handler, no default** → compile error

Unannotated functions whose identifiers collide with managed instruction names are rejected at compile time. Such functions must be annotated with the override attribute (e.g. `#[oapp_instruction]`) to disambiguate intent.

## When to Define a Trait

A trait built on `anchor-trait` exists to serve one or both of two motivations. Use this section to decide whether your work warrants a new trait, or whether a lighter mechanism (program-local handlers, plain macros, a direct dependency) would suffice.

### Motivation 1: Shared Default Behavior with Override

> Analogous to Solidity's `abstract contract` — a partial implementation that downstream contracts inherit and selectively override.

Multiple programs are expected to implement the same set of instructions, and the trait author wants to ship a default implementation that each program can adopt as-is or override per-instruction. Without a trait, every program copies the same handlers; as the standard evolves, the copies drift silently because no central authority enforces signature consistency.

A trait satisfies this motivation by exposing default implementations (provided instructions) that implementors consume through the override resolution algorithm. The framework enforces at compile time that every implementor either accepts the default or supplies a handler whose signature matches the trait declaration — drift can no longer happen silently.

### Motivation 2: Compile-Time-Enforced Surface for External Callers

> Analogous to Solidity's `interface` — a signature-only contract that every implementation must conform to.

External callers — off-chain clients such as generic SDKs, wallets, indexers, and explorers, or other on-chain programs invoking via CPI — require a stable and predictable surface across all implementations of the standard. Every implementor must honour the same instruction signatures, account layouts, and PDA seed conventions so that one generic caller can target any deployment.

A trait satisfies this motivation by publishing a canonical instruction surface — parameter types, return types, account layouts, view-ness, and seed constants — that the framework enforces at compile time. A non-conforming implementor produces a build-time error rather than a runtime CPI failure or a silently-broken SDK call.

### Three Combination Scenarios

| Reusability | Composability | Recommendation                                                                                                                                                                                      |
| ----------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Yes         | Yes           | Define a trait. Default implementations and the published interface come from a single source of truth. Most traits in this codebase fall here.                                                     |
| Yes         | No            | Define a trait. Provided instructions and override resolution still apply; the published interface is consumed by implementors themselves rather than by external callers.                          |
| No          | Yes           | Define a trait with all instructions marked required (`default_impl: None`). The value lies in compile-time enforcement of signatures and account layouts; no default behaviour needs to be shared. |

If neither motivation applies, do not define a trait. There is no reuse to factor out and no interface to standardise; use program-local code or macros directly.

## Defining a Trait

The following steps describe how to create a new instruction trait using the framework.

### 1. Define a codegen context

The codegen context is a struct that carries domain-specific resolved types and is threaded through every instruction generator:

```rust
pub(crate) struct CodegenContext<'a> {
    pub role_type: &'a TokenStream,
    pub state_type: &'a TokenStream,
    // additional domain-specific fields
}
```

### 2. Declare the instruction set

The `declare_instructions!` macro enumerates all instructions in the trait. It generates:

- Sub-module declarations (`mod set_peer;`, `mod get_peer;`)
- A named enum implementing `InstructionSet` with `all()`, `from_ident()`, `canonical_name()`, and `spec()`

```rust
use anchor_trait::declare_instructions;

declare_instructions! {
    name    = OAppInstructionSet;
    context = CodegenContext;

    SetPeer    => set_peer,
    GetPeer    => get_peer,
}
```

### 3. Define per-instruction specs

Each sub-module exports a `spec()` function returning an `InstructionSpec<CodegenContext>` that describes the instruction's signature and default implementation status:

```rust
// Provided instruction — implementor may accept the default or override:
pub(super) fn spec<'a>() -> InstructionSpec<CodegenContext<'a>> {
    InstructionSpec {
        params_type: Some(quote!(::my_crate::params::SetPeerParams)),
        return_type: quote!(()),
        is_view: false,
        default_impl: Some(DefaultImpl {
            handler_ident: format_ident!("apply"),
            generator: generate_default_impl,
        }),
    }
}

fn generate_default_impl(
    ctx: &CodegenContext<'_>,
    spec: &InstructionSpec<CodegenContext<'_>>,
) -> DefaultAccounts {
    let params_type = spec.params_type.as_ref().unwrap();
    let handler_ident = &spec.default_impl.as_ref().unwrap().handler_ident;

    // Return complete struct + impl — the framework emits as-is and decomposes for the extend arm
    DefaultAccounts {
        struct_type: parse_quote! {
            #[event_cpi]
            #[derive(Accounts)]
            #[instruction(params: #params_type)]
            pub struct StdSetPeer<'info> {
                pub authority: Signer<'info>,
                // ... additional fields ...
            }
        },
        impl_block: parse_quote! {
            impl StdSetPeer<'_> {
                pub fn #handler_ident(ctx: &mut Context<Self>, params: &#params_type) -> Result<()> {
                    // ... default handler logic ...
                    Ok(())
                }
            }
        },
    }
}

// Required instruction — implementor must provide a handler:
pub(super) fn spec<'a>() -> InstructionSpec<CodegenContext<'a>> {
    InstructionSpec {
        params_type: Some(quote!(::my_crate::params::LzReceiveParams)),
        return_type: quote!(()),
        is_view: false,
        default_impl: None,
    }
}
```

### 4. Configure the override attribute

```rust
const OVERRIDE_CONFIG: OverrideConfig = OverrideConfig {
    attr_name: "oapp_instruction",  // attribute written by implementors
    domain: "OApp",                 // label used in diagnostics
};
```

### 5. Implement the macro entry point

The entry point follows a four-phase pipeline: **parse → collect → generate → assemble**.

```rust
pub fn my_macro_impl(attr: TokenStream, item: TokenStream) -> syn::Result<TokenStream> {
    // Phase 0: Parse inputs (domain-specific; outside the framework's scope)
    let attr_args = NestedMeta::parse_meta_list(attr)?;
    let attrs = MyDomainAttr::from_list(&attr_args)?;
    let module = syn::parse2::<ItemMod>(item)?;
    let codegen_ctx = /* resolve domain types from attrs */;

    // Phase 1: Collect — scan for override handlers
    let overrides = InstructionOverrides::collect(&module, OVERRIDE_CONFIG)?;

    // Phase 2: Generate — emit instruction code
    let instructions = generate_instructions::<MyInstructionSet>(&codegen_ctx, &overrides)?;

    // Phase 3: Assemble — combine all generated fragments into the final output
    Ok(Assembly {
        prelude: /* domain-specific definitions */,
        overrides,
        instructions,
        extra_mod_attrs: /* e.g. quote!(#[program]) */,
        source_mod: module,
        extend_macro_name: Some(format_ident!("my_domain_extend_accounts")),
    }
    .assemble())
}
```

### Assembly output structure

```text
<prelude>              — domain-specific definitions (emitted by the macro crate)
<default_impls>        — generated default accounts structs + handler impls
<extend_macro>         — macro_rules! for extending default accounts (if configured)
<original_outer_attrs> — preserved outer module attributes
<extra_mod_attrs>      — additional attributes (e.g., #[program])
                       — any outer attr whose last path segment is `program`
                         is stripped from the input and re-emitted here
[vis] mod <name> {
    <original_inner_attrs> — preserved inner module attributes
    use super::*;
    <filtered_items>   — original module items, excluding relocated handlers
    <wrapper_defs>     — relocated override handler modules (kept inside so handlers
                         can reach the user's nested same-module helpers)
    <entrypoints>      — generated instruction entrypoints
}
```

## Extending Default Accounts

For provided instructions, the framework generates a `macro_rules!` (named via `Assembly::extend_macro_name`) that lets users create extended accounts structs — the default fields plus extra accounts — without duplicating the base implementation. **Extension is additive**: the default struct and its `apply` impl remain emitted alongside any extended struct (see [How it works](#how-it-works)). For example, defining `ExtSetPeer` does not replace or hide `StdSetPeer`.

### Usage

The extend macro must be invoked **after** the domain macro module in the source file:

```rust
#[my_domain(state = MyState)]
pub mod my_program {
    #[my_domain_instruction]
    pub fn set_peer(ctx: &mut Context<ExtSetPeer>, params: &SetPeerParams) -> Result<()> {
        ExtSetPeer::apply(ctx, params)?;       // default handler, copied to extended struct
        ctx.accounts.my_extra.do_something()?;  // extra account
        Ok(())
    }
}

// Must appear after the domain macro module (macro_rules! is textually scoped).
// Rust item name resolution is NOT order-dependent, so ExtSetPeer is visible above.
my_domain_extend_accounts!(set_peer, ExtSetPeer, {
    pub my_extra: Account<'info, MyExtraState>,
});
```

### How it works

Each provided instruction's `DefaultAccounts` produces two outputs: the concrete `Std*` struct (via `to_definition()`, which emits the `ItemStruct` and `ItemImpl` as-is) and a `macro_rules!` arm (via `to_extend_rule()`, which decomposes the struct into attrs/fields, replaces the name with `$name`, and appends `$($extra)*`). The arm also re-emits the default's `impl` items, so the extended struct gets an independent copy of `apply` — e.g., `ExtSetPeer::apply` is a parallel method, not a re-export of `StdSetPeer::apply`. `Assembly` collects all arms into one `macro_rules!` named by `extend_macro_name`.

## Reference

### Naming conventions

| Item                    | Convention                   | Example                        |
| ----------------------- | ---------------------------- | ------------------------------ |
| Default accounts struct | `Std<PascalCaseInstruction>` | `StdSetPeer`                   |
| Override attribute      | `<domain>_instruction`       | `oapp_instruction`             |
| Params type             | Fully qualified path         | `::oapp::types::SetPeerParams` |

### InstructionSpec fields

| Field          | Type                       | Description                                                                                                                                                                                       |
| -------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `params_type`  | `Option<TokenStream>`      | Parameter type for the generated entrypoint. Must be a single struct type (e.g., `SetPeerParams`); multiple parameters are not supported. `None` indicates the instruction accepts no parameters. |
| `return_type`  | `TokenStream`              | Return type of the generated entrypoint (the `T` in `Result<T>`).                                                                                                                                 |
| `is_view`      | `bool`                     | When `true`, the entrypoint receives `ctx: Context<T>` (immutable) and passes `&ctx` to the handler. When `false`, it receives `mut ctx: Context<T>` and passes `&mut ctx`.                       |
| `default_impl` | `Option<DefaultImpl<Ctx>>` | `Some(...)` designates a provided instruction with a default implementation. `None` designates a required instruction; the implementor must supply a handler.                                     |

### DefaultImpl fields

| Field           | Type                                                 | Description                                                                                                                                                                                         |
| --------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handler_ident` | `Ident`                                              | Identifier of the default handler method (e.g., `apply`). When no override is present, the entrypoint invokes `<accounts_ident>::<handler_ident>(...)`.                                             |
| `generator`     | `fn(&Ctx, &InstructionSpec<Ctx>) -> DefaultAccounts` | Returns a `DefaultAccounts` containing a complete `ItemStruct` and `ItemImpl`. The framework emits them directly for the concrete definition and decomposes them for the extend `macro_rules!` arm. |

### DefaultAccounts fields

| Field         | Type         | Description                                                                                                                                                                                                                                    |
| ------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `struct_type` | `ItemStruct` | A complete accounts struct definition including attributes, name, generics, and fields. Written with `parse_quote!` so generators read as plain Rust. The struct name becomes the `accounts_ident` (e.g. `StdSetPeer`).                        |
| `impl_block`  | `ItemImpl`   | A complete `impl` block for the struct, containing handler methods. Written with `parse_quote!` so generators read as plain Rust. Handler methods must use `Context<Self>` so they work for both the concrete struct and any extended variant. |

### Default accounts struct

Each `DefaultAccounts` returned by a generator must satisfy the following:

- `struct_type` must be a named-field struct with a `<'info>` lifetime parameter (the standard Anchor accounts lifetime)
- `struct_type` must carry the standard Anchor attributes (e.g. `#[derive(Accounts)]`) — these are preserved as-is in `to_definition()` and re-emitted by `to_extend_rule()`
- `impl_block` must define a handler method matching `handler_ident` with one of the following signatures:
    - Mutable: `fn apply(ctx: &mut Context<Self>, params: &ParamsType) -> Result<ReturnType>`
    - View: `fn apply(ctx: &Context<Self>, params: &ParamsType) -> Result<ReturnType>`
    - Omit the `params` parameter when `params_type` is `None`
- Handler methods must use `Context<Self>` (not a concrete struct name) so they work for both the concrete `Std*` struct and any extended variant
- The struct is emitted **outside** the `#[program]` module

### Entrypoint signatures

```rust
// Mutable instruction with parameters:
pub fn set_peer(mut ctx: Context<CtxType>, params: ParamsType) -> Result<ReturnType> { ... }

// View instruction with parameters:
pub fn get_peer(ctx: Context<CtxType>, params: ParamsType) -> Result<ReturnType> { ... }

// Instruction without parameters:
pub fn set_delegate(mut ctx: Context<CtxType>) -> Result<()> { ... }
```

### Dispatch

| Scenario         | `CtxType`              | Dispatch (with params)                    | Dispatch (no params)             |
| ---------------- | ---------------------- | ----------------------------------------- | -------------------------------- |
| No handler       | `StdSetPeer`           | `StdSetPeer::apply(&mut ctx, &params)`    | `StdSetPeer::apply(&mut ctx)`    |
| Handler provided | handler's declared `T` | `__wrapper__::handler(&mut ctx, &params)` | `__wrapper__::handler(&mut ctx)` |

- All handlers receive `ctx` by reference (`&mut` for mutable, `&` for views) and `params` by reference. `__wrapper__` denotes the relocated wrapper module (e.g., `__oapp_instruction__set_peer_handler`).
- For view instructions, `&mut` becomes `&` in the dispatch expressions above.
- Override handlers that pass `ctx` by value (`Context<T>` instead of `&Context<T>` or `&mut Context<T>`) are rejected at compile time.
