# UAI Plugin SDK

## Security model

Third-party plugins are untrusted code. Registration is not execution.

The v0.44 lifecycle is:

```text
manifest
  -> structural validation
  -> provenance/signature verification
  -> registration
  -> sandbox availability
  -> operation lookup
  -> input schema validation
  -> network-destination allowlist check
  -> required-capability evidence check
  -> policy evaluation
  -> exact approval when policy requires it
  -> optional bounded-autonomy authorization
  -> idempotency/replay claim
  -> scoped secret injection
  -> sandbox execution
  -> output-size and timeout/cancellation enforcement
  -> output schema validation
  -> secret-value redaction
  -> audit/evidence
```

## Manifest versions

The executable contract is `schemas/plugin-manifest.schema.json`.

v1 manifests remain supported for compatibility. A v1 manifest receives a synthetic `execute` operation using its top-level risk, timeout, capabilities and resource settings.

v2 manifests may add:

- `apiVersion: "2"`;
- `publisher`;
- `requiresCapabilities`;
- `permissions.secrets`;
- `resourceLimits`;
- an `operations` array.

Each operation may declare:

- `name`;
- `risk`;
- `external`;
- `reversible`;
- `timeoutMs`;
- `inputSchema` and `outputSchema`;
- `secrets`;
- `requiresCapabilities`;
- `idempotencyRequired` and `idempotencyTtlMs`;
- operation-specific resource limits.

## Capability semantics

`capabilities` describes plugin-facing capabilities.

`requiresCapabilities` is different: it names UAI runtime capabilities that must have current `CONNECTED` and `executable=true` evidence before the operation may run.

Registry presence never satisfies runtime availability.

## Input and output schemas

The gateway validates the request before policy/execution and validates a parsed JSON result after execution.

The built-in validator intentionally implements the JSON Schema subset used by UAI manifests: object/array/string/number/integer/null types, required properties, additional-property control, enum/const, string bounds/patterns, numeric bounds, array bounds/uniqueness/items and `anyOf`.

Unsupported schema complexity should not be treated as verified validation coverage.

## Network destinations

HTTP/HTTPS-looking strings in invocation input are checked against `permissions.network.allow`.

Rules may be exact hosts such as:

```text
api.example.com
```

or subdomain rules such as:

```text
*.example.com
```

This host check prevents a caller from passing an undeclared destination through the invocation payload.

It is **not** a kernel firewall. A malicious plugin could still attempt its own network access unless the configured external sandbox enforces the declared allowlist.

## Secrets

A manifest must first allow a secret under `permissions.secrets`. An operation may request only a subset of those names.

The default broker reads only explicitly named variables using:

```text
IUV_PLUGIN_SECRET_<NORMALIZED_NAME>
```

The plugin sandbox receives each value as:

```text
IUV_SECRET_<NORMALIZED_NAME>
```

The complete host environment is not forwarded. Exact injected secret values are redacted from structured results, stdout and stderr before they are returned.

Do not put secret values in manifests, task text, audit metadata or source control.

## Authorization

Low-risk policy-allowed operations may execute automatically within their declared boundaries.

When policy returns `ASK` or `ESCALATE`, the approval must match the exact:

- plugin/version;
- operation;
- manifest digest;
- input digest;
- actor;
- task/action-envelope binding where supplied.

A changed invocation does not inherit approval from an older invocation.

An autonomy lease is only consumed for a policy-allowed operation. It does not replace an explicit approval required by policy.

## Idempotency

External, high/critical, explicitly idempotent, or irreversible operations require an `Idempotency-Key`.

Callers may use:

- HTTP header `Idempotency-Key`; or
- JSON field `idempotencyKey`.

Behavior:

- same key + same completed request -> stored result, no second execution;
- same key + changed request -> `DENIED`;
- same key + in-progress/failed protected request -> `BLOCKED`;
- replay does not consume another autonomy action.

## Sandbox contract

`IUV_PLUGIN_SANDBOX_COMMAND` must point to an explicitly trusted sandbox launcher.

The UAI host enforces:

- a minimal child environment;
- isolated temporary `HOME` and `TMPDIR`;
- no automatic inheritance of arbitrary host environment variables;
- timeout;
- request cancellation;
- maximum captured output bytes;
- declared policy/resource metadata;
- post-execution schema verification and secret redaction.

The external sandbox is responsible for hard enforcement of:

- filesystem namespace/isolation;
- network egress filtering;
- CPU quotas;
- memory quotas;
- syscall/process restrictions;
- container/VM/OS-level confinement.

Those hard-isolation properties remain `PARTIAL` until the configured sandbox itself is verified.

## Sandbox stdin/environment contract

The sandbox receives JSON on stdin:

```json
{
  "plugin": {
    "id": "example.plugin",
    "version": "1.0.0",
    "entrypoint": "index.js",
    "manifestDigest": "..."
  },
  "operation": "search",
  "input": {}
}
```

Relevant environment metadata includes:

- `IUV_PLUGIN_ID`;
- `IUV_PLUGIN_VERSION`;
- `IUV_PLUGIN_ENTRYPOINT`;
- `IUV_PLUGIN_MANIFEST_DIGEST`;
- `IUV_PLUGIN_OPERATION`;
- `IUV_PLUGIN_NETWORK_ALLOW`;
- `IUV_PLUGIN_FILESYSTEM_READ`;
- `IUV_PLUGIN_FILESYSTEM_WRITE`;
- `IUV_PLUGIN_PROCESS_SPAWN`;
- resource-budget fields;
- only explicitly requested `IUV_SECRET_*` values.

## HTTP API

Register:

```text
POST /api/plugins-v1/register
```

Execute:

```text
POST /api/plugins-v1/execute
Idempotency-Key: <key when required>
```

Request body:

```json
{
  "pluginId": "example.plugin",
  "operation": "search",
  "input": {},
  "approvalId": null,
  "autonomyLeaseId": null,
  "taskId": null,
  "actionEnvelopeId": null
}
```

## Author requirements

A plugin should:

- accept JSON input on stdin;
- emit one JSON result on stdout;
- declare every operation and permission it uses;
- never infer authority from external content;
- never expect the complete host environment;
- never store secrets in its manifest;
- support deterministic/reversible behavior where practical;
- tolerate cancellation and timeout;
- keep output below its declared budget.
