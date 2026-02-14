# EPv2-Starknet

## Local development

[asdf](https://asdf-vm.com/) - the multiple runtime version manager - is used to manage and install all your runtime versions. Based on `.tool-versions` you can fetch all the dependencies required via

```sh
asdf install
```

## Building

Everything is done from the `layerzero` directory

Install all dependencies

```sh
scarb fetch
```

Build the project (also install deps)

```sh
scarb build
```

## Running tests

Run all unit tests via

```sh
scarb test
```

## Linting/formatting

Lint/format all Cairo code via

```sh
scarb lint && scarb fmt
```
