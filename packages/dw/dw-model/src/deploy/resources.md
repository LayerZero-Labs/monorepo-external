# On the resource model

## Background

We started with a schema defining the config and another schema defining the
interface of the activity factory that deploys contracts.

The first problem with this is the duplication. The second problem with this is that you necessarily require
the workflow to be able to transform between these two schemata. For example, if deploying an OFT LUA requires
that we know the token address, the workflow must now have bespoke handling to inject this parameter into the activity factory.

From here, you make the optimization of treating config as source of truth, and having activity factories receive the config,
and additional arguments that they require and that are only known at workflow time/don't need to be in the config.

This, still, requires custom workflow for any ordering of dependencies, injecting of addresses, and does not provide any way
to compose the deployment of multiple contracts.

## Resources

Resources, then, are a generalization of this idea. A resource, at its most basic, is a configuration of a contract,
which can be `resolve()`d and passed to an activity factory to deploy. The resolution step is completely generic,
simply injecting its references to other resources.

## Resource registry

```typescript
resourceRegistry: (resourceId: string, resourceSubKey?: string) => RealID;
```

The resource registry is responsible for understanding the status of reification of your resources.
That is, the resource registry is the exclusive entity that holds the "address" of your "contracts".

"Address" here is not meant literally. Rather, it is a generalization, `RealID`. A RealID
is an identifier for a deployed resource. "Deployment" here is is not meant literally.
For example, pushing mesh resources to LZ metadata is a deployment. Deployment _is_, however,
whatever action creates the canonical identifier for the registry.

In summary,

```
config === resource
address === realID
```

Resource subkeys are suffixes that identify optional additional RealIDs associated with the same resource.
Neither `resourceId` nor `resourceSubKey` may contain `/` (composite keys use a single slash as the separator).
For example, an OFT may have a proxy, an implementation, and a proxy admin. One of these is the identity RealID:
whichever RealID identifies the semantic entity. For an OFT proxy, that is the contract that can `lzReceive`.
Therefore, this resource has

```
<resourceId> -> <realId> (proxy contract)
<resourceId/impl> -> <realId> (implementation contract)
<resourceId/proxy-admin> -> <realId> (proxy admin contract)
```

These additional realIds are _not_ identifiers for the resource, but are persisted for contexts in which they might be relevant.
For any consumer who is unaware of the context of proxies, the resource ID resolves to the identity RealID.

## Artifact registry

```
artifactRegistry: (resourceId, resourceSubKey?) => Artifact
```

Artifacts are metadata associated with some realId, keyed the same way as the resource
registry (`resourceId` + optional `resourceSubKey`).
For example,

- The time a contract was deployed
- The number of optimizers runs on that contract
- Whether a contract has been pushed to metadata

Each artifact is separate and identified by an `ArtifactType`.

## ResourceSet

```
resourceRegistry.getResourceSet(resourceId) => { address, subkeys }
```

A resource can have several RealIDs. `getResourceSet` is how a workflow asks for all of
them at once, instead of learning which subkey a particular activity needs.

`address` is the identity RealID key. `subkeys` is the rest (`impl`, `factory`,
`proxy-admin`, ...). Artifacts are not on this type.

The keys must already be NormalizedHex. Native encodings (Base58, etc.) are not decoded
on read.

### Subkeys for sibling contracts (sanctioned use)

Subkeys are normally different RealIDs of _one_ contract (proxy, implementation, proxy
admin). One sanctioned exception: a deploy that creates several sibling contracts as one
unit may store them as subkeys of the resource that owns the deploy. The protocol project
does this on Canton, where the EndpointV2 deploy creates the RequestFactory,
RequestFactoryConfig, Committer, DiscoveryRegistry and their access-control contracts
(`CANTON_ENDPOINT_ARTIFACT_SUBKEYS`) as EndpointV2 subkeys, and the Executor deploy writes
its Canton sub-contract under an Executor subkey. On Stellar, the Executor deploy writes the
Executor and its ExecutorHelper under `STELLAR_EXECUTOR_ARTIFACT_SUBKEYS`. Which subkeys exist
and what they mean is VM knowledge: at runtime only that VM's activity-factory impls read them
(through the ResourceSet they are specialized on), never workflows or planners. The protocol project's
one-off registry scripts (`seed-registry`, `export-address-snapshot`) also name them, to
import and export the legacy Canton deploymentInfo files; seed writes the EndpointV2
identity only when every subkey is present. The owning resource's
identity RealID is written by the deploy's last step (Canton EndpointV2: the vApp's static
EndpointV2 address, recorded with the DiscoveryRegistry deploy; Stellar Executor: the Executor's
address, recorded by SetExecutorHelper), so "identity in the
registry" still means "fully deployed", and a re-run after a partial deploy skips the
sub-contracts whose subkey artifacts already exist.

### Resources at a fixed address

A contract that is never deployed by the project but must be referenced (an external token,
or Canton's vApp contracts at their static addresses) is a resource built with
`withIntrinsicAddress`. Deploy skips it, references to it resolve to that address, and
`createResourceSetRegistry` returns it without reading the registry.

## Deployment flow

Topologically sort all resources in consideration, then sequentially map resource type -> factory.
Collect deployment transactions per factory, save RealID and optionally artifacts.
The sort fails on a reference to a resource outside the list (an ordering edge would be lost);
a resource that is already deployed or at a fixed address still belongs in the list.

## Wiring flow

For each resource in consideration, fetch its RealID (or ResourceSet when subkeys
are needed), specialize the relevant factory and operate.
Generally this will not require any artifact, unless the factory in question needs to obtain an artifact for specific purposes.
If it does, this will happen via backchannel lookup and will be hidden from the workflow.
