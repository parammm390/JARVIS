import type {
  JsonValue,
  SemanticValueInput,
  TraceRedactionSummary,
  TraceValue,
  TraceValueRepresentation,
  ValueSensitivity,
} from "./contracts";
import { canonicalSerialize, prefixedHash, sha256, stableJsonValue } from "./canonical";

const SECRET_PATH = /(?:^|[._\[\]-])(secret|password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|authorization|cookie|session[_-]?token|client[_-]?secret)(?:$|[._\[\]-])/i;
const CREDENTIAL_PATH = /(?:credential|auth[_-]?profile|oauth|provider[_-]?token|connection[_-]?token)/i;
const EMAIL_PATH = /(?:^|[._\[])(?:email|email_address)(?:$|[.\[])/i;
const PHONE_PATH = /(?:^|[._\[])(?:phone|mobile|telephone|contact_number)(?:$|[.\[])/i;
const ADDRESS_PATH = /(?:address|street|postal|postcode|zip)/i;
const PERSON_NAME_PATH = /(?:customer|contact|person|employee|technician|user)[._-]?(?:name|label)|(?:first|last|full)[_-]?name/i;
const PRIVATE_NOTE_PATH = /(?:private[_-]?note|internal[_-]?note|customer[_-]?note|transcript|prompt|reasoning|chain[_-]?of[_-]?thought)/i;
const FINANCIAL_PATH = /(?:amount|price|balance|subtotal|total|currency|invoice|payment|spend|cost)/i;
const IDENTIFIER_PATH = /(?:^|[._\[])(?:id|.*_id|.*Id)(?:$|[.\[])/;

export function inferSensitivity(path: string, explicit?: ValueSensitivity): ValueSensitivity {
  if (explicit) return explicit;
  if (SECRET_PATH.test(path)) return "SECRET";
  if (CREDENTIAL_PATH.test(path)) return "CREDENTIAL_BOUND";
  if (EMAIL_PATH.test(path) || PHONE_PATH.test(path) || ADDRESS_PATH.test(path) || PERSON_NAME_PATH.test(path)) return "PII";
  if (PRIVATE_NOTE_PATH.test(path)) return "CUSTOMER_DATA";
  if (FINANCIAL_PATH.test(path)) return "FINANCIAL";
  if (IDENTIFIER_PATH.test(path) && /(?:customer|household|contact|invoice|payment|proposal|document)/i.test(path)) return "CUSTOMER_DATA";
  return "PUBLIC";
}

export function inferSemanticType(path: string, explicit?: string): string {
  if (explicit) return explicit;
  if (EMAIL_PATH.test(path)) return "Email";
  if (PHONE_PATH.test(path)) return "Phone";
  if (ADDRESS_PATH.test(path)) return "Address";
  if (FINANCIAL_PATH.test(path) && /currency/i.test(path)) return "Currency";
  if (FINANCIAL_PATH.test(path)) return "Amount";
  if (/customer|household/i.test(path) && IDENTIFIER_PATH.test(path)) return "CustomerRef";
  if (/invoice/i.test(path) && IDENTIFIER_PATH.test(path)) return "InvoiceRef";
  if (/payment/i.test(path) && IDENTIFIER_PATH.test(path)) return "PaymentRef";
  if (/document/i.test(path) && IDENTIFIER_PATH.test(path)) return "DocumentRef";
  if (/work/i.test(path) && IDENTIFIER_PATH.test(path)) return "WorkRef";
  if (/status|state/i.test(path)) return "Status";
  if (/date|time|at$|deadline/i.test(path)) return "Timestamp";
  if (/count|attempt|sequence|index/i.test(path)) return "Integer";
  return "Value";
}

function placeholderFor(semanticType: string, sensitivity: ValueSensitivity): string {
  if (sensitivity === "SECRET") return "SecretValue";
  if (sensitivity === "CREDENTIAL_BOUND") return "CredentialBoundValue";
  if (sensitivity === "PII" || sensitivity === "CUSTOMER_DATA") return semanticType === "Value" ? "PrivateSemanticValue" : semanticType;
  if (sensitivity === "FINANCIAL") return semanticType === "Value" ? "FinancialValue" : semanticType;
  if (sensitivity === "TENANT_INTERNAL") return semanticType === "Value" ? "TenantBoundValue" : semanticType;
  return semanticType;
}

function isJsonContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return Boolean(value) && typeof value === "object";
}

/** Flatten containers before redaction so a seemingly-public object cannot smuggle
 * a nested token, email, private note, or provider credential into Trace IR. */
export function expandSemanticValueInput(input: SemanticValueInput): SemanticValueInput[] {
  if (!isJsonContainer(input.value) || input.sensitivity === "SECRET" || input.sensitivity === "CREDENTIAL_BOUND") return [input];
  const nestedSensitivity = input.sensitivity && input.sensitivity !== "PUBLIC" ? input.sensitivity : undefined;
  if (Array.isArray(input.value)) {
    if (input.value.length === 0) return [{ ...input, value: [] }];
    return input.value.flatMap((child, index) => expandSemanticValueInput({ ...input, path: `${input.path}[${index}]`, value: child, semanticType: undefined, sensitivity: nestedSensitivity }));
  }
  const entries = Object.entries(input.value).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return [{ ...input, value: {} }];
  return entries.flatMap(([key, child]) => expandSemanticValueInput({ ...input, path: `${input.path}.${key}`, value: child, semanticType: undefined, sensitivity: nestedSensitivity }));
}

export interface RedactionCounter {
  piiLiteralsRedacted: number;
  customerDataLiteralsRedacted: number;
  credentialValuesRedacted: number;
  secretValuesDiscarded: number;
}

export function emptyRedactionCounter(): RedactionCounter {
  return { piiLiteralsRedacted: 0, customerDataLiteralsRedacted: 0, credentialValuesRedacted: 0, secretValuesDiscarded: 0 };
}

export function redactionSummary(counter: RedactionCounter): TraceRedactionSummary {
  return { ...counter, rawSecretLeakage: 0, modelChainOfThoughtPersisted: 0 };
}

export function redactSemanticValue(
  input: SemanticValueInput,
  context: { tenantId: string; nodeId: string; direction: "input" | "output"; evidenceId: string; sourceRef: string; equalitySalt: string },
  counter: RedactionCounter,
): TraceValue {
  const sensitivity = inferSensitivity(input.path, input.sensitivity);
  const semanticType = inferSemanticType(input.path, input.semanticType);
  const stableValue = stableJsonValue(input.value);
  let representation: TraceValueRepresentation;
  let equalityToken: string | null;

  if (sensitivity === "SECRET") {
    representation = { kind: "TYPED_PLACEHOLDER", placeholder: placeholderFor(semanticType, sensitivity) };
    equalityToken = null;
    counter.secretValuesDiscarded += 1;
  } else if (sensitivity === "CREDENTIAL_BOUND") {
    representation = { kind: "TYPED_PLACEHOLDER", placeholder: placeholderFor(semanticType, sensitivity) };
    equalityToken = null;
    counter.credentialValuesRedacted += 1;
  } else if (sensitivity === "PUBLIC") {
    representation = { kind: "LITERAL", value: stableValue };
    equalityToken = `p6:eq:sha256:${sha256(`${context.equalitySalt}|${semanticType}|${canonicalSerialize(stableValue)}`)}`;
  } else {
    representation = { kind: "TYPED_PLACEHOLDER", placeholder: placeholderFor(semanticType, sensitivity) };
    equalityToken = `p6:eq:sha256:${sha256(`${context.equalitySalt}|${context.tenantId}|${semanticType}|${canonicalSerialize(stableValue)}`)}`;
    if (sensitivity === "PII") counter.piiLiteralsRedacted += 1;
    if (sensitivity === "CUSTOMER_DATA" || sensitivity === "TENANT_INTERNAL" || sensitivity === "FINANCIAL") counter.customerDataLiteralsRedacted += 1;
  }

  const derivedFromValueIds = (input.derivedFrom ?? []).map((parent) => prefixedHash("p6:value-ref:sha256:", parent));
  return {
    valueId: prefixedHash("p6:value:sha256:", {
      nodeId: context.nodeId,
      direction: context.direction,
      path: input.path,
      semanticType,
      role: input.role,
    }),
    path: input.path,
    role: input.role,
    semanticType,
    sensitivity,
    representation,
    equalityToken,
    bindingScope: input.bindingScope ?? "UNKNOWN",
    provenance: {
      evidenceIds: [context.evidenceId],
      sourceRefs: [context.sourceRef],
      derivedFromValueIds,
      derivationRule: input.derivationRule ?? null,
      complete: input.provenanceComplete ?? (input.role !== "DERIVED" || derivedFromValueIds.length > 0),
    },
  };
}

export function procedureRepresentationSafe(representation: TraceValueRepresentation, sensitivity: ValueSensitivity): boolean {
  return sensitivity === "PUBLIC" || representation.kind !== "LITERAL";
}

export function valueContainsRawSecret(value: unknown): boolean {
  const serialized = canonicalSerialize(value);
  return /(?:sk_live_|sk_test_|Bearer\s+[A-Za-z0-9._~-]{8,}|-----BEGIN [A-Z ]+PRIVATE KEY-----|password["']?\s*[:=])/i.test(serialized);
}
