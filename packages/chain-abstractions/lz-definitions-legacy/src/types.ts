import { Chain, EndpointVersion, Environment, Stage } from './enums';

/**
 * Type representing a network name.
 * The network name is a template literal type combining the chain, stage, and an optional '-local' suffix.
 * @see {@link Chain}, {@link Stage}
 */
export type Network = `${Chain}-${Stage}${'-local' | ''}`;

/**
 * Interface representing the specification of an endpoint.
 */
export interface EndpointSpec {
    /**
     * The chain of the endpoint. {@link Chain}
     */
    chain: Chain;

    /**
     * The stage of the endpoint. {@link Stage}
     */
    stage: Stage;

    /**
     * The version of the endpoint. {@link EndpointVersion}
     */
    version: EndpointVersion;

    /**
     * The environment of the endpoint. {@link Environment}
     */
    env: Environment;
}
