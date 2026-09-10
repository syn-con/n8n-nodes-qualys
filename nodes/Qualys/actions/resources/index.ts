/**
 * The resource registry.
 *
 * Resources are the UI grouping - what the data is - and each owns its own
 * folder. The transport grouping is different: several resources share a Qualys
 * API plane, and that machinery lives in `../planes`.
 */
import type { QualysResource } from '../types';
import type { OperationDefinition, ResourceDefinition } from './definition';
import { easmResource } from './easm';
import { itAssetResource } from './itAsset';
import { otResource } from './ot';
import { vmdrResource } from './vmdr';

export type { OperationDefinition, ResourceDefinition } from './definition';

export const RESOURCES: Record<QualysResource, ResourceDefinition> = {
  ot: otResource,
  itAsset: itAssetResource,
  vmdr: vmdrResource,
  easm: easmResource,
};

/** An operation definition that knows its own name and which resource owns it. */
export type Operation = OperationDefinition & {
  operation: string;
  resource: QualysResource;
};

/** Every operation, flattened, so the UI and router can look one up directly. */
export const OPERATIONS: Record<string, Operation> = Object.fromEntries(
  Object.entries(RESOURCES).flatMap(([resource, definition]) =>
    Object.entries(definition.operations).map(([operation, spec]) => [
      operation,
      { ...spec, operation, resource: resource as QualysResource },
    ]),
  ),
);

/** Operation values matching a predicate, for building `displayOptions`. */
export const operationsWhere = (
  predicate: (operation: OperationDefinition) => boolean | undefined,
): string[] => Object.keys(OPERATIONS).filter((name) => Boolean(predicate(OPERATIONS[name])));

export const CSAM_PAGE_SIZE_MAX = 300;
export const CSAM_PAGE_SIZE_HARD_MAX = 1000;
export const OT_PAGE_SIZE = 100;
export const FO_DEFAULT_TRUNCATION = 1000;
