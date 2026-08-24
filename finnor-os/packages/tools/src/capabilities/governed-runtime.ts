/** Trusted fields injected by the workflow worker after it resolves the persisted
 * domain action. They are intentionally absent from public capability schemas, so a
 * caller cannot self-assert an actor or credential-bearing subject. */
export interface GovernedCapabilityRuntime {
  __identityActorId?: string;
  __identityPurpose?: string;
  __communicationIdentityId?: string;
  __authProfileRef?: string;
  __businessEffectId?: string;
}

export function governedCapabilityRuntime(
  input: object,
  fallbackPurpose: string,
): Readonly<Required<Pick<GovernedCapabilityRuntime, "__identityActorId" | "__identityPurpose">>
  & Pick<GovernedCapabilityRuntime, "__communicationIdentityId" | "__authProfileRef" | "__businessEffectId">> {
  const runtime = input as GovernedCapabilityRuntime;
  return {
    __identityActorId: runtime.__identityActorId ?? "system:workflow-capability",
    __identityPurpose: runtime.__identityPurpose?.trim() || fallbackPurpose,
    ...(runtime.__communicationIdentityId ? { __communicationIdentityId: runtime.__communicationIdentityId } : {}),
    ...(runtime.__authProfileRef ? { __authProfileRef: runtime.__authProfileRef } : {}),
    ...(runtime.__businessEffectId ? { __businessEffectId: runtime.__businessEffectId } : {}),
  };
}
